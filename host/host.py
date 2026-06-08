"""
Native messaging host for the claude.ai Token Tracker extension.
Chrome communicates via stdin/stdout using 4-byte little-endian length-prefixed JSON.
Each received record is appended as a JSONL line to ~/.claude/claude-ai/{session_id}.jsonl
"""
import sys
import json
import struct
import pathlib
from datetime import datetime, timezone, timedelta

OUTDIR = pathlib.Path.home() / ".claude" / "claude-ai"


def compute_5h_tokens():
    """Sum all token counts from claude.ai and Claude Code sessions in the last 5 hours."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=5)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%S")  # ISO-8601 prefix, safe for string comparison (all timestamps are UTC)
    total = 0
    home = pathlib.Path.home()
    scan_dirs = [
        home / ".claude" / "claude-ai",  # claude.ai sessions (this extension)
        home / ".claude" / "projects",   # Claude Code CLI sessions
    ]
    for base in scan_dirs:
        if not base.exists():
            continue
        for jsonl_path in base.rglob("*.jsonl"):
            try:
                with jsonl_path.open("r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                            ts = rec.get("timestamp", "")
                            if len(ts) < 19 or ts[:19] < cutoff_str:
                                continue
                            usage = rec.get("message", {}).get("usage", {})
                            if not isinstance(usage, dict):
                                continue
                            total += usage.get("input_tokens", 0)
                            total += usage.get("output_tokens", 0)
                            total += usage.get("cache_creation_input_tokens", 0)
                            total += usage.get("cache_read_input_tokens", 0)
                        except (json.JSONDecodeError, ValueError, KeyError):
                            continue
            except OSError:
                continue
    return total


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        sys.exit(0)
    length = struct.unpack("<I", raw_len)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def write_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    OUTDIR.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            record = read_message()
        except Exception:
            break

        session_id = record.get("session_id", "unknown")
        path = OUTDIR / f"{session_id}.jsonl"
        try:
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")
            write_message({"ok": True, "window_tokens": compute_5h_tokens()})
        except Exception as e:
            write_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()

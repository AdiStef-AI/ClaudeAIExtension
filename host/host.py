"""
Native messaging host for the claude.ai Token Tracker extension.
Chrome communicates via stdin/stdout using 4-byte little-endian length-prefixed JSON.
Each received record is appended as a JSONL line to ~/.claude/claude-ai/{session_id}.jsonl
"""
import sys
import json
import struct
import pathlib

OUTDIR = pathlib.Path.home() / ".claude" / "claude-ai"


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
            write_message({"ok": True})
        except Exception as e:
            write_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()

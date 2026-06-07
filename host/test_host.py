"""Quick smoke test for host.py — sends a synthetic record and checks the output file."""
import json
import struct
import subprocess
import pathlib
import sys

record = {
    "type": "assistant",
    "timestamp": "2026-06-06T12:00:00.000Z",
    "source": "claude.ai",
    "project": "Test conversation",
    "session_id": "test-session-00000000",
    "message": {
        "model": "claude-sonnet-4-6",
        "usage": {
            "input_tokens": 100,
            "output_tokens": 50,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
    },
}

data = json.dumps(record).encode("utf-8")
msg = struct.pack("<I", len(data)) + data

host = pathlib.Path(__file__).parent / "host.py"
proc = subprocess.Popen(
    [sys.executable, str(host)],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
stdout, stderr = proc.communicate(input=msg, timeout=5)

if len(stdout) >= 4:
    resp_len = struct.unpack("<I", stdout[:4])[0]
    resp = json.loads(stdout[4 : 4 + resp_len])
    print("Host response:", resp)
else:
    print("No response from host. stderr:", stderr.decode())
    sys.exit(1)

out = pathlib.Path.home() / ".claude" / "claude-ai" / "test-session-00000000.jsonl"
if out.exists():
    print("JSONL file written:", out)
    print("Contents:", out.read_text(encoding="utf-8"))
else:
    print("ERROR: JSONL file not found at", out)
    sys.exit(1)

"""
Called by setup.bat. Writes host.json with correct paths and registers the
native messaging host in the Windows registry.
Usage: python setup_helper.py <host_dir> <extension_id>
"""
import sys
import json
import subprocess
import pathlib

host_dir = pathlib.Path(sys.argv[1]).resolve()
ext_id   = sys.argv[2].strip()

bat_path  = host_dir / "host.bat"
json_path = host_dir / "host.json"

host_manifest = {
    "name":            "com.anthropic.claudeai_tc",
    "description":     "claude.ai token tracker companion",
    "path":            str(bat_path),
    "type":            "stdio",
    "allowed_origins": [f"chrome-extension://{ext_id}/"],
}

json_path.write_text(json.dumps(host_manifest, indent=2), encoding="utf-8")
print(f"  Written:    {json_path}")

reg_key = r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.anthropic.claudeai_tc"
subprocess.run(
    ["reg", "add", reg_key, "/ve", "/t", "REG_SZ", "/d", str(json_path), "/f"],
    check=True,
)
print(f"  Registered: {reg_key}")

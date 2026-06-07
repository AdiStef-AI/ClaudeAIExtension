"""
One-time setup for the claude.ai Token Tracker native host.
Run with: python setup.py
"""
import json
import pathlib
import subprocess
import sys

host_dir = pathlib.Path(__file__).parent.resolve()

print()
print("  claude.ai Token Tracker -- Native Host Setup")
print("  =============================================")
print()
print("  Step 1: Load the extension in Chrome")
print("    - Open chrome://extensions")
print("    - Enable 'Developer mode' (top-right toggle)")
print(f"    - Click 'Load unpacked' and select:")
print(f"        {host_dir.parent}")
print("    - Find the extension card and copy its ID")
print("      (a 32-character string like abcdefghijklmnopqrstuvwxyzabcdef)")
print()

ext_id = input("  Enter the Extension ID: ").strip()
if not ext_id:
    print("  ERROR: No extension ID entered. Aborting.")
    sys.exit(1)

print()

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
result = subprocess.run(
    ["reg", "add", reg_key, "/ve", "/t", "REG_SZ", "/d", str(json_path), "/f"],
    capture_output=True, text=True,
)
if result.returncode != 0:
    print(f"  ERROR registering: {result.stderr.strip()}")
    sys.exit(1)

print(f"  Registered: {reg_key}")
print()
print("  Done! Reload the extension in Chrome (click the refresh icon on the card).")
print()

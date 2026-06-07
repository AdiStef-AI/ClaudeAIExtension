<#
.SYNOPSIS
  Checks whether the claude.ai Token Tracker extension is installed and up to date.
  Clones and builds automatically if missing; pulls latest if out of date.
  Prints instructions for any manual step required in Chrome.

.USAGE
  powershell -ExecutionPolicy Bypass -File check-install.ps1
#>

# ── Configuration ─────────────────────────────────────────────────────────────

$REPO_URL    = "https://github.com/AdiStef-AI/ClaudeAIExtension.git"
$INSTALL_DIR = "$env:USERPROFILE\ClaudeAIExtension"
$HOST_NAME   = "com.anthropic.claudeai_tc"
$REG_KEY     = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HOST_NAME"

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-OK($msg)   { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Write-FAIL($msg) { Write-Host "  [!!]  $msg" -ForegroundColor Red }
function Write-INFO($msg) { Write-Host "  [-]   $msg" -ForegroundColor DarkGray }
function Write-WARN($msg) { Write-Host "  [>>]  $msg" -ForegroundColor Yellow }
function Write-Head($msg) { Write-Host "`n$msg" -ForegroundColor White }

$issues = 0

Write-Host ""
Write-Host "  claude.ai Token Tracker - Install Check" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan

# ── 1. Prerequisites ──────────────────────────────────────────────────────────

Write-Head "1. Prerequisites"

$prereqOk = $true
$cmds = @("git", "python", "node", "npm")
foreach ($cmd in $cmds) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        Write-OK $cmd
    } else {
        Write-FAIL "$cmd not found -- install it and re-run this script"
        $issues++
        $prereqOk = $false
    }
}

if (-not $prereqOk) {
    Write-Host ""
    Write-Host "  Fix missing prerequisites, then re-run." -ForegroundColor Red
    exit 1
}

# ── 2. Repo / version ─────────────────────────────────────────────────────────

Write-Head "2. Installation"

$needsBuild = $false

if (-not (Test-Path "$INSTALL_DIR\.git")) {
    Write-WARN "Not found at $INSTALL_DIR -- cloning..."
    git clone $REPO_URL $INSTALL_DIR 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-FAIL "Clone failed. Check your internet connection and try again."
        exit 1
    }
    Write-OK "Cloned to $INSTALL_DIR"
    $needsBuild = $true
} else {
    Write-OK "Found at $INSTALL_DIR"

    $localCommit = git -C $INSTALL_DIR rev-parse HEAD 2>$null
    Write-INFO "Local  commit: $($localCommit.Substring(0,7))"

    $remoteRaw = git ls-remote $REPO_URL HEAD 2>$null
    if ($remoteRaw) {
        $remoteCommit = ($remoteRaw -split '\s+')[0]
        Write-INFO "Remote commit: $($remoteCommit.Substring(0,7))"

        if ($localCommit -eq $remoteCommit) {
            Write-OK "Up to date"
        } else {
            Write-WARN "Out of date -- pulling latest..."
            git -C $INSTALL_DIR pull --ff-only 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-FAIL "Pull failed. Resolve manually in: $INSTALL_DIR"
                $issues++
            } else {
                Write-OK "Updated to $($remoteCommit.Substring(0,7))"
                $needsBuild = $true
            }
        }
    } else {
        Write-WARN "Could not reach GitHub -- skipping version check"
    }
}

# ── 3. Tokenizer bundle ───────────────────────────────────────────────────────

Write-Head "3. Tokenizer bundle"

$tokenizerPath = "$INSTALL_DIR\tokenizer.js"

if ($needsBuild -or -not (Test-Path $tokenizerPath)) {
    Write-INFO "Building tokenizer (npm install + npm run build)..."
    Push-Location $INSTALL_DIR
    $npmOut = npm install 2>&1
    $buildOut = npm run build 2>&1
    Pop-Location
    if (Test-Path $tokenizerPath) {
        Write-OK "tokenizer.js built"
    } else {
        Write-FAIL "Build failed. Output:"
        $npmOut   | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        $buildOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Write-FAIL "Run manually: cd `"$INSTALL_DIR`"; npm install; npm run build"
        $issues++
    }
} else {
    Write-OK "tokenizer.js present"
}

# ── 4. Native host registration ───────────────────────────────────────────────

Write-Head "4. Native host registration"

$regOk = $false

if (Test-Path $REG_KEY) {
    $hostJsonPath = (Get-ItemProperty $REG_KEY).'(default)'

    if (Test-Path $hostJsonPath) {
        $hostJson    = Get-Content $hostJsonPath -Raw | ConvertFrom-Json
        $hostBatPath = $hostJson.path

        if (Test-Path $hostBatPath) {
            Write-OK "Registry key present"
            Write-OK "host.json valid  ($hostJsonPath)"
            Write-OK "host.bat present ($hostBatPath)"
            $regOk = $true
        } else {
            Write-FAIL "host.bat not found at: $hostBatPath"
            Write-WARN "Re-run setup: python `"$INSTALL_DIR\host\setup.py`""
            $issues++
        }
    } else {
        Write-FAIL "host.json not found at: $hostJsonPath"
        Write-WARN "Re-run setup: python `"$INSTALL_DIR\host\setup.py`""
        $issues++
    }
} else {
    Write-WARN "Native host not registered"
    $issues++
}

# ── 5. Summary ────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  --------------------------------------------" -ForegroundColor DarkGray

if ($issues -eq 0) {
    Write-Host "  All checks passed." -ForegroundColor Green
    Write-Host "  The extension is installed and up to date." -ForegroundColor Green
} else {
    Write-Host "  $issues issue(s) found." -ForegroundColor Yellow
}

if (-not $regOk) {
    Write-Host ""
    Write-Host "  NEXT STEPS -- complete in order:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. Open Chrome and go to:  chrome://extensions" -ForegroundColor Cyan
    Write-Host "  2. Enable Developer mode   (toggle, top-right corner)" -ForegroundColor Cyan
    Write-Host "  3. Click 'Load unpacked'   and select:" -ForegroundColor Cyan
    Write-Host "       $INSTALL_DIR" -ForegroundColor White
    Write-Host "  4. Copy the Extension ID   (32-char string on the card)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  5. Run the setup script:" -ForegroundColor Cyan
    Write-Host "       python `"$INSTALL_DIR\host\setup.py`"" -ForegroundColor White
    Write-Host "     Paste the Extension ID when prompted." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  6. Click the refresh icon on the extension card in Chrome." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  NOTE: The Extension ID is tied to the folder path. If you move" -ForegroundColor DarkGray
    Write-Host "  the folder later, repeat steps 1-6 from the new location." -ForegroundColor DarkGray
}

Write-Host ""

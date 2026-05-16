@echo off
setlocal
echo.
echo  claude.ai Token Tracker -- Native Host Setup
echo  =============================================
echo.
echo  Step 1: Load the extension in Chrome
echo    - Open chrome://extensions
echo    - Enable "Developer mode" (top-right toggle)
echo    - Click "Load unpacked" and select:
echo        %~dp0..
echo    - Find the extension card and copy its ID
echo      (a 32-character string like abcdefghijklmnopqrstuvwxyzabcdef)
echo.
set /p EXT_ID= Enter the Extension ID:
echo.
python "%~dp0setup_helper.py" "%~dp0" "%EXT_ID%"
echo.
echo  Done! Reload the extension in Chrome (click the refresh icon on the card).
echo.
pause

@echo off
setlocal
cd /d "%~dp0"

echo ======================================================================
echo   Generating Tauri Updater Signing Keys for FalafelUI
echo ======================================================================
echo.
echo When prompted, enter a password for the private key (or press Enter for no password):
echo.

call npx @tauri-apps/cli signer generate -w src-tauri/falafel.key
if errorlevel 1 (
    echo.
    echo [ERROR] Key generation failed.
    echo Please make sure Node.js is installed and you ran "npm install".
    echo.
    pause
    exit /b 1
)

echo.
node scripts/apply-updater-pubkey.mjs
echo.
pause

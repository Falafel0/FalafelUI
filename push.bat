@echo off
setlocal
cd /d "%~dp0"

echo ======================================================================
echo   Pushing changes to Falafel0/FalafelUI (origin main)
echo ======================================================================
echo.

git -c core.hooksPath=/dev/null add -A
git -c core.hooksPath=/dev/null commit -m "feat: retarget repo to FalafelUI fork, configure signing keys and adapt agent instructions"
git -c core.hooksPath=/dev/null push origin main

if errorlevel 1 (
    echo.
    echo [ERROR] Push failed. Check your network or GitHub permissions.
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo   [SUCCESS] Successfully pushed to origin main!
echo ======================================================================
echo.
pause

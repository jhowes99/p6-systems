@echo off
title P6 Systems - Install
setlocal

echo.
echo  ============================================
echo   P6 Systems - One-time setup
echo  ============================================
echo.

REM Resolve repo root (where this batch file lives)
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "SERVER=%ROOT%\server"

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  Node.js was not found.
    echo.
    echo  1. Download and install Node.js from: https://nodejs.org/
    echo     Use the LTS version.
    echo  2. Close and reopen this window, then run INSTALL.bat again.
    echo.
    pause
    exit /b 1
)

echo  Node.js found.
node -v
echo.

REM Install dependencies
echo  Installing dependencies in server folder...
echo.
cd /d "%SERVER%"
call npm install
if errorlevel 1 (
    echo.
    echo  npm install failed. Check the messages above.
    pause
    exit /b 1
)

cd /d "%ROOT%"

REM Create START.bat in repo root
echo.
echo  Creating START.bat...
(
echo @echo off
echo title P6 Systems
echo set "ROOT=%%~dp0"
echo set "ROOT=%%ROOT:~0,-1%%"
echo echo.
echo echo  Starting P6 Systems...
echo echo  Open in browser: http://localhost:3000
echo echo  Press Ctrl+C to stop the server.
echo echo.
echo start "" "http://localhost:3000"
echo cd /d "%%ROOT%%\server"
echo node server.js
echo pause
) > "%ROOT%\START.bat"

echo.
echo  ============================================
echo   Setup complete
echo  ============================================
echo.
echo  To run the app:
echo    Double-click START.bat
echo.
echo  Or from a terminal in this folder:
echo    START.bat
echo.
echo  Then open in your browser: http://localhost:3000
echo.
pause

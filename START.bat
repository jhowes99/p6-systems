@echo off
title P6 Systems
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

if not exist "%ROOT%\server\node_modules" (
    echo.
    echo  Run INSTALL.bat first to install dependencies.
    echo.
    pause
    exit /b 1
)

echo.
echo  Starting P6 Systems...
echo  Open in browser: http://localhost:3000
echo  Press Ctrl+C to stop the server.
echo.

start "" "http://localhost:3000"
cd /d "%ROOT%\server"
node server.js
pause

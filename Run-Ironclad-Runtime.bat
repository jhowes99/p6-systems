@echo off
title Ironclad Runtime
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "COMPOSE_FILE=%ROOT%\docker-compose.share.yml"

REM ----- Check for Docker (installed and in PATH) -----
where docker >nul 2>&1
if %errorlevel% equ 0 goto :docker_ready

REM ----- Docker not in PATH: try to find Docker Desktop Installer (EXE or MSI) -----
set "INSTALLER="
set "USE_MSI=0"
if exist "%ROOT%\installer\docker\Docker Desktop Installer.exe" set "INSTALLER=%ROOT%\installer\docker\Docker Desktop Installer.exe"
if exist "%ROOT%\installer\docker\DockerDesktop.msi" set "INSTALLER=%ROOT%\installer\docker\DockerDesktop.msi" & set "USE_MSI=1"
if not defined INSTALLER if exist "%ROOT%\docker\Docker Desktop Installer.exe" set "INSTALLER=%ROOT%\docker\Docker Desktop Installer.exe"
if not defined INSTALLER if exist "%ROOT%\docker\DockerDesktop.msi" set "INSTALLER=%ROOT%\docker\DockerDesktop.msi" & set "USE_MSI=1"
if not defined INSTALLER if exist "%ROOT%\Docker Desktop Installer.exe" set "INSTALLER=%ROOT%\Docker Desktop Installer.exe"
if not defined INSTALLER if exist "%ROOT%\DockerDesktop.msi" set "INSTALLER=%ROOT%\DockerDesktop.msi" & set "USE_MSI=1"

if not defined INSTALLER (
    echo.
    echo  Docker was not found on this computer.
    echo.
    echo  To run Ironclad Runtime with one click:
    echo  1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/
    echo  2. Place "Docker Desktop Installer.exe" in this folder:
    echo     %ROOT%\installer\docker\
    echo  3. Right-click this file and choose "Run as administrator"
    echo  4. Then double-click this file again to start.
    echo.
    echo  Or install Docker Desktop yourself, then double-click this file.
    echo.
    pause
    exit /b 1
)

echo.
echo  Installing Docker Desktop (one-time). This may take a few minutes...
echo  You may be asked for administrator permission.
echo.

if "!USE_MSI!" equ "1" (
    REM MSI silent install (Docker Business / Enterprise)
    msiexec /i "!INSTALLER!" /qn /norestart
) else (
    REM EXE silent install (standard Docker Desktop)
    "!INSTALLER!" install --quiet --norestart
)
if errorlevel 1 (
    echo.
    echo  Installation failed or needs administrator rights.
    echo  Right-click this file, choose "Run as administrator", then try again.
    echo.
    pause
    exit /b 1
)

echo  Docker Desktop installed. Waiting for it to start...
echo  If Docker asks to enable WSL or restart, accept and restart this script after reboot.
timeout /t 30 /nobreak >nul

:docker_ready
REM ----- Wait for Docker daemon to be ready (up to 2.5 minutes) -----
set "WAIT_LEFT=30"
:wait_loop
docker info >nul 2>&1
if %errorlevel% equ 0 goto :start_stack
set /a WAIT_LEFT-=1
if %WAIT_LEFT% leq 0 (
    echo.
    echo  Docker did not start in time. Try:
    echo  - Open "Docker Desktop" from the Start menu and wait until it says "Running"
    echo  - Then double-click this file again.
    echo.
    pause
    exit /b 1
)
timeout /t 5 /nobreak >nul
goto :wait_loop

:start_stack
if not exist "%COMPOSE_FILE%" (
    echo  Compose file not found: %COMPOSE_FILE%
    pause
    exit /b 1
)

echo.
echo  Starting Ironclad Runtime...
cd /d "%ROOT%"
docker compose -f docker-compose.share.yml up -d --build
if errorlevel 1 (
    echo.
    echo  Failed to start. Check the messages above.
    pause
    exit /b 1
)

REM Give the app a moment to listen
timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo  Ironclad Runtime is running.
echo  Your browser should open to http://localhost:3000
echo.
echo  To stop the app later, double-click: Stop-Ironclad-Runtime.bat
echo  You can close this window; the app keeps running in the background.
echo.
pause

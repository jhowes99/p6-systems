@echo off
title Stop P6 Systems
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo.
echo  Stopping P6 Systems...
cd /d "%ROOT%"
docker compose -f docker-compose.share.yml down
echo.
echo  Done. The app has stopped.
echo.
pause

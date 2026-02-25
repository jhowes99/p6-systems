@echo off
title Stop Ironclad Runtime
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo.
echo  Stopping Ironclad Runtime...
cd /d "%ROOT%"
docker compose -f docker-compose.share.yml down
echo.
echo  Done. The app has stopped.
echo.
pause

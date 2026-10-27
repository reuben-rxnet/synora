@echo off
rem Stops Synora (web app, sync worker and database). Your indexed records, connectors and saved items are kept.
title Stopping Synora
set "COMPOSE=D:\Projects\Synora\docker-compose.yml"
set "PORT=3020"
echo Stopping Synora (your data is kept)...

set "found="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  set "found=1"
  taskkill /pid %%p /t /f >nul 2>&1
)
rem Close the server and worker windows too. Next.js renames its window, so find both by the command
rem that "Start Synora" opened them with, not by their titles.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -like '*Synora (server)*' -or $_.CommandLine -like '*Synora (sync worker)*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
rem The worker runs under tsx (node); stop it by its script path in case its window was already closed.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*Synora*src*worker*index.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

if defined found (
  echo The app server and sync worker are stopped.
) else (
  echo The app server was not running.
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running, so the database is already stopped.
  goto done
)
rem "stop" keeps the database volume (pgdata); never "down -v".
docker compose -f "%COMPOSE%" stop db
if errorlevel 1 (
  echo The database could not be stopped; see the messages above.
  pause
  exit /b 1
)
echo The database is stopped.

:done
echo Synora is stopped.
timeout /t 3 >nul

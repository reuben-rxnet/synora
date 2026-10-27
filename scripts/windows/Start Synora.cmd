@echo off
rem Starts Synora (database in Docker + web app on port 3020 + sync worker) and opens it in the browser.
title Starting Synora
set "APP_DIR=D:\Projects\Synora"
set "COMPOSE=D:\Projects\Synora\docker-compose.yml"
set "DB_CONTAINER=synora-db-1"
set "DOCKER_DESKTOP=%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
set "PORT=3020"
set "APP=http://localhost:%PORT%"
set "SERVER_TITLE=Synora (server)"
set "WORKER_TITLE=Synora (sync worker)"

echo Starting Synora...

netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo It is already running.
  goto open_app
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js, then run this again.
  pause
  exit /b 1
)
if not exist "%APP_DIR%\node_modules" (
  echo The app's packages are missing. Run "npm install" in %APP_DIR% first.
  pause
  exit /b 1
)
if not exist "%APP_DIR%\.env" (
  echo The settings file is missing. Copy .env.example to .env in %APP_DIR%, then run this again.
  pause
  exit /b 1
)

docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
echo Starting Docker Desktop (this can take a minute)...
if exist "%DOCKER_DESKTOP%" start "" "%DOCKER_DESKTOP%"
set /a tries=0
:wait_docker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
set /a tries+=1
if %tries% lss 60 goto wait_docker
echo Docker Desktop did not start within 3 minutes. Open it yourself, then run this again.
pause
exit /b 1

:docker_ready
echo Docker is running.
echo Starting the database...
docker compose -f "%COMPOSE%" up -d db
if errorlevel 1 (
  echo docker compose could not start the database. See the messages above.
  pause
  exit /b 1
)

echo Waiting for the database...
set /a tries=0
:wait_db
docker exec %DB_CONTAINER% pg_isready -U synora -d synora >nul 2>&1
if not errorlevel 1 goto db_ready
set /a tries+=1
if %tries% geq 30 (
  echo The database did not become ready within 90 seconds. See Docker Desktop for details.
  pause
  exit /b 1
)
timeout /t 3 /nobreak >nul
goto wait_db

:db_ready
echo Starting the server in its own window ("%SERVER_TITLE%")...
start "%SERVER_TITLE%" /min /d "%APP_DIR%" cmd /k "title %SERVER_TITLE% && npx next dev -p %PORT%"
echo Starting the sync worker in its own window ("%WORKER_TITLE%")...
start "%WORKER_TITLE%" /min /d "%APP_DIR%" cmd /k "title %WORKER_TITLE% && npm run worker"

echo Waiting for the app (the first page compiles on demand)...
set /a tries=0
:wait_app
curl.exe -sf -o nul --max-time 60 "%APP%/api/health" && goto open_app
set /a tries+=1
if %tries% geq 40 goto app_slow
timeout /t 3 /nobreak >nul
goto wait_app

:open_app
start "" "%APP%"
echo Synora is ready: %APP%
echo To stop it, run "Stop Synora".
timeout /t 4 >nul
exit /b 0

:app_slow
start "" "%APP%"
echo The app is still starting. Refresh the browser page in a minute.
echo If it doesn't come up, open the "%SERVER_TITLE%" window on the taskbar to see why.
pause

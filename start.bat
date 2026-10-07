@echo off
rem Build the web app if needed, then start CactusPOS on port 3000.
cd /d "%~dp0"
if not exist node_modules call npm install || exit /b 1
if not exist packages\web\dist call npm run build || exit /b 1
call npm run start --workspace @cactus/server

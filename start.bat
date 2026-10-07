@echo off
rem Build the web app, then start CactusPOS (port 3000, or the next free one).
cd /d "%~dp0"
if not exist node_modules call npm install || goto :fail
call npm run build || goto :fail
call npm run start --workspace @cactus/server || goto :fail
exit /b 0
:fail
echo.
echo CactusPOS did not start. The error is shown above.
pause
exit /b 1

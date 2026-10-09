@echo off
rem Installs CactusPOS for this Windows user: shortcuts, start at sign-in, firewall rule for tablets.
rem Safe to run again after an update. Details and options: ops\install.md
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\windows\install.ps1" %*
echo.
pause

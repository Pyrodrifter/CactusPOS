@echo off
rem Puts a backup of the sales data back. Double-click for the newest backup on this computer, or drag a
rem backup file (from a USB stick) onto this file. It shows what it found and asks before changing anything.
rem The data it replaces is kept, not deleted. Details: ops\install.md, "Backups".
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\windows\restore.ps1" %*
echo.
pause

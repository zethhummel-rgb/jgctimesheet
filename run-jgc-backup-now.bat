@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-jgc-portal.ps1"
set "BACKUP_EXIT_CODE=%ERRORLEVEL%"
if not "%BACKUP_EXIT_CODE%"=="0" echo Backup FAILED. Review the errors above; a failed run must not be treated as a usable backup.
pause
exit /b %BACKUP_EXIT_CODE%

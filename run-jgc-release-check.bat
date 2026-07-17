@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-jgc-release.ps1"
set "JGC_RELEASE_EXIT=%ERRORLEVEL%"
echo.
if "%JGC_RELEASE_EXIT%"=="0" (
  echo JGC release verification passed.
) else (
  echo JGC release verification failed. Review the messages above before pushing.
)
pause
exit /b %JGC_RELEASE_EXIT%

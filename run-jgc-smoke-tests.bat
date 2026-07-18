@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-jgc-smoke-tests.ps1"
set "JGC_SMOKE_EXIT=%ERRORLEVEL%"
echo.
if "%JGC_SMOKE_EXIT%"=="0" (
  echo JGC browser smoke tests passed.
) else (
  echo JGC browser smoke tests failed. Review the messages above before pushing.
)
pause
exit /b %JGC_SMOKE_EXIT%

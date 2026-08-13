@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
call "%ROOT%\bin\pinar.cmd" ensure
set "ERR=%ERRORLEVEL%"
if "%PINAR_HOOK_JSON%"=="1" (
  echo {}
  exit /b 0
)
exit /b %ERR%

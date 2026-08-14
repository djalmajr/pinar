@echo off
setlocal
set ROOT=%~dp0..
set CLI=%ROOT%\lib\cli.mjs
if not exist "%CLI%" set CLI=%ROOT%\src\cli.mjs
where node >nul 2>&1 && (
  node "%CLI%" %*
  exit /b %ERRORLEVEL%
)
where bun >nul 2>&1 && (
  bun "%CLI%" %*
  exit /b %ERRORLEVEL%
)
echo pinar: need node or bun on PATH
exit /b 1

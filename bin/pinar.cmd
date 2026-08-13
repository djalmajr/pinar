@echo off
setlocal
set ROOT=%~dp0..
where node >nul 2>&1 && (
  node "%ROOT%\src\cli.mjs" %*
  exit /b %ERRORLEVEL%
)
where bun >nul 2>&1 && (
  bun "%ROOT%\src\cli.mjs" %*
  exit /b %ERRORLEVEL%
)
echo pinar: need node or bun on PATH
exit /b 1

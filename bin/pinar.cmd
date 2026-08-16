@echo off
setlocal
set ROOT=%~dp0..
set CLI=%ROOT%\apps\cli\src\cli.mjs
where bun >nul 2>&1 && (
  bun "%CLI%" %*
  exit /b %ERRORLEVEL%
)
echo pinar: need the compiled binary or Bun on PATH
exit /b 1

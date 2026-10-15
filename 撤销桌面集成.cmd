@echo off
setlocal
cd /d "%~dp0"
node src\integration.mjs remove %*
if errorlevel 1 goto end
echo.
echo Restart Hermes Desktop after changing the integration. MCP stays separate.
:end
pause

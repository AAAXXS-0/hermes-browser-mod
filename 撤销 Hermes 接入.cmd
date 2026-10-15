@echo off
setlocal
cd /d "%~dp0"
node src\adapter.mjs disconnect
echo.
echo Reload MCP in Hermes to remove previously loaded tools.
pause

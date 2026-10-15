@echo off
setlocal
cd /d "%~dp0"
node src\adapter.mjs connect
echo.
echo Reload MCP in Hermes or restart its runtime when convenient.
pause

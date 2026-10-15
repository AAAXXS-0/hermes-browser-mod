@echo off
setlocal
cd /d "%~dp0"
node src\launcher.mjs --stop
if errorlevel 1 pause

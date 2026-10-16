@echo off
setlocal
cd /d "%~dp0"
set "ML_NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto run
set "ML_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%ML_NODE%" goto run
set "ML_NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%ML_NODE%" goto run
echo Please install Node.js 24 or newer from https://nodejs.org/
pause
exit /b 1
:run
"%ML_NODE%" scripts\start.mjs
if errorlevel 1 pause

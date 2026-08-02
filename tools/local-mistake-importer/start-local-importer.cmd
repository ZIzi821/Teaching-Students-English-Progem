@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js was not found. Please install Node.js or run this tool from Codex.
  pause
  exit /b 1
)

node server.js
if errorlevel 1 pause

@echo off
rem Hunt Gov Pk - run the site locally with live refresh. Needs Python 3.8+ (no packages).
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^).
  pause
  exit /b 1
)
python serve.py %*
pause

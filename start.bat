@echo off
setlocal
cd /d "%~dp0"
title BitGroove Music Player
set "BITGROOVE_HOST=0.0.0.0"
powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*server.py*' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }"
echo ========================================================
echo   BitGroove Music Player (BitChord Edition)
echo ========================================================
echo   Local: http://localhost:3000
echo   Phone: use this computer's LAN IPv4 address
echo.
start "" http://localhost:3000
python server.py
pause

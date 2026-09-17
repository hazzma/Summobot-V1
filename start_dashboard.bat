@echo off
cd /d "%~dp0"
title Summobot V1 Studio Launcher
echo ========================================================
echo   SUMMOBOT V1 - TUNING & LOGGING STUDIO
echo ========================================================
echo.
echo Direktori Kerja: %CD%
echo.
echo [1/2] Membuka Dashboard di Browser...
start "" "http://localhost:8080/web/index.html"
echo.
echo [2/2] Menjalankan server lokal di port 8080...
echo       (Web Bluetooth & Web Serial membutuhkan localhost / HTTPS)
echo.
echo Tekan Ctrl+C untuk mematikan server.
echo ========================================================
echo.
python -m http.server 8080
pause

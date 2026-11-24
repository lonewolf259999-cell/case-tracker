@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Case Tracker

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] ไม่พบ Node.js - กรุณาติดตั้ง Node.js 20 ขึ้นไป
  pause
  exit /b 1
)

if not exist ".env" (
  echo [ERROR] ไม่พบไฟล์ .env
  pause
  exit /b 1
)

netstat -ano | findstr /C:":3000 " | findstr /C:"LISTENING" >nul
if not errorlevel 1 (
  echo มีเซิร์ฟเวอร์รันอยู่แล้วที่ http://localhost:3000
  start "" "http://localhost:3000"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

if not exist "node_modules\" (
  echo กำลังติดตั้ง dependencies...
  call npm install
  if errorlevel 1 goto fail
)

echo กำลังเริ่มเซิร์ฟเวอร์...
echo http://localhost:3000
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:3000'"
call npm run dev
goto done

:fail
echo.
echo [ERROR] เริ่มเซิร์ฟเวอร์ไม่สำเร็จ

:done
pause

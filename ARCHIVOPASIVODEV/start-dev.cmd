@echo off
cd /d C:\apps\ARCHIVOPASIVODEV
call "C:\Program Files\nodejs\npm.cmd" run build
if errorlevel 1 pause & exit /b 1
call pm2 describe archivopasivo-dev >nul 2>&1
if errorlevel 1 (
  call pm2 start ecosystem.config.cjs
) else (
  call pm2 restart archivopasivo-dev --update-env
)
call pm2 save
echo DEV: http://192.168.0.21:4001
pause

@echo off
REM ═══════════════════════════════════════════════════════════════
REM  deploy-prod.cmd — apifront
REM  Uso: doble click o desde cmd
REM  Rollback: deploy-prod.cmd rollback
REM ═══════════════════════════════════════════════════════════════
set SRC=C:\apps\personaldev\apifront
set DST=C:\apps\personalprod\apifront-prod
set BCK=C:\apps\personalback\apifront-backup
set LOG=C:\apps\logs\deploy-apifront.log
set NPM="C:\Program Files\nodejs\npm.cmd"

if not exist "C:\apps\logs" mkdir "C:\apps\logs"

REM ── ROLLBACK ────────────────────────────────────────────────────
if "%1"=="rollback" (
  echo [%date% %time%] ROLLBACK iniciado >> %LOG%
  if not exist "%BCK%" (
    echo ❌ No hay backup para rollback.
    pause & exit /b 1
  )
  pm2 stop apifront-prod
  if exist "%DST%" rmdir /s /q "%DST%"
  robocopy "%BCK%" "%DST%" /MIR /XD node_modules /NFL /NDL
  pm2 start "%DST%\ecosystem.config.cjs"
  echo ✅ Rollback completado.
  echo [%date% %time%] ROLLBACK completado >> %LOG%
  pause & exit /b 0
)

REM ── DEPLOY ──────────────────────────────────────────────────────
echo [%date% %time%] Deploy iniciado >> %LOG%
echo.
echo ════════════════════════════════════════
echo   DEPLOY apifront → PRODUCCION
echo ════════════════════════════════════════

REM 1. Build en source
echo [1/5] Instalando dependencias...
cd /d %SRC%
call %NPM% install >> %LOG% 2>&1
if errorlevel 1 ( echo ❌ npm install falló. Ver %LOG% & pause & exit /b 1 )

echo [2/5] Compilando frontend...
call %NPM% run build >> %LOG% 2>&1
if errorlevel 1 ( echo ❌ Build falló. Ver %LOG% & pause & exit /b 1 )

REM 2. Backup
echo [3/5] Guardando backup...
if exist "%DST%" (
  if exist "%BCK%" rmdir /s /q "%BCK%"
  robocopy "%DST%" "%BCK%" /MIR /XD node_modules /NFL /NDL >> %LOG% 2>&1
  echo    Backup guardado en %BCK%
)

REM 3. Copiar al destino
echo [4/5] Copiando archivos...
if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%\dist"   "%DST%\dist"   /MIR /NFL /NDL >> %LOG% 2>&1
robocopy "%SRC%\public" "%DST%\public" /MIR /NFL /NDL >> %LOG% 2>&1
copy /Y "%SRC%\package.json"         "%DST%\package.json"         >> %LOG% 2>&1
copy /Y "%SRC%\package-lock.json"    "%DST%\package-lock.json"    >> %LOG% 2>&1
copy /Y "%SRC%\ecosystem.config.cjs" "%DST%\ecosystem.config.cjs" >> %LOG% 2>&1

REM 4. Inyectar runtime-config de producción en dist/
(echo {"apiBaseUrl":"http://192.168.0.21:3001/api/v1","scannerApiUrl":"http://192.168.0.21:3002","scannerTenantId":"1"}) > "%DST%\dist\runtime-config.json"

REM 5. Instalar dependencias y reiniciar PM2
echo [5/5] Reiniciando servicio...
cd /d "%DST%"
if exist node_modules rmdir /s /q node_modules
call %NPM% install >> %LOG% 2>&1

pm2 describe apifront-prod >nul 2>&1
if errorlevel 1 (
  pm2 start "%DST%\ecosystem.config.cjs"
) else (
  pm2 restart apifront-prod
)
pm2 save >> %LOG% 2>&1

echo.
echo ════════════════════════════════════════
echo   ✅ Deploy completado exitosamente
echo   Puerto: 5173
echo   URL:    http://192.168.0.21:5173
echo   Logs:   pm2 logs apifront-prod
echo   Rollback: deploy-prod.cmd rollback
echo ════════════════════════════════════════
echo [%date% %time%] Deploy completado OK >> %LOG%
pause

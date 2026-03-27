@echo off
REM ═══════════════════════════════════════════════════════════════
REM  deploy-prod.cmd — api_personal
REM  Uso: doble click o desde cmd
REM  Rollback: deploy-prod.cmd rollback
REM ═══════════════════════════════════════════════════════════════
set SRC=C:\apps\personaldev\apipersonal
set DST=C:\apps\personalprod\apipersonal-prod
set BCK=C:\apps\personalback\apipersonal-backup
set LOG=C:\apps\logs\deploy-apipersonal.log
set NPM="C:\Program Files\nodejs\npm.cmd"

if not exist "C:\apps\logs" mkdir "C:\apps\logs"

REM ── ROLLBACK ────────────────────────────────────────────────────
if "%1"=="rollback" (
  echo [%date% %time%] ROLLBACK iniciado >> %LOG%
  if not exist "%BCK%" (
    echo ❌ No hay backup para rollback.
    pause & exit /b 1
  )
  pm2 stop apipersonal-prod
  if exist "%DST%" rmdir /s /q "%DST%"
  robocopy "%BCK%" "%DST%" /MIR /NFL /NDL
  pm2 start "%DST%\ecosystem.config.js"
  echo ✅ Rollback completado.
  echo [%date% %time%] ROLLBACK completado >> %LOG%
  pause & exit /b 0
)

REM ── DEPLOY ──────────────────────────────────────────────────────
echo [%date% %time%] Deploy iniciado >> %LOG%
echo.
echo ════════════════════════════════════════
echo   DEPLOY api_personal → PRODUCCION
echo ════════════════════════════════════════

REM 1. Build en source
echo [1/6] Instalando dependencias...
cd /d %SRC%
set NODE_ENV=development
call %NPM% install >> %LOG% 2>&1
if errorlevel 1 ( echo ❌ npm install falló. Ver %LOG% & pause & exit /b 1 )

echo [2/6] Compilando TypeScript...
call %NPM% run build >> %LOG% 2>&1
if errorlevel 1 ( echo ❌ Build falló. Ver %LOG% & pause & exit /b 1 )

REM 2. Backup de la versión anterior
echo [3/6] Guardando backup...
if exist "%DST%" (
  if exist "%BCK%" rmdir /s /q "%BCK%"
  robocopy "%DST%" "%BCK%" /MIR /XD node_modules /NFL /NDL >> %LOG% 2>&1
  echo    Backup guardado en %BCK%
)

REM 3. Copiar al destino
echo [4/6] Copiando archivos...
if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%" "%DST%" /MIR /XD node_modules .git /NFL /NDL >> %LOG% 2>&1

REM 4. Aplicar .env de producción
echo [5/6] Aplicando configuración de producción...
if exist "%SRC%\.env.production" (
  copy /Y "%SRC%\.env.production" "%DST%\.env" >> %LOG% 2>&1
) else (
  echo ⚠️  No se encontró .env.production — usando .env del source
  copy /Y "%SRC%\.env" "%DST%\.env" >> %LOG% 2>&1
)

REM Copiar ecosystem config
copy /Y "%SRC%\ecosystem.config.js" "%DST%\ecosystem.config.js" >> %LOG% 2>&1

REM 5. Instalar solo prod dependencies
echo [6/6] Instalando dependencias de producción...
cd /d "%DST%"
set NODE_ENV=production
if exist node_modules rmdir /s /q node_modules
call %NPM% install >> %LOG% 2>&1
if errorlevel 1 ( echo ❌ npm install prod falló. Ver %LOG% & pause & exit /b 1 )

REM 6. Reiniciar con PM2
echo.
echo Reiniciando servicio...
pm2 describe apipersonal-prod >nul 2>&1
if errorlevel 1 (
  pm2 start "%DST%\ecosystem.config.js"
) else (
  pm2 restart apipersonal-prod
)
pm2 save >> %LOG% 2>&1

echo.
echo ════════════════════════════════════════
echo   ✅ Deploy completado exitosamente
echo   Puerto: 3001
echo   Logs:   pm2 logs apipersonal-prod
echo   Rollback: deploy-prod.cmd rollback
echo ════════════════════════════════════════
echo [%date% %time%] Deploy completado OK >> %LOG%
pause

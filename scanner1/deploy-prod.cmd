@echo off
REM ═══════════════════════════════════════════════════════════════
REM  deploy-prod.cmd — scanner1
REM  Uso: doble click o desde cmd
REM  Rollback: deploy-prod.cmd rollback
REM ═══════════════════════════════════════════════════════════════
set SRC=C:\apps\scanner1
set DST=C:\apps\scanner1-prod
set BCK=C:\apps\scanner1-backup
set LOG=C:\apps\logs\deploy-scanner.log
set NPM="C:\Program Files\nodejs\npm.cmd"

if not exist "C:\apps\logs" mkdir "C:\apps\logs"

REM ── ROLLBACK ────────────────────────────────────────────────────
if "%1"=="rollback" (
  echo [%date% %time%] ROLLBACK iniciado >> %LOG%
  if not exist "%BCK%" (
    echo ❌ No hay backup para rollback.
    pause & exit /b 1
  )
  pm2 stop scanner-api-prod
  pm2 stop scanner-agent-prod
  if exist "%DST%" rmdir /s /q "%DST%"
  robocopy "%BCK%" "%DST%" /MIR /XD node_modules /NFL /NDL
  pm2 start "%DST%\ecosystem.config.js"
  echo ✅ Rollback completado.
  echo [%date% %time%] ROLLBACK completado >> %LOG%
  pause & exit /b 0
)

REM ── DEPLOY ──────────────────────────────────────────────────────
echo [%date% %time%] Deploy iniciado >> %LOG%
echo.
echo ════════════════════════════════════════
echo   DEPLOY scanner1 → PRODUCCION
echo ════════════════════════════════════════

REM 1. Build API
echo [1/7] Build scanner API...
cd /d "%SRC%\api"
set NODE_ENV=development
call %NPM% install >> %LOG% 2>&1
call %NPM% run build >> %LOG% 2>&1
if errorlevel 1 ( echo ❌ Build API falló. Ver %LOG% & pause & exit /b 1 )

REM 2. Build Agent
echo [2/7] Build scanner Agent...
cd /d "%SRC%\agent"
call %NPM% install >> %LOG% 2>&1
call %NPM% run build >> %LOG% 2>&1
if errorlevel 1 ( echo ❌ Build Agent falló. Ver %LOG% & pause & exit /b 1 )

REM 3. Backup
echo [3/7] Guardando backup...
if exist "%DST%" (
  if exist "%BCK%" rmdir /s /q "%BCK%"
  robocopy "%DST%" "%BCK%" /MIR /XD node_modules /NFL /NDL >> %LOG% 2>&1
  echo    Backup guardado en %BCK%
)

REM 4. Copiar al destino
echo [4/7] Copiando archivos...
if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%" "%DST%" /MIR /XD node_modules .git storage /NFL /NDL >> %LOG% 2>&1

REM 5. Aplicar .env de producción
echo [5/7] Aplicando configuración de producción...
copy /Y "%SRC%\.env.production"       "%DST%\.env"        >> %LOG% 2>&1
copy /Y "%SRC%\agent\.env.production" "%DST%\agent\.env"  >> %LOG% 2>&1
copy /Y "%SRC%\ecosystem.config.js"   "%DST%\ecosystem.config.js" >> %LOG% 2>&1

REM 6. Instalar dependencias
echo [6/7] Instalando dependencias...
cd /d "%DST%"
set NODE_ENV=development
call %NPM% install >> %LOG% 2>&1
if errorlevel 1 ( echo ❌ npm install falló. Ver %LOG% & pause & exit /b 1 )

REM 7. Reiniciar con PM2
echo [7/7] Reiniciando servicios...
pm2 describe scanner-api-prod >nul 2>&1
if errorlevel 1 (
  pm2 start "%DST%\ecosystem.config.js"
) else (
  pm2 restart "%DST%\ecosystem.config.js" --only scanner-api-prod,scanner-agent-prod --update-env
)

echo.
echo ════════════════════════════════════════
echo   ✅ Deploy completado exitosamente
echo   scanner-api:   puerto 3002
echo   scanner-agent: conecta a 3002
echo   Logs:   pm2 logs scanner-api-prod
echo   Rollback: deploy-prod.cmd rollback
echo ════════════════════════════════════════
echo [%date% %time%] Deploy completado OK >> %LOG%
pause

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

REM 0. Generar .env.production desde .env (cambia solo NODE_ENV)
echo [0/6] Generando .env.production...
cd /d %SRC%
powershell -Command "(Get-Content '%SRC%\.env') -replace '^NODE_ENV=.*','NODE_ENV=production' | Set-Content '%SRC%\.env.production'"
echo    .env.production generado OK

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

REM 3. Copiar dist + archivos necesarios (NO el .env ni node_modules)
echo [4/6] Copiando archivos compilados...
if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%\dist"         "%DST%\dist"         /MIR /NFL /NDL >> %LOG% 2>&1
robocopy "%SRC%\scripts"      "%DST%\scripts"      /MIR /NFL /NDL >> %LOG% 2>&1
robocopy "%SRC%\src\templates" "%DST%\templates"   /MIR /NFL /NDL >> %LOG% 2>&1
copy /Y "%SRC%\package.json"        "%DST%\package.json"        >> %LOG% 2>&1
copy /Y "%SRC%\package-lock.json"   "%DST%\package-lock.json"   >> %LOG% 2>&1
copy /Y "%SRC%\ecosystem.config.js" "%DST%\ecosystem.config.js" >> %LOG% 2>&1

REM 4. Aplicar .env de producción (SIEMPRE desde .env.production, nunca el dev .env)
echo [5/6] Aplicando configuración de producción...
if exist "%SRC%\.env.production" (
  copy /Y "%SRC%\.env.production" "%DST%\.env" >> %LOG% 2>&1
  echo    .env.production aplicado OK
) else (
  echo ❌ Falta .env.production en %SRC% — abortando
  pause & exit /b 1
)

REM 5. Instalar dependencias solo si package.json cambió
echo [6/6] Instalando dependencias de producción...
cd /d "%DST%"
set NODE_ENV=production
if not exist node_modules (
  call %NPM% install --omit=dev >> %LOG% 2>&1
  if errorlevel 1 ( echo ❌ npm install prod falló. Ver %LOG% & pause & exit /b 1 )
) else (
  echo    node_modules ya existe, omitiendo reinstalación
)

REM 6. Reiniciar prod con PM2
echo.
echo Reiniciando servicio PROD...
pm2 describe apipersonal-prod >nul 2>&1
if errorlevel 1 (
  pm2 start "%DST%\ecosystem.config.js"
) else (
  pm2 restart apipersonal-prod --update-env
)

REM 7. Reiniciar también el DEV para que tome el nuevo .env
echo Reiniciando servicio DEV (para recargar .env)...
pm2 describe apipersonal-dev >nul 2>&1
if not errorlevel 1 (
  pm2 restart apipersonal-dev --update-env
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

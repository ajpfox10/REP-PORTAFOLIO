@echo off
REM ================================================================
REM  deploy-prod.cmd - api_personal
REM  Uso: doble click o desde cmd
REM  Rollback: deploy-prod.cmd rollback
REM ================================================================
set SRC=C:\apps\personaldev\apipersonal
set DST=C:\apps\personalprod\apipersonal-prod
set BCK=C:\apps\personalback\apipersonal-backup
set LOG=C:\apps\logs\deploy-apipersonal.log
set NPM="C:\Program Files\nodejs\npm.cmd"
REM Reinicio sin huerfanos (pm2 en Windows deja procesos viejos con el puerto)
set REINICIO=powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%\scripts\pm2-reinicio-limpio.ps1"

if not exist "C:\apps\logs" mkdir "C:\apps\logs"

REM -- ROLLBACK ----------------------------------------------------
if "%1"=="rollback" (
  echo [%date% %time%] ROLLBACK iniciado >> %LOG%
  if not exist "%BCK%" (
    echo ERROR: No hay backup para rollback.
    pause & exit /b 1
  )
  call pm2 stop apipersonal-prod
  if exist "%DST%" rmdir /s /q "%DST%"
  robocopy "%BCK%" "%DST%" /MIR /NFL /NDL
  REM el backup no guarda node_modules: reinstalar las dependencias de esa version
  cd /d "%DST%"
  set NODE_ENV=production
  call %NPM% install --omit=dev >> %LOG% 2>&1
  if errorlevel 1 ( echo ERROR: npm install del rollback fallo. Ver %LOG% & pause & exit /b 1 )
  call pm2 describe apipersonal-prod >nul 2>&1
  if errorlevel 1 ( call pm2 start "%DST%\ecosystem.config.js" ) else ( %REINICIO% -App apipersonal-prod -Puerto 3001 )
  if errorlevel 1 ( echo ERROR: prod no quedo escuchando el 3001. Ver pm2 logs apipersonal-prod & pause & exit /b 1 )
  echo OK: Rollback completado.
  echo [%date% %time%] ROLLBACK completado >> %LOG%
  pause & exit /b 0
)

REM -- DEPLOY ------------------------------------------------------
echo [%date% %time%] Deploy iniciado >> %LOG%
echo.
echo ================================================================
echo   DEPLOY api_personal - PRODUCCION
echo ================================================================

REM 0. Generar .env.production desde .env (cambia NODE_ENV y fuerza la base de PROD)
REM    Dev usa su propia base (personalv5_dev); prod SIEMPRE personalv5.
echo [0/6] Generando .env.production...
cd /d %SRC%
powershell -Command "(Get-Content '%SRC%\.env') -replace '^NODE_ENV=.*','NODE_ENV=production' -replace '^FICHERO_SUBIDA_DESHABILITADA=.*','FICHERO_SUBIDA_DESHABILITADA=0' -replace '^DB_NAME=.*','DB_NAME=personalv5' -replace '^MIGRATIONS_ENABLE=.*','MIGRATIONS_ENABLE=true' | Set-Content '%SRC%\.env.production'"
REM    Secretos propios de prod (JWT, base): viven fuera de dev, en C:\apps\personalprod\secretos-prod.env
"C:\Program Files\nodejs\node.exe" "%SRC%\scripts\aplicar-secretos-prod.cjs" "%SRC%\.env.production" "C:\apps\personalprod\secretos-prod.env"
if errorlevel 1 ( echo ERROR: no se pudieron aplicar los secretos de prod - abortando & pause & exit /b 1 )
findstr /B /C:"DB_NAME=personalv5" "%SRC%\.env.production" | findstr /V /C:"personalv5_" >nul
if errorlevel 1 ( echo ERROR: .env.production no quedo con DB_NAME=personalv5 - abortando & pause & exit /b 1 )
echo    .env.production generado OK ^(DB_NAME=personalv5^)

REM 1. Build en source
echo [1/6] Instalando dependencias...
cd /d %SRC%
set NODE_ENV=development
call %NPM% install >> %LOG% 2>&1
if errorlevel 1 ( echo ERROR: npm install fallo. Ver %LOG% & pause & exit /b 1 )

echo [2/6] Compilando TypeScript...
call %NPM% run build >> %LOG% 2>&1
if errorlevel 1 ( echo ERROR: Build fallo. Ver %LOG% & pause & exit /b 1 )

REM 2. Backup de la version anterior
echo [3/6] Guardando backup...
if exist "%DST%" (
  if exist "%BCK%" rmdir /s /q "%BCK%"
  robocopy "%DST%" "%BCK%" /MIR /XD node_modules /NFL /NDL >> %LOG% 2>&1
  echo    Backup guardado en %BCK%
)

REM 3. Copiar dist + archivos necesarios (NO el .env ni node_modules)
echo [4/6] Copiando archivos compilados...
if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%\dist"          "%DST%\dist"       /MIR /NFL /NDL >> %LOG% 2>&1
REM scripts: sin pisar/borrar los logs que generan los robots en prod
robocopy "%SRC%\scripts"       "%DST%\scripts"    /MIR /XD logs __pycache__ /XF *.log /NFL /NDL >> %LOG% 2>&1
robocopy "%SRC%\src\templates" "%DST%\templates"  /MIR /NFL /NDL >> %LOG% 2>&1
robocopy "%SRC%\assets"        "%DST%\assets"     /MIR /NFL /NDL >> %LOG% 2>&1
copy /Y "%SRC%\package.json"        "%DST%\package.json"        >> %LOG% 2>&1
copy /Y "%SRC%\package-lock.json"   "%DST%\package-lock.json"   >> %LOG% 2>&1
copy /Y "%SRC%\ecosystem.config.js" "%DST%\ecosystem.config.js" >> %LOG% 2>&1

REM 4. Aplicar .env de produccion (SIEMPRE desde .env.production, nunca el dev .env)
echo [5/6] Aplicando configuracion de produccion...
if exist "%SRC%\.env.production" (
  copy /Y "%SRC%\.env.production" "%DST%\.env" >> %LOG% 2>&1
  if errorlevel 1 ( echo ERROR: no se pudo copiar el .env a prod - abortando & pause & exit /b 1 )
  REM tiene los secretos de prod: no se deja en la carpeta de dev
  del /f /q "%SRC%\.env.production" >nul 2>&1
  echo    .env.production aplicado OK
) else (
  echo ERROR: Falta .env.production en %SRC% - abortando
  pause & exit /b 1
)

REM 4b. Robots programados -> scripts de PROD (leen el .env de prod = base personalv5)
echo [5b] Pasando tareas programadas a los scripts de prod...
set TAREAS_OK=0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%\scripts\repuntar-tareas-prod.ps1"
if not errorlevel 1 set TAREAS_OK=1
if "%TAREAS_OK%"=="0" echo    AVISO: alguna tarea no se pudo pasar a prod; el .env de dev NO se cambia de base.

REM 5. Instalar dependencias solo si package.json cambio
echo [6/6] Instalando dependencias de produccion...
cd /d "%DST%"
set NODE_ENV=production
REM Reinstala si no hay node_modules o si cambio el package-lock (p.ej. arreglos de npm audit).
REM Se frena prod antes: con el proceso vivo los .node nativos quedan bloqueados (EPERM).
set DEPS=0
if not exist node_modules set DEPS=1
fc /b "%SRC%\package-lock.json" "%BCK%\package-lock.json" >nul 2>&1
if errorlevel 1 set DEPS=1
if "%DEPS%"=="1" (
  echo    package-lock cambio: frenando prod e instalando dependencias...
  call pm2 stop apipersonal-prod >> %LOG% 2>&1
  call %NPM% install --omit=dev >> %LOG% 2>&1
  if errorlevel 1 ( echo ERROR: npm install prod fallo. Ver %LOG% - Rollback: deploy-prod.cmd rollback & pause & exit /b 1 )
  echo    dependencias de prod actualizadas
) else (
  echo    dependencias sin cambios, omitiendo reinstalacion
)

REM 6. Borrar schema cache de prod para que regenere con las tablas nuevas
echo [6b] Borrando schema cache de prod...
if exist "%DST%\.cache\schema.json" del /f /q "%DST%\.cache\schema.json"
echo    Schema cache borrado OK

REM 6. Reiniciar prod con PM2
echo.
echo Reiniciando servicio PROD...
call pm2 describe apipersonal-prod >nul 2>&1
if errorlevel 1 (
  call pm2 start "%DST%\ecosystem.config.js"
) else (
  %REINICIO% -App apipersonal-prod -Puerto 3001
)
if errorlevel 1 (
  echo.
  echo ERROR: prod no quedo escuchando el 3001. El deploy NO esta activo.
  echo        Ver: pm2 logs apipersonal-prod   ^|   Rollback: deploy-prod.cmd rollback
  echo [%date% %time%] Deploy FALLO al reiniciar prod >> %LOG%
  pause & exit /b 1
)

REM 6c. Pagina publica de la Agenda de turnos (otro proceso pm2, puerto 3011): que tome el codigo nuevo.
REM     El tunel (turnos-tunel-prod) NO se reinicia a proposito: si se reinicia cambia la direccion y
REM     dejan de abrir los enlaces ya enviados a los agentes.
call pm2 describe turnos-publico-prod >nul 2>&1
if not errorlevel 1 (
  echo Reiniciando pagina publica de turnos...
  %REINICIO% -App turnos-publico-prod -Puerto 3011
  if errorlevel 1 echo    AVISO: la pagina de turnos no quedo escuchando el 3011 ^(la API prod esta bien^). Ver pm2 logs turnos-publico-prod
)

REM 7a. Dev a su propia base (personalv5_dev), solo si los robots ya quedaron en prod
if "%TAREAS_OK%"=="1" (
  echo Apuntando DEV a la base personalv5_dev...
  "C:\Program Files\nodejs\node.exe" "%SRC%\scripts\env-dev-a-base-dev.cjs" "%SRC%\.env"
)

REM 7. Reiniciar tambien el DEV para que tome el nuevo .env
echo Reiniciando servicio DEV (para recargar .env)...
call pm2 describe apipersonal-dev >nul 2>&1
if not errorlevel 1 (
  %REINICIO% -App apipersonal-dev -Puerto 3000
  if errorlevel 1 echo    AVISO: dev no quedo escuchando el 3000 ^(prod esta bien^). Ver pm2 logs apipersonal-dev
)

call pm2 save >> %LOG% 2>&1

echo.
echo ================================================================
echo   OK: Deploy completado exitosamente
echo   Puerto: 3001
echo   Logs:   pm2 logs apipersonal-prod
echo   Rollback: deploy-prod.cmd rollback
echo ================================================================
echo [%date% %time%] Deploy completado OK >> %LOG%
pause

@echo off
setlocal

REM ================================================================
REM  deploy-prod.cmd - Archivo Pasivo
REM  Uso: doble click o desde cmd
REM  Rollback: deploy-prod.cmd rollback
REM ================================================================
set "SRC=C:\apps\ARCHIVOPASIVODEV"
set "DST=C:\apps\ARCHIVOPASIVO"
set "BCK=C:\apps\personalback\archivopasivo-backup"
set "LOG=C:\apps\logs\deploy-archivopasivo.log"
set "NPM=C:\Program Files\nodejs\npm.cmd"

if not exist "C:\apps\logs" mkdir "C:\apps\logs"

if /I "%~1"=="rollback" (
  echo [%date% %time%] ROLLBACK iniciado>>"%LOG%"
  if not exist "%BCK%" (
    echo ERROR: No hay backup para rollback.
    pause
    exit /b 1
  )
  call pm2 stop archivopasivo-prod
  if exist "%DST%" rmdir /s /q "%DST%"
  robocopy "%BCK%" "%DST%" /MIR /XD node_modules .git .chrome-debug design-previews /NFL /NDL /R:2 /W:2 >>"%LOG%" 2>&1
  call pm2 start "%DST%\ecosystem.config.cjs"
  call pm2 save >>"%LOG%" 2>&1
  echo OK: Rollback completado.
  echo [%date% %time%] ROLLBACK completado>>"%LOG%"
  pause
  exit /b 0
)

echo [%date% %time%] Deploy iniciado>>"%LOG%"
echo.
echo ================================================================
echo   DEPLOY Archivo Pasivo - PRODUCCION
echo ================================================================

echo [1/6] Instalando dependencias en DEV...
cd /d "%SRC%"
set "NODE_ENV=development"
call "%NPM%" install >>"%LOG%" 2>&1
if errorlevel 1 ( echo ERROR: npm install fallo. Ver %LOG% & pause & exit /b 1 )

echo [2/6] Compilando app...
call "%NPM%" run build >>"%LOG%" 2>&1
if errorlevel 1 ( echo ERROR: build fallo. Ver %LOG% & pause & exit /b 1 )

echo [3/6] Guardando backup de PROD...
if exist "%DST%" (
  if exist "%BCK%" rmdir /s /q "%BCK%"
  robocopy "%DST%" "%BCK%" /MIR /XD node_modules .git .chrome-debug design-previews /NFL /NDL /R:2 /W:2 >>"%LOG%" 2>&1
  if errorlevel 8 ( echo ERROR: backup fallo. Ver %LOG% & pause & exit /b 1 )
)

echo [4/6] Copiando archivos a PROD...
if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%\dist" "%DST%\dist" /MIR /NFL /NDL /R:2 /W:2 >>"%LOG%" 2>&1
if errorlevel 8 ( echo ERROR: copia dist fallo. Ver %LOG% & pause & exit /b 1 )
robocopy "%SRC%\scripts" "%DST%\scripts" /MIR /NFL /NDL /R:2 /W:2 >>"%LOG%" 2>&1
if errorlevel 8 ( echo ERROR: copia scripts fallo. Ver %LOG% & pause & exit /b 1 )
robocopy "%SRC%\database" "%DST%\database" /MIR /NFL /NDL /R:2 /W:2 >>"%LOG%" 2>&1
if errorlevel 8 ( echo ERROR: copia database fallo. Ver %LOG% & pause & exit /b 1 )
copy /Y "%SRC%\package.json" "%DST%\package.json" >>"%LOG%" 2>&1
copy /Y "%SRC%\package-lock.json" "%DST%\package-lock.json" >>"%LOG%" 2>&1
copy /Y "%SRC%\tsconfig.json" "%DST%\tsconfig.json" >>"%LOG%" 2>&1
copy /Y "%SRC%\ecosystem.prod.config.cjs" "%DST%\ecosystem.config.cjs" >>"%LOG%" 2>&1

echo [5/6] Aplicando .env de produccion...
copy /Y "%SRC%\.env.production" "%DST%\.env" >>"%LOG%" 2>&1
if errorlevel 1 ( echo ERROR: falta .env.production. Ver %LOG% & pause & exit /b 1 )

echo [6/6] Instalando dependencias PROD y reiniciando PM2...
cd /d "%DST%"
set "NODE_ENV=production"
if not exist node_modules (
  call "%NPM%" install --omit=dev >>"%LOG%" 2>&1
  if errorlevel 1 ( echo ERROR: npm install prod fallo. Ver %LOG% & pause & exit /b 1 )
) else (
  echo    node_modules ya existe, omitiendo reinstalacion
)

call pm2 describe archivopasivo-prod >nul 2>&1
if errorlevel 1 (
  call pm2 start "%DST%\ecosystem.config.cjs"
) else (
  call pm2 restart archivopasivo-prod --update-env
)
if errorlevel 1 ( echo ERROR: PM2 fallo. Ver %LOG% & pause & exit /b 1 )

call pm2 save >>"%LOG%" 2>&1

echo.
echo ================================================================
echo   OK: Deploy completado exitosamente
echo   DEV:  http://192.168.0.21:4001
echo   PROD: http://192.168.0.21:4002
echo   Logs: pm2 logs archivopasivo-prod
echo   Rollback: deploy-prod.cmd rollback
echo ================================================================
echo [%date% %time%] Deploy completado OK>>"%LOG%"
pause

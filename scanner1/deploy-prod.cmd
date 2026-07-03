@echo off
setlocal

REM deploy-prod.cmd - scanner1
REM Uso: deploy-prod.cmd
REM Rollback: deploy-prod.cmd rollback

set "SRC=C:\apps\personaldev\scanner1"
set "DST=C:\apps\personalprod\scanner1-prod"
set "BCK=C:\apps\personalback\scanner1-backup"
set "LOG=C:\apps\logs\deploy-scanner.log"
set "NPM=C:\Program Files\nodejs\npm.cmd"

if not exist "C:\apps\logs" mkdir "C:\apps\logs"

if /I "%~1"=="rollback" (
  echo [%date% %time%] ROLLBACK iniciado>>"%LOG%"
  if not exist "%BCK%" (
    echo ERROR: No hay backup para rollback.
    exit /b 1
  )
  call pm2 stop scanner-api-prod
  call pm2 stop scanner-agent-prod
  if exist "%DST%" rmdir /s /q "%DST%"
  robocopy "%BCK%" "%DST%" /MIR /XD node_modules /NFL /NDL /R:2 /W:2 >>"%LOG%" 2>&1
  call pm2 start "%DST%\ecosystem.config.js"
  echo [%date% %time%] ROLLBACK completado>>"%LOG%"
  echo Rollback completado.
  exit /b 0
)

echo [%date% %time%] Deploy iniciado>>"%LOG%"
echo DEPLOY scanner1 a PRODUCCION

echo [1/7] Build scanner API...
cd /d "%SRC%\api"
set "NODE_ENV=development"
call "%NPM%" install >>"%LOG%" 2>&1
if errorlevel 1 exit /b 1
call "%NPM%" run build >>"%LOG%" 2>&1
if errorlevel 1 exit /b 1

echo [2/7] Build scanner Agent...
cd /d "%SRC%\agent"
call "%NPM%" install >>"%LOG%" 2>&1
if errorlevel 1 exit /b 1
call "%NPM%" run build >>"%LOG%" 2>&1
if errorlevel 1 exit /b 1

echo [3/7] Guardando backup...
if exist "%DST%" (
  if exist "%BCK%" rmdir /s /q "%BCK%"
  robocopy "%DST%" "%BCK%" /MIR /XD node_modules /NFL /NDL /R:2 /W:2 >>"%LOG%" 2>&1
  if errorlevel 8 exit /b 1
)

echo [4/7] Copiando archivos...
if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%" "%DST%" /MIR /XD node_modules .git storage /NFL /NDL /R:2 /W:2 >>"%LOG%" 2>&1
if errorlevel 8 exit /b 1

echo [5/7] Aplicando configuracion de produccion...
copy /Y "%SRC%\.env.production" "%DST%\.env" >>"%LOG%" 2>&1
if errorlevel 1 exit /b 1
copy /Y "%SRC%\agent\.env.production" "%DST%\agent\.env" >>"%LOG%" 2>&1
if errorlevel 1 exit /b 1
copy /Y "%SRC%\ecosystem.config.js" "%DST%\ecosystem.config.js" >>"%LOG%" 2>&1
if errorlevel 1 exit /b 1

echo [6/7] Instalando dependencias...
cd /d "%DST%"
set "NODE_ENV=development"
call "%NPM%" install >>"%LOG%" 2>&1
if errorlevel 1 exit /b 1

echo [7/7] Reiniciando servicios...
call pm2 describe scanner-api-prod >nul 2>&1
if errorlevel 1 (
  call pm2 start "%DST%\ecosystem.config.js"
) else (
  call pm2 restart "%DST%\ecosystem.config.js" --only scanner-api-prod,scanner-agent-prod --update-env
)
if errorlevel 1 exit /b 1

echo [%date% %time%] Deploy completado OK>>"%LOG%"
echo Deploy completado exitosamente.
exit /b 0

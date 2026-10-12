@echo off
REM ================================================================
REM  deploy-prod.cmd - Farmacia Carga de Stock
REM  Pasa el codigo de DEV (C:\apps\farmacia\carga-stock) a PROD
REM  (C:\apps\farmacia\carga-stock-prod). NO copia .env ni uploads ni logs.
REM  Puertos prod: backend 8310 / frontend 8410 (no cambian).
REM ================================================================
set SRC=C:\apps\farmacia\carga-stock
set DST=C:\apps\farmacia\carga-stock-prod
set LOG=C:\apps\logs\deploy-farmacia.log
set NPM="C:\Program Files\nodejs\npm.cmd"

if not exist "C:\apps\logs" mkdir "C:\apps\logs"
echo [%date% %time%] Deploy farmacia iniciado >> %LOG%

echo [1/4] Compilando frontend (usa frontend\.env.production = API :8310)...
cd /d "%SRC%\frontend"
call %NPM% run build >> %LOG% 2>&1
if errorlevel 1 ( echo ERROR: build del frontend fallo. Ver %LOG% & pause & exit /b 1 )

echo [2/4] Parando prod...
call pm2 stop farmacia-backend farmacia-frontend >nul 2>&1

echo [3/4] Copiando archivos...
robocopy "%SRC%\backend\src"     "%DST%\backend\src"     /MIR /R:1 /W:1 /NFL /NDL >> %LOG% 2>&1
robocopy "%SRC%\backend\scripts" "%DST%\backend\scripts" /MIR /R:1 /W:1 /NFL /NDL >> %LOG% 2>&1
robocopy "%SRC%\frontend\dist"   "%DST%\frontend\dist"   /MIR /R:1 /W:1 /NFL /NDL >> %LOG% 2>&1
fc /b "%SRC%\backend\package-lock.json"  "%DST%\backend\package-lock.json"  >nul 2>&1 || set BACK_DEPS=1
fc /b "%SRC%\frontend\package-lock.json" "%DST%\frontend\package-lock.json" >nul 2>&1 || set FRONT_DEPS=1
copy /Y "%SRC%\backend\package.json"       "%DST%\backend\package.json"       >> %LOG% 2>&1
copy /Y "%SRC%\backend\package-lock.json"  "%DST%\backend\package-lock.json"  >> %LOG% 2>&1
copy /Y "%SRC%\frontend\package.json"      "%DST%\frontend\package.json"      >> %LOG% 2>&1
copy /Y "%SRC%\frontend\package-lock.json" "%DST%\frontend\package-lock.json" >> %LOG% 2>&1

if defined BACK_DEPS (
  echo    Dependencias del backend cambiaron: npm ci...
  cd /d "%DST%\backend"
  call %NPM% ci --no-audit --no-fund >> %LOG% 2>&1
  if errorlevel 1 ( echo ERROR: npm ci backend fallo. Ver %LOG% & pause & exit /b 1 )
)
if defined FRONT_DEPS (
  echo    Dependencias del frontend cambiaron: npm ci...
  cd /d "%DST%\frontend"
  call %NPM% ci --no-audit --no-fund >> %LOG% 2>&1
  if errorlevel 1 ( echo ERROR: npm ci frontend fallo. Ver %LOG% & pause & exit /b 1 )
)

echo [4/4] Levantando prod...
call pm2 restart farmacia-backend farmacia-frontend >> %LOG% 2>&1
call pm2 save >> %LOG% 2>&1

echo OK: deploy farmacia completado. Front http://192.168.0.21:8410
echo [%date% %time%] Deploy farmacia completado OK >> %LOG%
pause

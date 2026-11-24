@echo off
REM ================================================================
REM  deploy-prod.cmd - apifront
REM  Uso: doble click o desde cmd
REM  Rollback: deploy-prod.cmd rollback
REM ================================================================
set SRC=C:\apps\personaldev\apifront
set DST=C:\apps\personalprod\apifront-prod
set BCK=C:\apps\personalback\apifront-backup
set LOG=C:\apps\logs\deploy-apifront.log
set NPM="C:\Program Files\nodejs\npm.cmd"

if not exist "C:\apps\logs" mkdir "C:\apps\logs"

REM Reinicio limpio (24/11/2026): exige que pm2 quede duenio del :5173; si queda un huerfano o cambia
REM NODE_ENV sale con error en vez de decir OK.
set REINICIO=powershell -NoProfile -ExecutionPolicy Bypass -File "C:\apps\personaldev\apipersonal\scripts\pm2-reinicio-limpio.ps1"

if "%1"=="rollback" goto ROLLBACK

REM -- DEPLOY ------------------------------------------------------
echo [%date% %time%] Deploy iniciado >> %LOG%
echo.
echo ================================================================
echo   DEPLOY apifront - PRODUCCION
echo ================================================================

REM 1. Build en source
echo [1/5] Instalando dependencias...
cd /d %SRC%
call %NPM% install >> %LOG% 2>&1
if errorlevel 1 ( echo ERROR: npm install fallo. Ver %LOG% & pause & exit /b 1 )

echo [2/5] Compilando frontend...
call %NPM% run build >> %LOG% 2>&1
if errorlevel 1 ( echo ERROR: Build fallo. Ver %LOG% & pause & exit /b 1 )

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

REM 4. Inyectar runtime-config de produccion en dist/
(echo {"apiBaseUrl":"http://192.168.0.21:3001/api/v1","scannerApiUrl":"http://192.168.0.21:3002","scannerTenantId":"1"}) > "%DST%\dist\runtime-config.json"

REM 5. Instalar dependencias y reiniciar PM2
echo [5/5] Reiniciando servicio...
cd /d "%DST%"
REM Parar antes de borrar: vite tiene tomado rollup.win32-x64-msvc.node y el npm install falla con EBUSY
call pm2 stop apifront-prod >nul 2>&1
REM En Windows "pm2 stop" a veces deja vivo el node de vite (huerfano): sigue con el :5173 y con
REM rollup tomado, y el rmdir de abajo falla. Se mata aca (solo si es node).
powershell -NoProfile -Command "Start-Sleep 2; Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Write-Output ('   Matando node colgado PID ' + $_); Stop-Process -Id $_ -Force } }" >> %LOG% 2>&1
if exist node_modules rmdir /s /q node_modules
if exist node_modules ( echo ERROR: no se pudo borrar node_modules ^(archivo tomado^). Ver %LOG% & echo [%date% %time%] ERROR rmdir node_modules >> %LOG% & pause & exit /b 1 )
call %NPM% install >> %LOG% 2>&1
if errorlevel 1 ( echo ERROR: npm install en prod fallo. Ver %LOG% & echo [%date% %time%] ERROR npm install prod >> %LOG% & pause & exit /b 1 )
if not exist "node_modules\vite\bin\vite.js" ( echo ERROR: falta vite en node_modules de prod. Ver %LOG% & pause & exit /b 1 )

call pm2 describe apifront-prod >nul 2>&1
if errorlevel 1 (
  call pm2 start "%DST%\ecosystem.config.cjs"
) else (
  %REINICIO% -App apifront-prod -Puerto 5173
  if errorlevel 1 ( echo ERROR: apifront-prod no quedo escuchando :5173 - revisar pm2 & echo [%date% %time%] ERROR reinicio apifront-prod >> %LOG% & pause & exit /b 1 )
)
call pm2 save >> %LOG% 2>&1

echo.
echo ================================================================
echo   OK: Deploy completado exitosamente
echo   Puerto: 5173
echo   URL:    http://192.168.0.21:5173
echo   Logs:   pm2 logs apifront-prod
echo   Rollback: deploy-prod.cmd rollback
echo ================================================================
echo [%date% %time%] Deploy completado OK >> %LOG%
pause
exit /b 0

REM -- ROLLBACK ----------------------------------------------------
REM Antes (hasta 24/11/2026) borraba %DST% entero y el backup no trae node_modules: prod quedaba sin
REM vite y el :5173 no levantaba. Ahora conserva node_modules y solo reinstala si cambio el lock.
:ROLLBACK
echo [%date% %time%] ROLLBACK iniciado >> %LOG%
if not exist "%BCK%\dist\index.html" ( echo ERROR: No hay backup para rollback en %BCK%. & pause & exit /b 1 )

echo [1/4] Parando apifront-prod...
call pm2 stop apifront-prod >nul 2>&1
powershell -NoProfile -Command "Start-Sleep 2; Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Write-Output ('   Matando node colgado PID ' + $_); Stop-Process -Id $_ -Force } }" >> %LOG% 2>&1

echo [2/4] Restaurando backup...
set ROLL_DEPS=
fc /b "%BCK%\package-lock.json" "%DST%\package-lock.json" >nul 2>&1 || set ROLL_DEPS=1
if not exist "%DST%\node_modules\vite\bin\vite.js" set ROLL_DEPS=1
REM /XD node_modules: robocopy no copia NI borra esa carpeta en el destino
robocopy "%BCK%" "%DST%" /MIR /XD node_modules /R:1 /W:1 /NFL /NDL >> %LOG% 2>&1
if errorlevel 8 ( echo ERROR: robocopy del rollback fallo. Ver %LOG% & pause & exit /b 1 )

echo [3/4] Dependencias...
cd /d "%DST%"
if not defined ROLL_DEPS goto ROLL_REINICIO
echo    Cambiaron las dependencias: reinstalando node_modules...
if exist node_modules rmdir /s /q node_modules
if exist node_modules ( echo ERROR: no se pudo borrar node_modules ^(archivo tomado^). Ver %LOG% & pause & exit /b 1 )
call %NPM% install >> %LOG% 2>&1
if errorlevel 1 ( echo ERROR: npm install del rollback fallo. Ver %LOG% & pause & exit /b 1 )
if not exist "node_modules\vite\bin\vite.js" ( echo ERROR: falta vite en node_modules de prod. Ver %LOG% & pause & exit /b 1 )

:ROLL_REINICIO
echo [4/4] Levantando apifront-prod...
call pm2 describe apifront-prod >nul 2>&1
if errorlevel 1 call pm2 start "%DST%\ecosystem.config.cjs"
call pm2 describe apifront-prod >nul 2>&1
if errorlevel 1 ( echo ERROR: apifront-prod no existe en pm2. & pause & exit /b 1 )
%REINICIO% -App apifront-prod -Puerto 5173
if errorlevel 1 ( echo ERROR: apifront-prod no quedo escuchando :5173 - revisar pm2 & echo [%date% %time%] ERROR rollback apifront-prod >> %LOG% & pause & exit /b 1 )
call pm2 save >> %LOG% 2>&1
echo OK: Rollback completado. http://192.168.0.21:5173
echo [%date% %time%] ROLLBACK completado >> %LOG%
pause
exit /b 0

@echo off
REM Carga en lote de la cola ART con el script corregido (menú nuevo). Autónomo: no depende
REM del worker de pm2. Pensado para tarea programada. Loguea a art_carga_batch.log.
setlocal
set "APPDIR=C:\apps\personaldev\apipersonal"
set "LOGFILE=%~dp0art_carga_batch.log"
set "ART_HEADLESS=true"

cd /d "%APPDIR%"
echo. >> "%LOGFILE%"
echo ========== [%date% %time%] INICIO carga batch ART ========== >> "%LOGFILE%"
"C:\Program Files\nodejs\node.exe" "%APPDIR%\scripts\art_batch_run.mjs" >> "%LOGFILE%" 2>&1
echo ========== [%date% %time%] FIN (exit %errorlevel%) ========== >> "%LOGFILE%"
endlocal

@echo off
REM Movimiento masivo de establecimiento en ART: pasa los agentes de la Direccion Provincial
REM de Hospitales (289003) u otros a Catan (488242). Escritura real. Orden seguro por agente:
REM agrega Catan + verifica + recien elimina el viejo + GUARDA. Loguea a art_editar_batch.log
REM y deja el resultado en D:\G\comparacion. Pensado para tarea programada (SYSTEM).
setlocal
set "APPDIR=C:\apps\personaldev\apipersonal"
set "LOGFILE=%~dp0art_editar_batch.log"
set "ART_HEADLESS=true"
set "LISTA=D:\G\comparacion\faltantes_cuil.xlsx"

cd /d "%APPDIR%"
echo. >> "%LOGFILE%"
echo ========== [%date% %time%] INICIO editar establecimiento (APPLY) ========== >> "%LOGFILE%"
"C:\Program Files\nodejs\node.exe" "%APPDIR%\scripts\art_editar_establecimiento.mjs" --excel "%LISTA%" --apply >> "%LOGFILE%" 2>&1
echo ========== [%date% %time%] FIN (exit %errorlevel%) ========== >> "%LOGFILE%"
endlocal

@echo off
REM Resetea art_alta_queue a PENDING para que el worker reprocese.
REM Lee la clave de MySQL del .env de la API. Pensado para tarea programada.
setlocal enabledelayedexpansion

set "ENVFILE=%~dp0..\.env"
set "SQLFILE=%~dp0art_reset_cola.sql"
set "LOGFILE=%~dp0art_reset_cola.log"
set "DBUSER=root"
set "DBNAME=personalv5"

for /f "usebackq tokens=1,* delims==" %%A in ("%ENVFILE%") do (
  if /I "%%A"=="DB_PASSWORD" set "MYSQL_PWD=%%B"
  if /I "%%A"=="DB_USER" set "DBUSER=%%B"
  if /I "%%A"=="DB_NAME" set "DBNAME=%%B"
)

echo [%date% %time%] Reset art_alta_queue >> "%LOGFILE%"
"C:\ProgramData\chocolatey\bin\mysql.exe" -h127.0.0.1 -u"%DBUSER%" "%DBNAME%" < "%SQLFILE%" >> "%LOGFILE%" 2>&1
echo [%date% %time%] Fin (exit %errorlevel%) >> "%LOGFILE%"

endlocal

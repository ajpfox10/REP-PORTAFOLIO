@echo off
setlocal enabledelayedexpansion
REM --- SDK ZKTeco (zkemkeeper 32 bits) para biometria por SDK directo ---
REM Solo la primera vez: copia las DLL a SysWOW64 y registra el COM 32 bits.
REM Necesita admin; si falla, el server igual arranca (la LAB SDK no andara
REM hasta correr vendor\zkteco-sdk-32bit\instalar-sdk.bat como administrador).
if not exist "%windir%\SysWOW64\zkemkeeper.dll" (
  set "SDKDIR="
  if exist "%~dp0vendor\zkteco-sdk-32bit\zkemkeeper.dll" set "SDKDIR=%~dp0vendor\zkteco-sdk-32bit"
  if not defined SDKDIR if exist "C:\apps\apipersonal-prod\vendor\zkteco-sdk-32bit\zkemkeeper.dll" set "SDKDIR=C:\apps\apipersonal-prod\vendor\zkteco-sdk-32bit"
  if not defined SDKDIR if exist "C:\apps\personaldev\apipersonal\vendor\zkteco-sdk-32bit\zkemkeeper.dll" set "SDKDIR=C:\apps\personaldev\apipersonal\vendor\zkteco-sdk-32bit"
  if defined SDKDIR (
    echo Instalando SDK ZKTeco 32 bits desde "!SDKDIR!" ...
    copy /Y "!SDKDIR!\*.dll" "%windir%\SysWOW64\" >nul 2>&1
    "%windir%\SysWOW64\regsvr32.exe" /s "%windir%\SysWOW64\zkemkeeper.dll"
  ) else (
    echo ADVERTENCIA: no encontre las DLL del SDK ZKTeco; la LAB SDK no andara hasta instalarlas.
  )
)
endlocal

copy /Y "C:\apps\apipersonal\.env.production" "C:\apps\apipersonal-prod\.env"
cd /d C:\apps\apipersonal-prod
call "C:\Program Files\nodejs\npm.cmd" run start

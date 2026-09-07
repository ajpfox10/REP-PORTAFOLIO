@echo off
REM ============================================================
REM Mueve tu sesion RDP actual a la CONSOLA para que quede ACTIVA
REM (no "desconectada") aunque cierres el Escritorio Remoto.
REM Asi el robot puede manejar la pantalla a las 17:00.
REM Ejecutar COMO ADMINISTRADOR antes de irte.
REM ============================================================
echo Redirigiendo la sesion "%SESSIONNAME%" a la consola...
tscon %SESSIONNAME% /dest:console

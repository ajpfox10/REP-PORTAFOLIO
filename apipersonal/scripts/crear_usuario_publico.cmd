@echo off
REM Usuario de MySQL de permisos minimos para el servidor publico (bot de WhatsApp + Agenda de turnos).
REM   crear_usuario_publico.cmd          -> dev
REM   crear_usuario_publico.cmd prod     -> prod (despues del deploy)
REM Pide la clave de root de MySQL. Ver crear_usuario_publico.cjs.
"C:\Program Files\nodejs\node.exe" "%~dp0crear_usuario_publico.cjs" %*
pause

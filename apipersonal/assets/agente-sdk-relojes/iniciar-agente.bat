@echo off
rem Arranca el agente SDK de relojes. La PRIMERA vez: clic derecho > "Ejecutar como administrador"
rem (para que abra su regla de firewall). Despues alcanza con doble clic.
rem Si el agente se autoactualiza sale con codigo 3 y este .bat lo vuelve a lanzar solo.
cd /d "%~dp0"
:arrancar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agente.ps1"
if %errorlevel%==3 (
  echo Agente actualizado, reiniciando...
  goto arrancar
)
pause

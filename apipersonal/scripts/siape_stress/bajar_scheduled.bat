@echo off
cd /d "%~dp0"
echo ==== %date% %time% ==== >> bajar_run.log
node bajar_tiempo_acumulado.mjs >> bajar_run.log 2>&1

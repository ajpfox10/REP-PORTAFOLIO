@echo off
cd /d "%~dp0"
echo ==== %date% %time% ==== >> run.log
node cargar_stress.mjs --all >> run.log 2>&1

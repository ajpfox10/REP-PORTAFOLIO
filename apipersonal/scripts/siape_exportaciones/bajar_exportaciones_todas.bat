@echo off
cd /d "%~dp0"
echo ==== %date% %time% ==== >> exportaciones_run.log
python descargar_exportacion_siape.py --all >> exportaciones_run.log 2>&1

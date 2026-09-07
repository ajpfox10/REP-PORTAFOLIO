@echo off
cd /d "%~dp0"
echo ==== %date% %time% ==== >> francos_run.log
python cargar_francos_siape.py --log francos_run.log >> francos_run.log 2>&1

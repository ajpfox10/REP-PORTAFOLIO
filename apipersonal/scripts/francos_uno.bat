@echo off
cd /d "%~dp0"
echo === Carga 1 franco (mira SIAPE) ===
python cargar_francos_siape.py --limit 1 --log francos_run.log
echo.
pause

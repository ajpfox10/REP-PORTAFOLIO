@echo off
cd /d "%~dp0"
set /p DNI=DNI a cargar (completo, guarda al final):
python cargar_stress_jab.py --dni %DNI% > stress_jab_carga.log 2>&1
type stress_jab_carga.log
echo.
pause

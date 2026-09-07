@echo off
cd /d "%~dp0"
set /p DNI=DNI a abrir: 
python cargar_stress_jab.py --solo-abrir --dni %DNI% > stress_jab_abrir.log 2>&1
type stress_jab_abrir.log
echo.
pause

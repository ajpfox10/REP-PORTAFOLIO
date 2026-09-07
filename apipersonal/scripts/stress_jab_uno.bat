@echo off
cd /d "%~dp0"
python cargar_stress_jab.py --limit 1 > stress_jab_uno.log 2>&1
type stress_jab_uno.log
echo.
pause

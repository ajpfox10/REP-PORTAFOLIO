@echo off
cd /d "%~dp0"
python cargar_stress_jab.py --dry-run > stress_jab_dry.log 2>&1
type stress_jab_dry.log
echo.
pause

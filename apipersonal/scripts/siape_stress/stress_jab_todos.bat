@echo off
REM Pipeline completo STRESS por Java Access Bridge:
REM   build cola (>=umbral, dedup) -> robot JAB (carga+verifica+guarda+marca DB)
cd /d "%~dp0"
node cargar_stress.mjs --all > stress_jab_todos.log 2>&1
type stress_jab_todos.log
echo.
pause

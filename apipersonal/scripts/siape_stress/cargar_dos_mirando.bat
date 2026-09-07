@echo off
cd /d "%~dp0"
echo Carga DOS agentes seguidos (para probar el paso de uno al otro).
node cargar_stress.mjs --all --limit 2
echo.
pause

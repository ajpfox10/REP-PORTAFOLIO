@echo off
cd /d "%~dp0"
echo === PRUEBA EN SECO (solo muestra la cola, NO toca SIAPE) ===
python cargar_francos_siape.py --dry-run
echo.
pause

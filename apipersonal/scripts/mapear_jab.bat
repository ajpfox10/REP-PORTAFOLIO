@echo off
cd /d "%~dp0"
set OUT=%1
if "%OUT%"=="" set OUT=jab_dump.txt
echo Volcando arbol JAB de SIAPE a %OUT% ...
python siape_jab_tools.py --max-depth 26 list > %OUT% 2>&1
echo LISTO -> %OUT%
pause

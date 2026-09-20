@echo off
cd /d "%~dp0"
echo ==== %date% %time% solo-login ==== >> solo_login.log
python ..\cargar_stress_jab.py --solo-login >> solo_login.log 2>&1

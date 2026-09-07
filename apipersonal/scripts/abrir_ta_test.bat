@echo off
cd /d "%~dp0"
python abrir_ta_test.py > abrir_ta_test.log 2>&1
type abrir_ta_test.log

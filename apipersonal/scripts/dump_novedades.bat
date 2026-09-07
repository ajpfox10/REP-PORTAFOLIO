@echo off
REM Espera 7 segundos y DESPUES vuelca el arbol JAB a dump_novedades_abierto.txt.
REM Corre este bat PRIMERO; mientras cuenta, abri el menu Novedades y dejalo
REM abierto. Al llegar a 0 vuelca con el menu abierto (los items tienen bounds).
cd /d "%~dp0"
echo Abri el menu NOVEDADES ahora. Vuelco en:
for /l %%i in (7,-1,1) do (
  echo    %%i ...
  timeout /t 1 /nobreak >nul
)
echo Volcando...
python siape_jab_tools.py list > dump_novedades_abierto.txt 2>&1
echo Listo: dump_novedades_abierto.txt

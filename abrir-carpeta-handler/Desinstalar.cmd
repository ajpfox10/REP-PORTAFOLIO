@echo off
rem ============================================================================
rem  Quita el handler del protocolo "p5abrir:" del usuario actual.
rem ============================================================================
setlocal

echo Desinstalando el handler "p5abrir:" para el usuario %USERNAME% ...
reg delete "HKCU\Software\Classes\p5abrir" /f >nul 2>&1

echo.
echo  Handler desinstalado. El boton "abrir carpeta" seguira COPIANDO la ruta
echo  al portapapeles (para pegar a mano en el Explorador), pero ya no abrira solo.
echo.
pause

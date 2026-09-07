@echo off
rem ============================================================================
rem  Instala el handler del protocolo "p5abrir:" para el USUARIO ACTUAL.
rem  No requiere administrador (usa HKCU). Registra el launcher que esta en
rem  ESTA MISMA CARPETA, asi que NO muevas ni borres la carpeta despues.
rem ============================================================================
setlocal

echo Instalando el handler "p5abrir:" para el usuario %USERNAME% ...
echo Carpeta: %~dp0

reg add "HKCU\Software\Classes\p5abrir" /ve /t REG_SZ /d "URL:Abrir carpeta Personal v5" /f >nul
reg add "HKCU\Software\Classes\p5abrir" /v "URL Protocol" /t REG_SZ /d "" /f >nul
reg add "HKCU\Software\Classes\p5abrir\shell\open\command" /ve /t REG_SZ /d "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%~dp0abrir-carpeta.ps1\" \"%%1\"" /f >nul

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo *** Hubo un error al registrar el protocolo. ***
  pause
  exit /b 1
)

echo.
echo  Handler instalado correctamente.
echo  Ya podes usar el boton "abrir carpeta" en la web: se va a abrir el
echo  Explorador en esta PC. La primera vez el navegador puede preguntar si
echo  permitis abrir "p5abrir:"  ->  aceptar (podes tildar "recordar").
echo.
pause

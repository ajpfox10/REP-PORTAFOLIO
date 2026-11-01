@echo off
REM ================================================================
REM  instalar-actualizador.cmd - extension "Personal - Avisos por WhatsApp"
REM  Doble clic UNA vez en cada PC (despues de cargar la extension en Chrome).
REM  Crea una tarea de Windows del usuario (cada 2 horas) y un acceso en Inicio
REM  (al prender la PC) que corren actualizar.ps1 sin mostrar ventanas.
REM  No necesita permisos de administrador.
REM  Para sacarlo:  instalar-actualizador.cmd quitar
REM ================================================================
setlocal
set "TAREA=Personal - Actualizar extension WhatsApp"
set "VBS=%~dp0actualizar-oculto.vbs"
set "INICIO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Personal - Actualizar extension WhatsApp.lnk"

if /i "%1"=="quitar" (
  schtasks /Delete /TN "%TAREA%" /F >nul 2>&1
  if exist "%INICIO%" del "%INICIO%"
  echo Actualizador quitado.
  pause
  exit /b 0
)

if not exist "%VBS%" (
  echo ERROR: no encuentro actualizar-oculto.vbs en esta carpeta.
  echo Corre este archivo desde la carpeta de la extension.
  pause
  exit /b 1
)

echo Instalando el actualizador de la extension de WhatsApp...
schtasks /Create /SC MINUTE /MO 120 /TN "%TAREA%" /TR "wscript.exe \"%VBS%\"" /F >nul
if errorlevel 1 (
  echo ERROR: no se pudo crear la tarea programada.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:INICIO); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"' + $env:VBS + '\"'; $s.WindowStyle = 7; $s.Save()"

REM Primera revision ahora mismo
wscript.exe "%VBS%"

echo.
echo LISTO. La extension se va a actualizar sola:
echo   - al prender la PC y cada 2 horas busca si hay version nueva
echo   - si la hay, la baja y Chrome la recarga solo en unos minutos
echo.
echo IMPORTANTE: no borres ni muevas esta carpeta:
echo   %~dp0
echo.
pause

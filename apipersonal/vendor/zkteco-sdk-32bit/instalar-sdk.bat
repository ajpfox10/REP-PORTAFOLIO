@echo off
REM ============================================================
REM  Instalador SDK ZKTeco (zkemkeeper) - 32 bits
REM  Copia las DLL a SysWOW64 y registra zkemkeeper.dll con el
REM  regsvr32 de 32 bits. Necesario para que el backend pueda
REM  hacer: New-Object -ComObject zkemkeeper.ZKEM (cara/palma).
REM  EJECUTAR COMO ADMINISTRADOR.
REM ============================================================
cd /d "%~dp0"

REM --- Verificar privilegios de administrador ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Este script debe ejecutarse como Administrador.
  echo         Click derecho -^> "Ejecutar como administrador".
  pause
  exit /b 1
)

echo Copiando DLL de 32 bits a %windir%\SysWOW64 ...
copy /Y ".\*.dll" "%windir%\SysWOW64\" >nul
if %errorlevel% neq 0 (
  echo [ERROR] No se pudieron copiar las DLL.
  pause
  exit /b 1
)

echo Registrando zkemkeeper.dll (COM 32 bits) ...
"%windir%\SysWOW64\regsvr32.exe" /s "%windir%\SysWOW64\zkemkeeper.dll"
if %errorlevel% neq 0 (
  echo [ERROR] regsvr32 fallo al registrar zkemkeeper.dll
  pause
  exit /b 1
)

echo.
echo [OK] SDK ZKTeco 32 bits instalado y registrado.
echo      Probar:  C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -Command "New-Object -ComObject zkemkeeper.ZKEM ^| Out-Null; 'ZKEM OK'"
echo.
pause

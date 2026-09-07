@echo off
REM ============================================================
REM  Desinstalador SDK ZKTeco (zkemkeeper) - 32 bits
REM  Solo des-registra el COM. No borra las DLL de SysWOW64
REM  (otras apps podrian usarlas). EJECUTAR COMO ADMINISTRADOR.
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Ejecutar como Administrador.
  pause
  exit /b 1
)

echo Des-registrando zkemkeeper.dll ...
"%windir%\SysWOW64\regsvr32.exe" /s /u "%windir%\SysWOW64\zkemkeeper.dll"
echo [OK] COM des-registrado.
pause

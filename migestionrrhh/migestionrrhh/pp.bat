@echo off
setlocal enabledelayedexpansion

REM === CONFIGURACIÓN DEL PROYECTO ===
set PROJECT_DIR=D:\foxtrot\source\repos\migestionrrhh

echo ------------------------------------------------------
echo 🔄 LIMPIEZA, REINSTALACIÓN Y COMPILACIÓN DEL PROYECTO
echo 📁 Proyecto: %PROJECT_DIR%
echo ------------------------------------------------------

REM === IR A LA CARPETA DEL PROYECTO ===
cd /d %PROJECT_DIR%

echo.
echo 🧼 Eliminando carpetas de compilación y dependencias...
rmdir /s /q dist >nul 2>&1
rmdir /s /q node_modules >nul 2>&1
rmdir /s /q .cache >nul 2>&1

echo 🧹 Eliminando archivos temporales y logs...
del /s /q *.tsbuildinfo *.log *.tmp >nul 2>&1

echo.
echo 📦 Reinstalando dependencias...
call npm install

echo.
echo 🔐 Corrigiendo vulnerabilidades...
call npm audit fix --force

echo.
echo 🛠️ Verificando errores de TypeScript...
call npx tsc --noEmit
IF %ERRORLEVEL% NEQ 0 (
    echo ❌ ERROR: Hay errores de compilación TypeScript.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo 🔨 Compilando proyecto...
call npm run build

echo.
echo 🚀 Iniciando proyecto en modo producción...
call npm run start:prod

echo.
echo ✅ Proyecto listo, compilado y ejecutado en modo producción.
pause

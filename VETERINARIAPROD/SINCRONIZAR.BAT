@echo off
echo ================================
echo   SYNC REPO VETERINARIA
echo ================================

echo.
echo [1] Verificando repositorio...

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo Inicializando repositorio...
    git init
)

echo.
echo [2] Configurando remote...

git remote remove origin >nul 2>&1
git remote add origin https://github.com/ajpfox10/VETERINARIA.git

echo.
echo [3] Agregando cambios...
git add .

echo.
echo [4] Commit automatico...
git commit -m "auto commit" >nul 2>&1

echo.
echo [5] Detectando rama...

for /f "delims=" %%i in ('git branch --show-current') do set BRANCH=%%i

if "%BRANCH%"=="" (
    echo No hay rama, creando main...
    git branch -M main
    set BRANCH=main
)

echo Rama: %BRANCH%

echo.
echo [6] Subiendo a GitHub...
git push -u origin %BRANCH%

echo.
echo ================================
echo   FIN
echo ================================
pause
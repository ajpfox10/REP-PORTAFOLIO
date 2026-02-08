@echo off
set HUSKY=0

setlocal EnableExtensions

cd /d "%~dp0"

echo === Git Sync (add -A / commit / push) ===
echo Repo: %CD%
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Esta carpeta no es un repo git.
  pause
  exit /b 1
)

git add -A

git diff --cached --quiet
if not errorlevel 1 (
  echo [OK] No hay cambios para commitear.
  pause
  exit /b 0
)

for /f "tokens=1-3 delims=/" %%a in ("%date%") do set _d=%%c-%%b-%%a
for /f "tokens=1-2 delims=:" %%a in ("%time%") do set _t=%%a%%b
set msg=Sync %_d% %_t%

echo [INFO] Commit: "%msg%"
git commit -m "%msg%"
if errorlevel 1 (
  echo [ERROR] Fallo el commit.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo [ERROR] Fallo el push.
  pause
  exit /b 1
)

echo.
echo [OK] Subido correctamente.
pause

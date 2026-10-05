@echo off
REM ================================================================
REM  sync-repos.cmd — copia el FUENTE de personaldev al repo git,
REM  limpio (sin node_modules/dist/.env/.claude/fichadas/etc).
REM  NO toca git. Despues subis vos con git_sync.bat.
REM  Uso:  sync-repos.cmd dry   (prueba, no copia)
REM        sync-repos.cmd       (copia de verdad)
REM ================================================================
setlocal EnableExtensions
set "MODE=%~1"
set "DRY="
if /i "%MODE%"=="dry" set "DRY=/L"

REM Carpetas y archivos que NO se copian
set "XD=node_modules dist .git .claude .cache logs tmp coverage .vs fichadas bin obj __pycache__ .playwright .chrome-debug chrome-dev-visible chrome-dev-visible-2 storage uploads capturas screenshots .venv venv"
set "XF=.env* CLAUDE.md reformas.txt PENDIENTES.txt fichadas_log.txt *fichad*.txt attlog*.txt *.log *.err *.jpg *.jpeg Thumbs.db .DS_Store fichero_config.json *.bak *.bak_* *.pyc *.pem *.key *.pfx *.p12 id_rsa* *.pdf *.csv *.xlsx *.xls *.webp *.bmp"

echo ================================================================
echo   SYNC personaldev -^> D:\Repositorios   (modo: %MODE%)
echo ================================================================

echo.
echo === apipersonal ===
robocopy "C:\apps\personaldev\apipersonal" "D:\Repositorios\apipersonal" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === apifront ===
robocopy "C:\apps\personaldev\apifront" "D:\Repositorios\apifront" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === abrir-carpeta-handler ===
robocopy "C:\apps\personaldev\abrir-carpeta-handler" "D:\Repositorios\abrir-carpeta-handler" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === scanner1 ===
robocopy "C:\apps\personaldev\scanner1" "D:\Repositorios\scanner1" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === ARCHIVOPASIVO ===
robocopy "C:\apps\ARCHIVOPASIVO" "D:\Repositorios\ARCHIVOPASIVO" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === ARCHIVOPASIVODEV ===
robocopy "C:\apps\ARCHIVOPASIVODEV" "D:\Repositorios\ARCHIVOPASIVODEV" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === farmacia ===
robocopy "C:\apps\farmacia" "D:\Repositorios\farmacia" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === cobertura-salud ===
robocopy "C:\apps\cobertura-salud" "D:\Repositorios\cobertura-salud" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === VETERINARIAPROD ===
robocopy "C:\apps\VETERINARIAPROD" "D:\Repositorios\VETERINARIAPROD" %DRY% /E /R:1 /W:1 /NP /NDL /XD %XD% /XF %XF%

echo.
echo === Redactar secretos conocidos (C:\apps\sync-secretos.txt) y claves en .py ===
if defined DRY echo   [dry] omitido en modo prueba
if not defined DRY powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-guard.ps1" -Mode Redact

echo.
echo ================================================================
echo   Listo (modo %MODE%). NO se toco git.
echo   Revisar:  git -C D:\Repositorios status
echo   Subir:    tu git_sync.bat  (lo haces vos)
echo ================================================================

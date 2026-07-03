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
set "XD=node_modules dist .git .claude .cache logs tmp coverage .vs fichadas"
set "XF=.env .env.production .env.docker .env.local CLAUDE.md fichadas_log.txt *.log Thumbs.db .DS_Store"

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
echo ================================================================
echo   Listo (modo %MODE%). NO se toco git.
echo   Revisar:  git -C D:\Repositorios status
echo   Subir:    tu git_sync.bat  (lo haces vos)
echo ================================================================

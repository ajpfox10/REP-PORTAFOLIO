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
echo === Sanitizar credenciales en los .py copiados (usuario/clave -^> xxxxxxx) ===
if defined DRY echo   [dry] omitido en modo prueba
if not defined DRY powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='D:\Repositorios\apipersonal\scripts'; if(Test-Path $d){ $q=[char]34; $sq=[char]39; $pat='(?im)^(\s*(?:USUARIO|USER|CLAVE|PASS|PASSWORD|PWD)\s*=\s*)([' + $sq + $q + ']).*?\2'; Get-ChildItem $d -Filter *.py -File | ForEach-Object { $p=$_.FullName; $c=Get-Content -Raw -Encoding UTF8 $p; $o=$c; $c=$c -replace 'PEVERIAJ','xxxxxxx'; $c=$c -replace $pat,'${1}${2}xxxxxxx${2}'; if($c -ne $o){ [System.IO.File]::WriteAllText($p,$c,(New-Object System.Text.UTF8Encoding($false))); Write-Host ('  redactado: '+$_.Name) } else { Write-Host ('  sin cambios: '+$_.Name) } } }"

echo.
echo ================================================================
echo   Listo (modo %MODE%). NO se toco git.
echo   Revisar:  git -C D:\Repositorios status
echo   Subir:    tu git_sync.bat  (lo haces vos)
echo ================================================================

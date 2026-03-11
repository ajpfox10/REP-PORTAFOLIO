@echo off
set SRC=C:\apps\apipersonal
set DST=C:\apps\apipersonal-prod

cd /d %SRC%
call "C:\Program Files\nodejs\npm.cmd" install
call "C:\Program Files\nodejs\npm.cmd" run build

if not exist "%DST%" mkdir "%DST%"

robocopy "%SRC%" "%DST%" /MIR /XD node_modules .git dist
robocopy "%SRC%\dist" "%DST%\dist" /MIR

cd /d %DST%
if exist node_modules rmdir /s /q node_modules
call "C:\Program Files\nodejs\npm.cmd" install

REM Aplicar .env de producción si existe
if exist "%SRC%\.env.production" copy /Y "%SRC%\.env.production" "%DST%\.env"

echo NODE_ENV=production> "%DST%\.env"
echo PORT=3001>> "%DST%\.env"
type "%SRC%\.env" | findstr /V "^NODE_ENV= ^PORT=" >> "%DST%\.env"
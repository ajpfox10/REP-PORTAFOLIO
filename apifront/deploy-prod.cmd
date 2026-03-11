@echo off
set SRC=C:\apps\apifront
set DST=C:\apps\apifront-prod

cd /d %SRC%
call "C:\Program Files\nodejs\npm.cmd" install
call "C:\Program Files\nodejs\npm.cmd" run build

if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%\dist" "%DST%\dist" /MIR
robocopy "%SRC%\public" "%DST%\public" /MIR
copy /Y "%SRC%\package.json" "%DST%\package.json"
copy /Y "%SRC%\package-lock.json" "%DST%\package-lock.json"

REM ── Sobreescribir runtime-config con valores de producción ──
(echo {"apiBaseUrl":"http://192.168.0.21:3001/api/v1","scannerApiUrl":"http://192.168.0.21:3002","scannerTenantId":"1"}) > "%DST%\dist\runtime-config.json"
cd /d %DST%
if exist node_modules rmdir /s /q node_modules
call "C:\Program Files\nodejs\npm.cmd" install
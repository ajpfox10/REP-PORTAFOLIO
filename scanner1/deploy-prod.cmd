@echo off
set SRC=C:\apps\scanner1
set DST=C:\apps\scanner1-prod

if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%" "%DST%" /MIR /XD node_modules .git storage

echo PORT=3002> "%DST%\.env"
echo NODE_ENV=production>> "%DST%\.env"
echo BASE_URL=http://localhost:3002>> "%DST%\.env"
echo PERSONAL_API_URL=http://localhost:3001>> "%DST%\.env"
type "%SRC%\.env" | findstr /V "PORT= NODE_ENV= BASE_URL= PERSONAL_API_URL=" >> "%DST%\.env"

cd /d "%DST%\api" && call "C:\Program Files\nodejs\npm.cmd" install
cd /d "%DST%\worker" && call "C:\Program Files\nodejs\npm.cmd" install
cd /d "%DST%\agent" && call "C:\Program Files\nodejs\npm.cmd" install
@echo off 
copy /Y "C:\apps\apipersonal\.env.production" "C:\apps\apipersonal-prod\.env" 
cd /d C:\apps\apipersonal-prod 
call "C:\Program Files\nodejs\npm.cmd" run start 

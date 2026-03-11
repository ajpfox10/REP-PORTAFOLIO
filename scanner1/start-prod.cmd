@echo off
start "Scanner API PROD" cmd /k "cd /d C:\apps\scanner1-prod\api && npx tsx watch src/server.ts"
timeout /t 3 /nobreak >nul
start "Scanner Worker PROD" cmd /k "cd /d C:\apps\scanner1-prod\worker && npx tsx watch src/index.ts"
start "Scanner Agent PROD" cmd /k "cd /d C:\apps\scanner1-prod\agent && npx tsx watch src/agent.ts"
@echo off
start "Scanner API PROD" cmd /k "cd /d C:\apps\scanner1-prod && set NODE_ENV=production && npx tsx api/src/server.ts"
timeout /t 3 /nobreak >nul
start "Scanner Worker PROD" cmd /k "cd /d C:\apps\scanner1-prod && set NODE_ENV=production && npx tsx worker/src/index.ts"
start "Scanner Agent PROD" cmd /k "cd /d C:\apps\scanner1-prod && npx tsx agent/src/agent.ts"

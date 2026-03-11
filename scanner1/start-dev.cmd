@echo off
echo ================================================
echo  Scanner v3 - DEV
echo  API     -> http://localhost:3001
echo  Worker  -> stub (sin Redis)
echo  Agent   -> virtual scanner
echo ================================================

REM ── 1. API ──────────────────────────────────────
start "Scanner API" cmd /k "cd /d C:\apps\scanner1\api && npx tsx watch src/server.ts"

REM Esperar 3 segundos a que el API levante antes de iniciar el agente
timeout /t 3 /nobreak >nul

REM ── 2. Worker ───────────────────────────────────
start "Scanner Worker" cmd /k "cd /d C:\apps\scanner1\worker && npx tsx watch src/index.ts"

REM ── 3. Agent ────────────────────────────────────
start "Scanner Agent" cmd /k "cd /d C:\apps\scanner1\agent && npx tsx watch src/agent.ts"

echo.
echo Servicios iniciados en ventanas separadas.
echo Cerra cada ventana para detener el servicio.
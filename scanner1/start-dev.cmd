@echo off
echo ================================================
echo  Scanner v4 - DEV
echo  API        -> http://localhost:3003
echo  Agent      -> multi-device + autodiscovery
echo  Agent Lite -> escaner local/USB
echo ================================================

REM ── 1. API ──────────────────────────────────────
start "Scanner API [dev:3003]" cmd /k "cd /d C:\apps\personaldev\scanner1\api && npx tsx watch src/server.ts"

REM Esperar 3 segundos a que el API levante
timeout /t 3 /nobreak >/dev/null

REM ── 2. Agent principal (multi-device, autodiscovery de red) ──────────────
start "Scanner Agent [dev]" cmd /k "cd /d C:\apps\personaldev\scanner1\agent && npx tsx watch src/agent.ts"

REM ── 3. Agent Lite (escaner local/USB de este servidor) ──────────────────
start "Scanner Agent Lite [dev]" cmd /k "cd /d C:\apps\personaldev\scanner1\agent-lite && npx tsx watch src/agent-lite.ts"

echo.
echo Servicios iniciados en ventanas separadas.
echo   API:        http://localhost:3003
echo   Agent:      multi-device con autodiscovery (mDNS+WSD+SNMP)
echo   Agent Lite: escaner local/USB de esta PC
echo.
echo Para PCs remotas con escaner USB:
echo   1. Copiar carpeta agent-lite/ a la PC
echo   2. npm install
echo   3. Crear .env (ver .env.example)
echo   4. npx tsx src/agent-lite.ts
echo.
echo Cerra cada ventana para detener el servicio.

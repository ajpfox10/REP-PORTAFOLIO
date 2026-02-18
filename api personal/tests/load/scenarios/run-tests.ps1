# tests/load/run-tests.ps1

Write-Host "🧪 PersonalV5 - Load Testing Suite" -ForegroundColor Yellow
Write-Host "================================"

# Verificar que k6 está instalado
if (!(Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Host "❌ k6 no está instalado" -ForegroundColor Red
    Write-Host "   Instalalo desde: https://k6.io/docs/getting-started/installation/"
    exit 1
}

# Verificar que la API está corriendo
Write-Host "🔍 Verificando API en http://localhost:3000/health..." -ForegroundColor Yellow
try {
    $health = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing
    if ($health.Content -match "ok") {
        Write-Host "✅ API respondiendo correctamente" -ForegroundColor Green
    } else {
        Write-Host "❌ API no responde correctamente" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ API no responde en http://localhost:3000" -ForegroundColor Red
    exit 1
}

# Crear directorio de reportes
New-Item -ItemType Directory -Force -Path reports | Out-Null

# Función para correr test
function Run-Test {
    param($name, $file, $vus, $duration)
    
    Write-Host "`n📊 Ejecutando: $name" -ForegroundColor Yellow
    Write-Host "================================"
    
    & k6 run $file --vus $vus --duration $duration --summary-export "reports/$name-report.json"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ $name completado" -ForegroundColor Green
    } else {
        Write-Host "❌ $name falló" -ForegroundColor Red
    }
}

# Ejecutar batería de tests
Write-Host "`n🚀 Iniciando suite de tests..." -ForegroundColor Yellow

Run-Test "smoke" "scenarios/smoke-test.js" 1 "30s"
Run-Test "load" "scenarios/load-test.js" 0 "8m"
Run-Test "stress" "scenarios/stress-test.js" 0 "11m"
Run-Test "soak" "scenarios/soak-test.js" 50 "30m"

Write-Host "`n✅ Todos los tests completados" -ForegroundColor Green
Write-Host "📁 Reportes guardados en ./reports/"
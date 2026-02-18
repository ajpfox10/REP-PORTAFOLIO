#!/bin/bash
# tests/load/run-tests.sh

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}🧪 PersonalV5 - Load Testing Suite${NC}"
echo "================================"

# Verificar que k6 está instalado
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}❌ k6 no está instalado${NC}"
    echo "   Instalalo desde: https://k6.io/docs/getting-started/installation/"
    exit 1
fi

# Verificar que la API está corriendo
echo -e "${YELLOW}🔍 Verificando API en http://localhost:3000/health...${NC}"
if curl -s http://localhost:3000/health | grep -q "ok"; then
    echo -e "${GREEN}✅ API respondiendo correctamente${NC}"
else
    echo -e "${RED}❌ API no responde en http://localhost:3000${NC}"
    exit 1
fi

# Función para correr test
run_test() {
    local name=$1
    local file=$2
    local vus=$3
    local duration=$4
    
    echo -e "\n${YELLOW}📊 Ejecutando: $name${NC}"
    echo "================================"
    
    k6 run $file \
        --vus $vus \
        --duration $duration \
        --summary-export "reports/${name}-report.json"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $name completado${NC}"
    else
        echo -e "${RED}❌ $name falló${NC}"
    fi
}

# Crear directorio de reportes
mkdir -p reports

# Ejecutar batería de tests
echo -e "\n${YELLOW}🚀 Iniciando suite de tests...${NC}"

run_test "smoke" "scenarios/smoke-test.js" 1 "30s"
run_test "load" "scenarios/load-test.js" 0 "8m"  # stages controlan los VUs
run_test "stress" "scenarios/stress-test.js" 0 "11m"
run_test "soak" "scenarios/soak-test.js" 50 "30m"

echo -e "\n${GREEN}✅ Todos los tests completados${NC}"
echo "📁 Reportes guardados en ./reports/"
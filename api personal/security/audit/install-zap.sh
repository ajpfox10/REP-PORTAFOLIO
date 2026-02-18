#!/bin/bash
# security/audit/install-zap.sh

echo "🛡️  Instalando OWASP ZAP..."

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    wget https://github.com/zaproxy/zaproxy/releases/download/v2.14.0/ZAP_2.14.0_Linux.tar.gz
    tar -xzf ZAP_2.14.0_Linux.tar.gz
    sudo mv ZAP_2.14.0 /opt/zap
    sudo ln -s /opt/zap/zap.sh /usr/local/bin/zap-cli
    echo "✅ ZAP instalado en /opt/zap"
    
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # Mac
    brew install zaproxy
    
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    # Windows
    echo "📦 Descargando ZAP para Windows..."
    curl -L -o zap.exe https://github.com/zaproxy/zaproxy/releases/download/v2.14.0/ZAP_2.14.0_windows-x64.exe
    echo "✅ Ejecutá zap.exe para instalar manualmente"
fi

echo "🔄 Instalando zap-cli (Python)..."
pip install zap-cli

echo "✅ Instalación completada"
#!/bin/bash
# scripts/pm2-setup.sh

echo "🔧 Configurando PM2 para PersonalV5 API..."

# Instalar PM2 globalmente si no está
if ! command -v pm2 &> /dev/null; then
    echo "📦 Instalando PM2 globalmente..."
    npm install -g pm2
fi

# Detener instancias anteriores (si existen)
pm2 delete personalv5-api 2>/dev/null || true

# Iniciar en modo cluster
pm2 start ecosystem.config.js --env production

# Guardar configuración para startup automático
pm2 save
pm2 startup

# Mostrar estado
pm2 status
pm2 monit

echo "✅ PM2 configurado correctamente"
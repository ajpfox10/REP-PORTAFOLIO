// C:/apps/farmacia/carga-stock/ecosystem.config.js - SOLO DEV (puertos 4310/4410, base farmacia_stock_dev).
// Prod esta separado en C:/apps/farmacia/carga-stock-prod (desde 11/10/2026).
module.exports = {
  apps: [
    {
      name: 'farmacia-backend-dev',
      cwd: 'C:/apps/farmacia/carga-stock/backend',
      script: 'src/server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development'
      },
      watch: false,
      autorestart: true
    },
    {
      name: 'farmacia-frontend-dev',
      cwd: 'C:/apps/farmacia/carga-stock/frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: '--host 0.0.0.0 --port 4410',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development'
      },
      watch: false,
      autorestart: true
    }
  ]
};

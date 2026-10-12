// C:\apps\farmacia\carga-stock-prod\ecosystem.config.js
// PRODUCCION de Carga de Stock (separada de dev desde 11/10/2026).
// Dev vive en C:\apps\farmacia\carga-stock (su propio ecosystem). Puertos: backend 8310, frontend 8410
// (salen de backend\.env.production y del args de vite preview). Base: farmacia_stock_prod.
// Para pasar cambios de dev a prod: C:\apps\farmacia\carga-stock\deploy-prod.cmd
module.exports = {
  apps: [
    {
      name: 'farmacia-backend',
      cwd: 'C:/apps/farmacia/carga-stock-prod/backend',
      script: 'src/server.js',
      interpreter: 'node',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      watch: false,
      autorestart: true
    },
    {
      name: 'farmacia-frontend',
      cwd: 'C:/apps/farmacia/carga-stock-prod/frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview --host 0.0.0.0 --port 8410',
      interpreter: 'node',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      watch: false,
      autorestart: true
    }
  ]
};

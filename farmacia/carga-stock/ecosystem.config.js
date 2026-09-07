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
    },
    {
      name: 'farmacia-backend',
      cwd: 'C:/apps/farmacia/carga-stock/backend',
      script: 'src/server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production'
      },
      watch: false,
      autorestart: true
    },
    {
      name: 'farmacia-frontend',
      cwd: 'C:/apps/farmacia/carga-stock/frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview --host 0.0.0.0 --port 8410',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production'
      },
      watch: false,
      autorestart: true
    }
  ]
};

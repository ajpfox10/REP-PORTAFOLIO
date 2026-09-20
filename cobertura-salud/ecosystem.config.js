module.exports = {
  apps: [
    {
      name: 'cobertura-frontend-dev',
      cwd: 'C:/apps/cobertura-salud/frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: '--host 0.0.0.0 --port 4610',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development'
      },
      watch: false,
      autorestart: true,
      // Freno: si el arranque falla de entrada (puerto tomado, build rota),
      // PM2 se rinde en vez de reintentar para siempre.
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 200
    },

    // 2026-09-15: se repone 'cobertura-salud' bajo PM2 como UNICO dueno del 8510.
    // Corre backend.exe DIRECTO (compilado WinExe = sin ventana), NO `dotnet run`,
    // asi no hay proceso hijo ni doble binding. NUNCA levantar backend.exe aparte
    // ademas de este: seria doble binding al 8510 (AddressInUseException en bucle).
    {
      name: 'cobertura-salud',
      cwd: 'C:/apps/cobertura-salud/backend',
      script: 'C:/apps/cobertura-salud/backend/bin/Debug/net8.0/backend.exe',
      env: {
        ASPNETCORE_ENVIRONMENT: 'Production'
      },
      watch: false,
      autorestart: true,
      // Si falla de entrada (puerto tomado), PM2 se rinde en vez de reintentar para siempre.
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 200
    }
  ]
};

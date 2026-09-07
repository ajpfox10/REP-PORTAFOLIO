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
    }

    // 2026-08-31: se quitaron 'cobertura-backend-dev' y 'cobertura-salud'.
    // Los dos corrian `dotnet run` sobre C:/apps/cobertura-salud/backend y
    // peleaban por el puerto 8510, que ya sirve backend.exe fuera de PM2.
    // Resultado: AddressInUseException en bucle, 13.142 y 13.421 reinicios
    // y ~185 MB de logs repetidos. El backend lo maneja backend.exe.
    //
    // Si algun dia se quiere que PM2 sea el dueno del backend: primero frenar
    // backend.exe, y dejar UNA sola entrada, nunca dos sobre el mismo puerto.
  ]
};

module.exports = {
  apps: [{
    name: 'personalv5-api',
    script: 'dist/server.js',
    instances: 'max',               // Usa todos los CPUs disponibles
    exec_mode: 'cluster',            // Modo cluster
    watch: false,
    max_memory_restart: '1G',        // Reinicia si usa más de 1GB
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,                       // Timestamps en logs
    kill_timeout: 5000,                // Graceful shutdown
    listen_timeout: 3000,              // Espera a que el server escuche
    shutdown_with_message: true
  }]
};
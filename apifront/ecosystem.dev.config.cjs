module.exports = {
  apps: [{
    name: 'apifront-dev',
    script: 'node_modules/vite/bin/vite.js',
    args: '--host 0.0.0.0 --port 4173',
    cwd: 'C:\\apps\\personaldev\\apifront',
    instances: 1,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      NODE_ENV: 'development',
    },
    out_file: 'C:\\apps\\logs\\apifront-dev-out.log',
    error_file: 'C:\\apps\\logs\\apifront-dev-err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};

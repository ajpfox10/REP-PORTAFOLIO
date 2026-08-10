module.exports = {
  apps: [{
    name: 'apipersonal-dev',
    script: 'node_modules/ts-node-dev/lib/bin.js',
    args: '--transpile-only --respawn src/server.ts',
    cwd: 'C:\\apps\\personaldev\\apipersonal',
    instances: 1,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      NODE_ENV: 'development',
      PORT: '3000',
      SCANNER_API_URL: 'http://localhost:3003',
    },
    out_file: 'C:\\apps\\logs\\apipersonal-dev-out.log',
    error_file: 'C:\\apps\\logs\\apipersonal-dev-err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};

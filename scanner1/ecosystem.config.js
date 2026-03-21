module.exports = {
  apps: [
    {
      name: 'scanner-api-prod',
      cwd: 'C:\\apps\\scanner1-prod\\api',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: '3002',
        BASE_URL: 'http://192.168.0.21:3002',
        MYSQL_HOST: '127.0.0.1',
        MYSQL_PORT: '3306',
        MYSQL_DB: 'scanner_saas',
        MYSQL_USER: 'root',
        MYSQL_PASSWORD: 'Cuernos2503'
      }
    },
    {
      name: 'scanner-agent-prod',
      cwd: 'C:\\apps\\scanner1-prod\\agent',
      script: 'dist/agent.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        BASE_URL: 'http://localhost:3002',
        HEARTBEAT_MS: '30000'
      }
    }
  ]
}
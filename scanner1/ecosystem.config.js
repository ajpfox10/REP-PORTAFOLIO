module.exports = {
  apps: [
    // ── PROD ─────────────────────────────────────────────────────────────────
    {
      name: 'scanner-api-prod',
      cwd: 'C:\\apps\\personalprod\\scanner1-prod\\api',
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
      cwd: 'C:\\apps\\personalprod\\scanner1-prod\\agent',
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
        AGENT_TENANT_ID: '1',
        AGENT_EMAIL: 'admin@scanner.local',
        AGENT_PASSWORD: 'Admin1234',
        HEARTBEAT_MS: '30000',
        DISCOVER_INTERVAL_MS: '300000'
      }
    },
    // ── DEV ──────────────────────────────────────────────────────────────────
    {
      name: 'scanner-api-dev',
      cwd: 'C:\\apps\\personaldev\\scanner1\\api',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'development',
        PORT: '3003',
        BASE_URL: 'http://192.168.0.21:3003',
        MYSQL_HOST: '127.0.0.1',
        MYSQL_PORT: '3306',
        MYSQL_DB: 'scanner_saas',
        MYSQL_USER: 'root',
        MYSQL_PASSWORD: 'Cuernos2503'
      }
    },
    {
      name: 'scanner-agent-dev',
      cwd: 'C:\\apps\\personaldev\\scanner1\\agent',
      script: 'dist/agent.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'development',
        BASE_URL: 'http://localhost:3003',
        AGENT_TENANT_ID: '1',
        AGENT_EMAIL: 'admin@scanner.local',
        AGENT_PASSWORD: 'Admin1234',
        HEARTBEAT_MS: '30000',
        DISCOVER_INTERVAL_MS: '300000'
      }
    },
    // ── AGENT LITE (servidor, siempre corriendo en el server) ─────────────────
    // Para PCs remotas: copiar agent-lite/ a la PC, crear .env, y correr npm start
    {
      name: 'scanner-agent-lite-dev',
      cwd: 'C:\\apps\\personaldev\\scanner1\\agent-lite',
      script: 'dist/agent-lite.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'development',
        BASE_URL: 'http://localhost:3003',
        AGENT_TENANT_ID: '1',
        AGENT_EMAIL: 'admin@scanner.local',
        AGENT_PASSWORD: 'Admin1234',
        AGENT_NAME: 'Servidor-Local-Dev',
        HEARTBEAT_MS: '30000'
      }
    }
  ]
}
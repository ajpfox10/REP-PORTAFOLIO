// C:\apps\scanner1-prod\ecosystem.config.js
module.exports = {
  apps: [
    {
      name:         'scanner-api-prod',
      script:       'dist/server.js',
      cwd:          'C:\\apps\\scanner1-prod\\api',
      instances:    1,
      autorestart:  true,
      watch:        false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
      out_file:   'C:\\apps\\logs\\scanner-api-out.log',
      error_file: 'C:\\apps\\logs\\scanner-api-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name:         'scanner-agent-prod',
      script:       'dist/agent.js',
      cwd:          'C:\\apps\\scanner1-prod\\agent',
      instances:    1,
      autorestart:  true,
      watch:        false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
      out_file:   'C:\\apps\\logs\\scanner-agent-out.log',
      error_file: 'C:\\apps\\logs\\scanner-agent-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }
  ]
}

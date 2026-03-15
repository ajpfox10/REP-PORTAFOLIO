// C:\apps\apipersonal-prod\ecosystem.config.js
module.exports = {
  apps: [{
    name:         'apipersonal-prod',
    script:       'dist/server.js',
    cwd:          'C:\\apps\\apipersonal-prod',
    instances:    1,
    autorestart:  true,
    watch:        false,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      NODE_ENV: 'production',
    },
    // Logs
    out_file:  'C:\\apps\\logs\\apipersonal-out.log',
    error_file:'C:\\apps\\logs\\apipersonal-err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
}

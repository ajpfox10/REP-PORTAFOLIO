// C:\apps\apifront-prod\ecosystem.config.cjs
module.exports = {
  apps: [{
    name:         'apifront-prod',
    script:       'node_modules/vite/bin/vite.js',
    args:         'preview --host 0.0.0.0 --port 5173',
    cwd:          'C:\\apps\\apifront-prod',
    instances:    1,
    autorestart:  true,
    watch:        false,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      NODE_ENV: 'production',
    },
    out_file:   'C:\\apps\\logs\\apifront-out.log',
    error_file: 'C:\\apps\\logs\\apifront-err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
}

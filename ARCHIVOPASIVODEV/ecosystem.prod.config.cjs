module.exports = {
  apps: [
    {
      name: "archivopasivo-prod",
      script: "dist/src/server/index.js",
      cwd: "C:\\apps\\ARCHIVOPASIVO",
      env: {
        NODE_ENV: "production",
        APP_HOST: "0.0.0.0",
        APP_PORT: "4002",
        PUBLIC_URL: "http://192.168.0.21:4002"
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: "C:\\apps\\logs\\archivopasivo-prod-out.log",
      error_file: "C:\\apps\\logs\\archivopasivo-prod-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};

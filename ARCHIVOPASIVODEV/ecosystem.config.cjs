module.exports = {
  apps: [
    {
      name: "archivopasivo-dev",
      script: "dist/src/server/index.js",
      cwd: "C:\\apps\\ARCHIVOPASIVODEV",
      env: {
        NODE_ENV: "development",
        APP_HOST: "0.0.0.0",
        APP_PORT: "4001",
        PUBLIC_URL: "http://192.168.0.21:4001"
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: "C:\\apps\\logs\\archivopasivo-dev-out.log",
      error_file: "C:\\apps\\logs\\archivopasivo-dev-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};

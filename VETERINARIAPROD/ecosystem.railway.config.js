'use strict';

const BASE = __dirname;

function svc(name, script, port) {
  return {
    name,
    script,
    cwd: BASE,
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    autorestart: true,
    max_restarts: 1000,
    min_uptime: '30s',
    restart_delay: 2000,
    env: {
      NODE_ENV: 'production',
      PORT: port,
    },
    error_file: `${BASE}/logs/pm2/${name}-error.log`,
    out_file:   `${BASE}/logs/pm2/${name}-out.log`,
    merge_logs:  true,
  };
}

module.exports = {
  apps: [
    // Gateway usa el PORT que Railway inyecta (default 3000)
    {
      name: 'gateway',
      script: `${BASE}/gateway/src/index.js`,
      cwd: BASE,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 1000,
      min_uptime: '30s',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
      error_file: `${BASE}/logs/pm2/gateway-error.log`,
      out_file:   `${BASE}/logs/pm2/gateway-out.log`,
      merge_logs: true,
    },
    svc('auth',          `${BASE}/services/auth/src/index.js`,          4051),
    svc('patients',      `${BASE}/services/patients/src/index.js`,      4052),
    svc('medical',       `${BASE}/services/medical/src/index.js`,       4053),
    svc('lab-imaging',   `${BASE}/services/lab-imaging/src/index.js`,   4054),
    svc('billing',       `${BASE}/services/billing/src/index.js`,       4055),
    svc('telemedicine',  `${BASE}/services/telemedicine/src/index.js`,  4056),
    svc('grooming',      `${BASE}/services/grooming/src/index.js`,      4057),
    svc('reports',       `${BASE}/services/reports/src/index.js`,       4058),
    svc('notifications', `${BASE}/services/notifications/src/index.js`, 4059),
    svc('portal',        `${BASE}/services/portal/src/index.js`,        4060),
    svc('ai',            `${BASE}/services/ai/src/index.js`,            4061),
    svc('documents',     `${BASE}/services/documents/src/index.js`,     4062),
  ],
};

'use strict';

/**
 * PM2 ecosystem configuration — mirrors apipersonal PM2 setup.
 * Start all:   pm2 start ecosystem.config.js
 * Start one:   pm2 start ecosystem.config.js --only gateway
 * Reload all:  pm2 reload ecosystem.config.js
 */

const BASE = __dirname;

function svc(name, script, port, instances = 1) {
  return {
    name,
    script,
    cwd:  BASE,
    instances,
    exec_mode: instances > 1 ? 'cluster' : 'fork',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 2000,
    env: {
      NODE_ENV: 'development',
      PORT:     port,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT:     port,
    },
    error_file: `${BASE}/logs/pm2/${name}-error.log`,
    out_file:   `${BASE}/logs/pm2/${name}-out.log`,
    merge_logs:  true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  };
}

module.exports = {
  apps: [
    // Gateway: Upsun injects PORT=8888 via platform env; PM2 env_production mirrors it.
    // In dev the gateway runs on 4050; in production on 8888 (Upsun web upstream).
    {
      ...svc('gateway', `${BASE}/gateway/src/index.js`, 4050, 2),
      env_production: { NODE_ENV: 'production', PORT: 8888 },
    },
    svc('auth',          `${BASE}/services/auth/src/index.js`,               4051),
    svc('patients',      `${BASE}/services/patients/src/index.js`,           4052),
    svc('medical',       `${BASE}/services/medical/src/index.js`,            4053),
    svc('lab-imaging',   `${BASE}/services/lab-imaging/src/index.js`,        4054),
    svc('billing',       `${BASE}/services/billing/src/index.js`,            4055),
    svc('telemedicine',  `${BASE}/services/telemedicine/src/index.js`,       4056),
    svc('grooming',      `${BASE}/services/grooming/src/index.js`,           4057),
    svc('reports',       `${BASE}/services/reports/src/index.js`,            4058),
    svc('notifications', `${BASE}/services/notifications/src/index.js`,      4059),
    svc('portal',        `${BASE}/services/portal/src/index.js`,             4060),
    svc('ai',            `${BASE}/services/ai/src/index.js`,                 4061),
    svc('documents',     `${BASE}/services/documents/src/index.js`,          4062),
  ],
};

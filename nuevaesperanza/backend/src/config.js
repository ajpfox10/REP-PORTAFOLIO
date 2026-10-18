'use strict';

const path = require('path');

// Carga backend/.env si existe (Node 20.12+). Las variables ya definidas no se
// pisan, así que los tests pueden fijar su propia base antes de cargar esto.
try { process.loadEnvFile?.(path.join(__dirname, '..', '.env')); } catch { /* sin .env */ }

const isProduction = process.env.NODE_ENV === 'production';

function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const sessionSecret = process.env.SESSION_SECRET || '';
if (isProduction && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET debe tener al menos 32 caracteres en producción');
}

module.exports = {
  isProduction,
  isTest: process.env.NODE_ENV === 'test',
  port: number('PORT', 4000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: number('DB_PORT', 3306),
    database: process.env.DB_NAME || 'nueva_esperanza',
    user: process.env.DB_USER || 'nueva_esperanza',
    password: process.env.DB_PASSWORD || '',
  },
  session: {
    // En desarrollo se usa un secreto fijo para no cerrar sesiones en cada reinicio
    secret: sessionSecret || 'solo-para-desarrollo-no-usar-en-produccion',
    cookie: 'ne_session',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
  delivery: {
    fee: number('DELIVERY_FEE', 3500),
    freeFrom: number('FREE_DELIVERY_FROM', 50000),
  },
};

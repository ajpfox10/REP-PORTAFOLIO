const path   = require('path');
const dotenv = require('dotenv');

const appEnv = process.env.APP_ENV || 'dev';

// 1. Primero carga el .env local del backend (para correr SIN Docker)
dotenv.config({ path: path.resolve(__dirname, '../../', `.env.${appEnv}`) });

// 2. Luego el .env del raíz del proyecto (Docker u override global)
dotenv.config({ path: path.resolve(__dirname, '../../../', `.env.${appEnv}`) });

const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DB_PASSWORD', 'DB_NAME'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Variable de entorno requerida faltante: ${key}`);
  }
}

const config = Object.freeze({
  nodeEnv:  process.env.NODE_ENV || 'development',
  appEnv:   appEnv,
  // Railway inyecta PORT automáticamente — tiene prioridad sobre BACKEND_PORT
  port:     parseInt(process.env.PORT || process.env.BACKEND_PORT || '4071', 10),
  db: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    name:     process.env.DB_NAME,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD,
  },
  jwt: {
    secret:         process.env.JWT_SECRET,
    refreshSecret:  process.env.JWT_REFRESH_SECRET,
    accessExpires:  process.env.JWT_ACCESS_EXPIRES  || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:4070',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max:      parseInt(process.env.RATE_LIMIT_MAX       || '100',    10),
  },
  logLevel: process.env.LOG_LEVEL || 'debug',
});

module.exports = config;

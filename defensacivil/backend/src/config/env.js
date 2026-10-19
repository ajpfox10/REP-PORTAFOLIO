const path   = require('path');
const dotenv = require('dotenv');

const appEnv = process.env.APP_ENV || 'dev';

// 1. .env.<entorno> dentro de backend/ (para correr sin Docker)
dotenv.config({ path: path.resolve(__dirname, '../../', `.env.${appEnv}`) });

// 2. .env.<entorno> en la raíz del proyecto (Docker u override global).
//    Las variables ya definidas no se pisan.
dotenv.config({ path: path.resolve(__dirname, '../../../', `.env.${appEnv}`) });

const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DB_PASSWORD', 'DB_NAME'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Variable de entorno requerida faltante: ${key}`);
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';

if (nodeEnv === 'production') {
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (process.env[key].length < 32) {
      throw new Error(`${key} debe tener al menos 32 caracteres en producción`);
    }
  }
  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET y JWT_REFRESH_SECRET deben ser distintos');
  }
}

const config = Object.freeze({
  nodeEnv,
  appEnv,
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
  cookie: {
    // En producción la cookie de sesión solo viaja por HTTPS
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : nodeEnv === 'production',
    // 'strict' si frontend y API comparten dominio (nginx); 'none' si están
    // en dominios distintos (por ejemplo, dos servicios de Railway)
    sameSite: ['strict', 'lax', 'none'].includes(process.env.COOKIE_SAMESITE) ? process.env.COOKIE_SAMESITE : 'strict',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:4070',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max:      parseInt(process.env.RATE_LIMIT_MAX       || '300',    10),
    authMax:  parseInt(process.env.RATE_LIMIT_AUTH_MAX  || '10',     10),
  },
  logLevel: process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug'),
  logDir:   process.env.LOG_DIR || null,
  autoImport: process.env.AUTO_IMPORT_DATA !== 'false',
});

module.exports = config;

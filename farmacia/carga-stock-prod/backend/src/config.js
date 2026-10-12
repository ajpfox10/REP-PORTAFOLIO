const path = require('path');
const dotenv = require('dotenv');

const envName = process.env.NODE_ENV === 'production' ? 'production' : 'development';
dotenv.config({ path: path.resolve(__dirname, `../.env.${envName}`) });

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Falta configurar ${key}`);
  }
}

module.exports = {
  envName,
  appName: process.env.APP_NAME || 'Carga de Stock Critico',
  port: Number(process.env.PORT || 4310),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4410',
  corsOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:4410')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4'
  },
  jwtSecret: process.env.JWT_SECRET,
  uploadDir: path.resolve(__dirname, process.env.UPLOAD_DIR || '../../uploads'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  scriptToken: process.env.SCRIPT_TOKEN || '',
  criticoSourceDir: process.env.CRITICO_SOURCE_DIR || 'D:\\FARMACIA\\CRITICO',
  stockSourceDir: process.env.STOCK_SOURCE_DIR || 'D:\\FARMACIA\\STOCK',
  etiquetasSourceDir: process.env.ETIQUETAS_SOURCE_DIR || 'D:\\FARMACIA\\ETIQUETAS',
  trimestreSourceDir: process.env.TRIMESTRE_SOURCE_DIR || process.env.SEMESTRE_SOURCE_DIR || 'D:\\FARMACIA\\TRIMESTRE',
  trimestreWatch: {
    // Sondeo automatico de la carpeta de trimestre. Se puede apagar con TRIMESTRE_WATCH=off.
    enabled: String(process.env.TRIMESTRE_WATCH || 'on').toLowerCase() !== 'off',
    intervalMs: Math.max(10000, Number(process.env.TRIMESTRE_WATCH_INTERVAL_MS || 60000))
  },
  criticoWatch: {
    // Sondeo automatico de la carpeta de stock critico. Se puede apagar con CRITICO_WATCH=off.
    enabled: String(process.env.CRITICO_WATCH || 'on').toLowerCase() !== 'off',
    intervalMs: Math.max(10000, Number(process.env.CRITICO_WATCH_INTERVAL_MS || process.env.TRIMESTRE_WATCH_INTERVAL_MS || 60000))
  },
  farmacia: {
    url: process.env.FARMACIA_WEB_URL || 'https://sistemas.ms.gba.gov.ar/intranet/intranet.php',
    user: process.env.FARMACIA_WEB_USER || '',
    password: process.env.FARMACIA_WEB_PASSWORD || '',
    sector: process.env.FARMACIA_WEB_SECTOR || 'FARMACIA UNIFICADA'
  }
};

const express        = require('express');
const helmet         = require('helmet');
const cors           = require('cors');
const cookieParser   = require('cookie-parser');
const config         = require('./config/env');
const { generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler }   = require('./middleware/errorHandler');
const logger             = require('./config/logger');

const app = express();

app.disable('x-powered-by');

// Detrás de nginx / Railway: la IP real viene en X-Forwarded-For
app.set('trust proxy', 1);

// Cabeceras de seguridad (la API solo devuelve JSON)
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginEmbedderPolicy: false,
}));

// CORS: solo hace falta si el frontend se sirve desde otro dominio
app.use(cors({
  origin:      config.cors.origin.split(',').map(o => o.trim()),
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

// Las respuestas de la API nunca se guardan en caché del navegador
app.use('/api/', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

if (config.nodeEnv !== 'production') {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });
}

app.use('/api/', generalLimiter);

// Health check (sin autenticación)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth',      require('./routes/auth.routes'));
app.use('/api/incidents', require('./routes/incidents.routes'));
app.use('/api/users',     require('./routes/users.routes'));
app.use('/api/geo',       require('./routes/geo.routes'));
app.use('/api/audit',     require('./routes/audit.routes'));

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use(errorHandler);

module.exports = app;

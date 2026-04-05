const express        = require('express');
const helmet         = require('helmet');
const cors           = require('cors');
const config         = require('./config/env');
const { generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler }   = require('./middleware/errorHandler');
const logger             = require('./config/logger');

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for API
  crossOriginEmbedderPolicy: false,
}));

// CORS
app.use(cors({
  origin:      config.cors.origin,
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Trust proxy (for rate limiting with real IPs behind nginx)
app.set('trust proxy', 1);

// Request logging (dev only)
if (config.nodeEnv !== 'production') {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });
}

// Rate limiting on all API routes
app.use('/api/', generalLimiter);

// Health check (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: config.appEnv, timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth',      require('./routes/auth.routes'));
app.use('/api/incidents', require('./routes/incidents.routes'));
app.use('/api/users',     require('./routes/users.routes'));
app.use('/api/geo',       require('./routes/geo.routes'));
app.use('/api/audit',     require('./routes/audit.routes'));

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Global error handler
app.use(errorHandler);

module.exports = app;

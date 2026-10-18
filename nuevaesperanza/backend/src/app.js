'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { pool } = require('./db');
const { loadUser } = require('./middleware/auth');
const { csrf } = require('./middleware/csrf');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 10000 : 300, standardHeaders: 'draft-7', legacyHeaders: false }));
  api.use(express.json({ limit: '50kb' }));
  api.use(cookieParser());
  api.use(csrf);
  api.use(loadUser);

  api.get('/csrf', (_req, res) => res.json({ csrfToken: res.locals.csrfToken }));
  api.use('/auth', require('./routes/auth.routes'));
  api.use('/', require('./routes/catalog.routes'));
  api.use('/', require('./routes/orders.routes'));
  api.use('/admin', require('./routes/admin.routes'));
  api.use(notFoundHandler);

  app.use('/api', api);

  // En producción el mismo servidor entrega el frontend compilado
  const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '7d' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

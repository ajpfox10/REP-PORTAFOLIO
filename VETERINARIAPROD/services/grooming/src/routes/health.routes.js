'use strict';

const { Router } = require('express');
const { db } = require('../grooming.common');

const router = Router();

router.get('/', async (_req, res) => {
  try {
    await db.getPool().execute('SELECT 1');
    res.status(200).json({ status: 'ok', service: 'grooming' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'grooming' });
  }
});

router.get('/live', (_req, res) => res.json({ status: 'ok', service: 'grooming' }));

router.get('/ready', async (_req, res) => {
  try {
    await db.getPool().execute('SELECT 1');
    res.status(200).json({ status: 'ready', service: 'grooming' });
  } catch {
    res.status(503).json({ status: 'not_ready', service: 'grooming' });
  }
});

module.exports = router;

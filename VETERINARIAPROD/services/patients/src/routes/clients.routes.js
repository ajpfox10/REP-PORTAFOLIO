'use strict';

const { Router } = require('express');
const clientsCoreRouter = require('./clients.core.routes');
const clientsGdprRouter = require('./clients.gdpr.routes');
const clientsSignaturesRouter = require('./clients.signatures.routes');

const router = Router();

router.use(clientsCoreRouter);
router.use(clientsGdprRouter);
router.use(clientsSignaturesRouter);

module.exports = router;

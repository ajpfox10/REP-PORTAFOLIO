'use strict';

const { Router } = require('express');
const { router: coreRouter } = require('./accounts.core.routes');
const { router: syncRouter } = require('./accounts.sync.routes');

const router = Router();

router.use(coreRouter);
router.use(syncRouter);

module.exports = router;

'use strict';

const { Router } = require('express');
const { router: readRouter } = require('./inbox.read.routes');
const { router: writeRouter } = require('./inbox.write.routes');
const { router: ingestRouter } = require('./inbox.ingest.routes');

const router = Router();

router.use(readRouter);
router.use(writeRouter);
router.use(ingestRouter);

module.exports = router;

'use strict';

const { Router } = require('express');
const { router: readRouter } = require('./hospitalization.read.routes');
const { router: writeRouter } = require('./hospitalization.write.routes');

const router = Router();

router.use(readRouter);
router.use(writeRouter);

module.exports = router;

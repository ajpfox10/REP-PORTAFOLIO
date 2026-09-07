'use strict';

const { Router } = require('express');
const { router: readRouter } = require('./surgery.read.routes');
const { router: writeRouter } = require('./surgery.write.routes');

const router = Router();

router.use(readRouter);
router.use(writeRouter);

module.exports = router;

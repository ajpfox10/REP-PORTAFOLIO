'use strict';

const { Router } = require('express');
const { router: readRouter } = require('./imaging.read.routes');
const { router: writeRouter } = require('./imaging.write.routes');

const router = Router();

router.use(readRouter);
router.use(writeRouter);

module.exports = router;

'use strict';

const { Router } = require('express');
const { router: readRouter } = require('./pathology.read.routes');
const { router: writeRouter } = require('./pathology.write.routes');

const router = Router();

router.use(readRouter);
router.use(writeRouter);

module.exports = router;

'use strict';

const { Router } = require('express');
const { router: readRouter } = require('./lab.orders.read.routes');
const { router: writeRouter } = require('./lab.orders.write.routes');

const router = Router();

router.use(readRouter);
router.use(writeRouter);

module.exports = { router };

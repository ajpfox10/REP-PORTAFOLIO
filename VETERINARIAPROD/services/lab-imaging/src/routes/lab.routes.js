'use strict';

const { Router } = require('express');
const { router: ordersRouter } = require('./lab.orders.routes');
const { router: catalogRouter } = require('./lab.catalog.routes');

const router = Router();

router.use(ordersRouter);
router.use(catalogRouter);

module.exports = router;

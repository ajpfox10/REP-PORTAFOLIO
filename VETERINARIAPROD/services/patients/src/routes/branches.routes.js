'use strict';

const { Router } = require('express');
const adminRouter = require('./branches.admin.routes');
const searchRouter = require('./branches.search.routes');
const historyRouter = require('./branches.history.routes');
const transfersRouter = require('./branches.transfers.routes');
const accessRouter = require('./branches.access.routes');
const inventoryRouter = require('./branches.inventory.routes');

const router = Router();

router.use(adminRouter);
router.use(searchRouter);
router.use(historyRouter);
router.use(transfersRouter);
router.use(accessRouter);
router.use(inventoryRouter);

module.exports = router;

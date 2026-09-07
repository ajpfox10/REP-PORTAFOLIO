'use strict';

const { Router } = require('express');
const { router: adminRouter } = require('./rules.admin.routes');
const { router: evaluateRouter } = require('./rules.evaluate.routes');

const router = Router();

router.use(adminRouter);
router.use(evaluateRouter);

module.exports = router;

'use strict';

const { Router } = require('express');
const { router: readRouter } = require('./vaccination.read.routes');
const { router: dewormingRouter, getDeworming, getDewormingAlerts, postDeworming, getDewormingProducts } = require('./vaccination.deworming.routes');

const router = Router();

router.use(readRouter);
router.use(dewormingRouter);

module.exports = router;
module.exports.getDeworming = getDeworming;
module.exports.getDewormingAlerts = getDewormingAlerts;
module.exports.postDeworming = postDeworming;
module.exports.getDewormingProducts = getDewormingProducts;

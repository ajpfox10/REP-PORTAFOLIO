'use strict';

const { Router } = require('express');
const { router: coreRouter } = require('./medical-records.core.routes');
const { router: sectionsRouter } = require('./medical-records.sections.routes');
const { router: prescriptionsRouter, getPrescriptions, postPrescriptions } = require('./medical-records.prescriptions.routes');

const router = Router();

router.use(coreRouter);
router.use(sectionsRouter);
router.use(prescriptionsRouter);

module.exports = router;
module.exports.getPrescriptions = getPrescriptions;
module.exports.postPrescriptions = postPrescriptions;

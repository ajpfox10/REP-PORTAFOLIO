'use strict';

const { Router } = require('express');
const patientsRelatedRouter = require('./patients.related.routes');
const patientsReadRouter = require('./patients.read.routes');
const patientsWriteRouter = require('./patients.write.routes');
const { router: patientsCatalogRouter, getSpeciesAllMiddleware, getBreedsAllMiddleware } = require('./patients.catalog.routes');

const router = Router();

router.use(patientsCatalogRouter);
router.use(patientsReadRouter);
router.use(patientsWriteRouter);
router.use(patientsRelatedRouter);

module.exports = router;
module.exports.getSpeciesAll = getSpeciesAllMiddleware;
module.exports.getBreedsAll = getBreedsAllMiddleware;

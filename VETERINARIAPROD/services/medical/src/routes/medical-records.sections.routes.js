'use strict';

const { Router } = require('express');
const { ensureMedicalRecordWritable } = require('./medical.common');

const anamnesisRouter = require('./medical-records.anamnesis.routes').router;
const physicalExamRouter = require('./medical-records.physical-exam.routes').router;
const diagnosesRouter = require('./medical-records.diagnoses.routes').router;
const treatmentsRouter = require('./medical-records.treatments.routes').router;
const signRouter = require('./medical-records.sign.routes').router;

const router = Router();

router.use('/:id', ensureMedicalRecordWritable);

router.use('/', anamnesisRouter);
router.use('/', physicalExamRouter);
router.use('/', diagnosesRouter);
router.use('/', treatmentsRouter);
router.use('/', signRouter);

module.exports = { router };

'use strict';

const { Router } = require('express');
const { router: readRouter, getAppointmentTypes } = require('./appointments.read.routes');
const { router: writeRouter, postTriage } = require('./appointments.write.routes');
const { router: calendarRouter } = require('./appointments.calendar.routes');

const router = Router();

router.use(readRouter);
router.use(writeRouter);
router.use(calendarRouter);

module.exports = router;
module.exports.postTriage = postTriage;
module.exports.getAppointmentTypes = getAppointmentTypes;

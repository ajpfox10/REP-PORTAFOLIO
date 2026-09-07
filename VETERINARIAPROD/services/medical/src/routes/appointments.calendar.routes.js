'use strict';

const { Router } = require('express');
const { router: icalRouter } = require('./appointments.calendar.ical.routes');
const { router: googleRouter } = require('./appointments.calendar.google.routes');

const router = Router();

router.use(icalRouter);
router.use(googleRouter);

module.exports = { router };

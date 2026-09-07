'use strict';

const { Router } = require('express');

const internalRouter = require('./auth/internal.routes');
const publicRouter = require('./auth/public.routes');
const protectedRouter = require('./auth/protected.routes');
const twoFactorRouter = require('./auth/two-factor.routes');
const googleRouter = require('./auth/google.routes');

const router = Router();

router.use(internalRouter);
router.use(publicRouter);
router.use(protectedRouter);
router.use(twoFactorRouter);
router.use(googleRouter);

module.exports = router;

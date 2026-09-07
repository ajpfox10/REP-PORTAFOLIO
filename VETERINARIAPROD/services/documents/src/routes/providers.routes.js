'use strict';

const { Router } = require('express');
const R = require('../../../../shared/response');
const { EMAIL_PROVIDER_CAPABILITIES } = require('../lib/capabilities');

const router = Router();

router.get('/', (_req, res) => R.ok(res, EMAIL_PROVIDER_CAPABILITIES));

module.exports = router;

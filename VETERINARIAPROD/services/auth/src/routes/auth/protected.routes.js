'use strict';

const { Router } = require('express');
const ctrl = require('../../controllers/auth.controller');
const {
  body,
  requireInternalSig,
  fromHeaders,
  validateRequest,
  strongPasswordField,
} = require('./_common');

const router = Router();

router.post('/logout-all', requireInternalSig, fromHeaders, ctrl.logoutAll);
router.get('/me', requireInternalSig, fromHeaders, ctrl.me);

router.post('/change-password',
  requireInternalSig,
  fromHeaders,
  body('currentPassword').notEmpty(),
  strongPasswordField('newPassword'),
  validateRequest,
  ctrl.changePassword
);

router.get('/sessions', requireInternalSig, fromHeaders, ctrl.listSessions);
router.delete('/sessions/:id', requireInternalSig, fromHeaders, ctrl.revokeSession);
router.get('/api-keys', requireInternalSig, fromHeaders, ctrl.listApiKeys);
router.post('/api-keys',
  requireInternalSig,
  fromHeaders,
  body('name').notEmpty().isLength({ max: 60 }),
  validateRequest,
  ctrl.createApiKey
);
router.delete('/api-keys/:id', requireInternalSig, fromHeaders, ctrl.deleteApiKey);

module.exports = router;

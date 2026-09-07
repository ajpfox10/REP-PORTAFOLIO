'use strict';

const { body } = require('express-validator');
const { captchaMiddleware } = require('../../../../../shared/captcha');
const { requireInternalSig } = require('../../../../../shared/internalAuth');
const { fromHeaders } = require('../../../../../shared/requestContext');
const { validateRequest } = require('../../../../../shared/validation');

const STRONG_PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/;

function strongPasswordField(fieldName) {
  return body(fieldName)
    .isLength({ min: 10 })
    .matches(STRONG_PASSWORD_RULE);
}

module.exports = {
  body,
  captchaMiddleware,
  requireInternalSig,
  fromHeaders,
  validateRequest,
  strongPasswordField,
};

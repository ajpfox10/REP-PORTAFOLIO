'use strict';

const crypto = require('crypto');
const { body } = require('express-validator');
const { validateRequest } = require('../../../../shared/validation');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const webrtc = require('../../../../shared/webrtc');
const fcm = require('../../../../shared/fcm');
const { sendTemplate } = require('../../../../shared/messaging');
const log = require('../../../../shared/logger');

module.exports = {
  crypto,
  body,
  validateRequest,
  db,
  R,
  webrtc,
  fcm,
  sendTemplate,
  log,
};

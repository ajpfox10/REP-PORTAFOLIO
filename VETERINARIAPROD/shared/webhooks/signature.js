'use strict';

/**
 * HMAC-SHA256 webhook signature — mirrors apipersonal webhook signing.
 *
 * Header: X-Vetmanager-Signature: sha256=<hex>
 * Verification: compare signatures with timingSafeEqual to prevent timing attacks.
 */

const crypto = require('crypto');
const { createLogger } = require('../logger');

const HEADER = 'X-Vetmanager-Signature';
const ALG    = 'sha256';
const log = createLogger('shared-webhook-signature');

/**
 * Sign a payload string with a secret.
 * @param {string} payload   JSON string
 * @param {string} secret    Webhook endpoint secret
 * @returns {string}         "sha256=<hex>"
 */
function sign(payload, secret) {
  const hmac = crypto.createHmac(ALG, secret).update(payload, 'utf8').digest('hex');
  return `${ALG}=${hmac}`;
}

/**
 * Verify incoming signature header.
 * @param {string} payload   Raw request body string
 * @param {string} header    Value of X-Vetmanager-Signature
 * @param {string} secret    Webhook endpoint secret
 * @returns {boolean}
 */
function verify(payload, header, secret) {
  try {
    const expected = Buffer.from(sign(payload, secret));
    const received = Buffer.from(header);
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch (err) {
    log.warn('Webhook signature verification failed', { error: err.message });
    return false;
  }
}

module.exports = { sign, verify, HEADER };

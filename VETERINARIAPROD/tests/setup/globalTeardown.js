'use strict';

module.exports = async function globalTeardown() {
  // Close any open DB/Redis connections created during tests
  try {
    const db = require('../../shared/db');
    await db.end?.();
  } catch (_) {}
};

// middleware/xssProtection.js
const xss = require('xss-clean');

module.exports = xss();

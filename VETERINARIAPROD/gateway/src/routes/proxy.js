'use strict';

const { registerProxies } = require('./proxy.registry');
const { SERVICES, makeProxy, makeServiceProxy } = require('./proxy.factory');

module.exports = { registerProxies, SERVICES, makeProxy, makeServiceProxy };

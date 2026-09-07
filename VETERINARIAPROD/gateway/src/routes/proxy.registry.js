'use strict';

const { injectVersionHeader } = require('../middleware/versioning');
const { registerPlatformRoutes } = require('./registries/platform.registry');
const { registerAuthRoutes } = require('./registries/auth.registry');
const { registerPatientsRoutes } = require('./registries/patients.registry');
const { registerMedicalRoutes } = require('./registries/medical.registry');
const { registerLabRoutes } = require('./registries/lab.registry');
const { registerBillingRoutes } = require('./registries/billing.registry');
const { registerEngagementRoutes } = require('./registries/engagement.registry');
const { registerPortalRoutes } = require('./registries/portal.registry');
const { registerAiRoutes } = require('./registries/ai.registry');
const { config } = require('../config');

const API_VERSIONS = config.supportedApiVersions;

function registerVersioned(app, method, pathSuffix, ...middlewares) {
  for (const version of API_VERSIONS) {
    app[method](`/api/${version}/${pathSuffix}`, injectVersionHeader(version), ...middlewares);
  }
}

function registerProxies(app) {
  registerPlatformRoutes(app, registerVersioned);
  registerAuthRoutes(app, registerVersioned);
  registerPatientsRoutes(app, registerVersioned);
  registerMedicalRoutes(app, registerVersioned);
  registerLabRoutes(app, registerVersioned);
  registerBillingRoutes(app, registerVersioned);
  registerEngagementRoutes(app, registerVersioned);
  registerPortalRoutes(app, registerVersioned);
  registerAiRoutes(app, registerVersioned);
}

module.exports = {
  API_VERSIONS,
  registerVersioned,
  registerProxies,
};

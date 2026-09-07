'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

function registerSpaRoutes(app) {
  const frontendDist = path.join(__dirname, '../../../andromeda-front/dist');
  if (!fs.existsSync(frontendDist)) return;

  app.use(express.static(frontendDist, { index: false }));
  app.get('*', (req, res, next) => {
    if (
      req.originalUrl.startsWith('/api/') ||
      req.originalUrl.startsWith('/health') ||
      req.originalUrl.startsWith('/metrics') ||
      req.originalUrl.startsWith('/csrf-token') ||
      req.originalUrl.startsWith('/.well-known') ||
      req.originalUrl.startsWith('/ws')
    ) return next();

    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

module.exports = { registerSpaRoutes };

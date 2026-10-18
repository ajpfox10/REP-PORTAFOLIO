'use strict';

const config = require('./config');
const { createApp } = require('./app');

createApp().listen(config.port, () => {
  console.log(`Nueva Esperanza API escuchando en http://localhost:${config.port}`);
});

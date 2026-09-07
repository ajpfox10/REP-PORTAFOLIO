'use strict';
/**
 * Plugin Loader — carga y registra todos los plugins disponibles.
 * Llamar una vez al inicio de cada servicio que quiera soporte de plugins.
 */
const registry = require('../shared/pluginRegistry');
const path     = require('path');
const fs       = require('fs');

const PLUGINS_DIR = __dirname;

function loadPlugins() {
  const files = fs.readdirSync(PLUGINS_DIR)
    .filter(f => f.endsWith('.js') && f !== 'index.js');

  for (const file of files) {
    try {
      const plugin = require(path.join(PLUGINS_DIR, file));
      if (plugin && plugin.id) {
        registry.register(plugin);
      }
    } catch (err) {
      console.warn(`[plugins] Failed to load plugin ${file}:`, err.message);
    }
  }
}

module.exports = { loadPlugins };

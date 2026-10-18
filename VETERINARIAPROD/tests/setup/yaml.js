'use strict';

// Helper YAML para tests: misma API que usaban los tests con yamljs
// (abandonado), implementada sobre js-yaml, que ya usa el gateway.
const fs = require('fs');
const jsYaml = require('js-yaml');

module.exports = {
  load: (filePath) => jsYaml.load(fs.readFileSync(filePath, 'utf8')),
  parse: (text) => jsYaml.load(text),
};

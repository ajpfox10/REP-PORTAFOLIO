const winston = require('winston');
const path    = require('path');
const config  = require('./env');

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

// En contenedores los logs van a la salida estándar. Si se define LOG_DIR,
// además se guardan en archivos.
const transports = [
  new winston.transports.Console({
    silent: config.appEnv === 'test',
    format: config.nodeEnv === 'production'
      ? combine(timestamp(), errors({ stack: true }), json())
      : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), simple()),
  }),
];

if (config.logDir) {
  transports.push(
    new winston.transports.File({
      filename: path.join(config.logDir, 'error.log'),
      level:    'error',
      format:   combine(timestamp(), errors({ stack: true }), json()),
    }),
    new winston.transports.File({
      filename: path.join(config.logDir, 'combined.log'),
      format:   combine(timestamp(), errors({ stack: true }), json()),
    }),
  );
}

const logger = winston.createLogger({
  level:       config.logLevel,
  transports,
  exitOnError: false,
});

module.exports = logger;

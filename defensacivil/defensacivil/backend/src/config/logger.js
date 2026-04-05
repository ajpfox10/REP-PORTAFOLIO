const winston = require('winston');
const path    = require('path');
const config  = require('./env');

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const transports = [
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/error.log'),
    level:    'error',
    format:   combine(timestamp(), errors({ stack: true }), json()),
  }),
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/combined.log'),
    format:   combine(timestamp(), errors({ stack: true }), json()),
  }),
];

if (config.nodeEnv !== 'production') {
  transports.push(new winston.transports.Console({
    format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), simple()),
  }));
}

const logger = winston.createLogger({
  level:       config.logLevel,
  transports,
  exitOnError: false,
});

module.exports = logger;

'use strict';

/**
 * shared/locale.js
 * Locale y timezone centralizados para todo el backend.
 *
 * Configuración (env):
 *   APP_LOCALE   — BCP 47 locale tag (default: 'es-AR')
 *   TZ           — IANA timezone (default: 'America/Argentina/Buenos_Aires')
 */

const LOCALE   = process.env.APP_LOCALE || 'es-AR';
const TIMEZONE = process.env.TZ          || 'America/Argentina/Buenos_Aires';

function formatDate(date) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, dateStyle: 'short' }).format(new Date(date));
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date(date));
}

function formatTime(date) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}

function formatCurrency(amount, currency = 'ARS') {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(amount || 0));
}

function formatNumber(n, opts = {}) {
  return Number(n || 0).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...opts });
}

module.exports = { LOCALE, TIMEZONE, formatDate, formatTime, formatDateTime, formatCurrency, formatNumber };

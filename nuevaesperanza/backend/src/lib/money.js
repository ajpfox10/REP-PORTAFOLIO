'use strict';

// Los importes se calculan en centavos para no arrastrar errores de punto flotante.
const toCents = (value) => Math.round(Number(value) * 100);
const fromCents = (cents) => Math.round(cents) / 100;

module.exports = { toCents, fromCents };

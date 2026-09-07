'use strict';

/**
 * Sirve /.well-known/security.txt
 * Permite que investigadores de seguridad reporten vulnerabilidades responsablemente.
 * Estándar: https://securitytxt.org / RFC 9116
 */

function _nextYear() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function securityTxtHandler(_req, res) {
  // Expires se calcula en cada request para que nunca quede un valor caducado
  // si el proceso lleva mucho tiempo activo.
  const SECURITY_TXT = `Contact: mailto:alejandrojavierpeveri@gmail.com
Preferred-Languages: es, en
Policy: Si encontrás una vulnerabilidad en esta aplicación, por favor reportala de forma responsable al contacto indicado antes de divulgarla públicamente. Agradecemos el reporte responsable.
Scope: *.vetmanager.io
Expires: ${_nextYear()}
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(SECURITY_TXT);
}

module.exports = { securityTxtHandler };

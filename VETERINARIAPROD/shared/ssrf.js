'use strict';

/**
 * shared/ssrf.js
 * Server-Side Request Forgery (SSRF) protection.
 *
 * Uso 1 — validar URLs antes de hacer fetch desde el servidor:
 *   const { validateUrl } = require('./ssrf');
 *   validateUrl(userProvidedUrl);   // lanza AppError si es peligrosa
 *   const res = await fetch(userProvidedUrl);
 *
 * Uso 2 — middleware para rutas que aceptan URLs en el body/query:
 *   const { ssrfMiddleware } = require('./ssrf');
 *   router.post('/webhook', ssrfMiddleware(['body.callbackUrl']), handler);
 *
 * Bloquea:
 *   - IPs privadas RFC-1918 (10.x, 172.16–31.x, 192.168.x)
 *   - Loopback (127.x, ::1)
 *   - Link-local (169.254.x, fe80::)
 *   - Metadata services (169.254.169.254 AWS/GCP/Azure)
 *   - Protocolos no-HTTP (file://, gopher://, dict://, ftp://, etc.)
 *   - Dominios/IPs vacíos o malformados
 *
 * Permite:
 *   SSRF_ALLOWED_HOSTS — lista de dominios/IPs explícitamente permitidos (CSV)
 *   SSRF_BLOCK_PRIVATE — 'false' para desactivar bloqueo privado (no recomendado)
 */

const dns  = require('dns').promises;
const { AppError } = require('./errors');

const BLOCK_PRIVATE = process.env.SSRF_BLOCK_PRIVATE !== 'false';

const ALLOWED_HOSTS = new Set(
  (process.env.SSRF_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
);

// Protocolos permitidos para fetch externo
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Rangos privados IPv4
const PRIVATE_RANGES = [
  [0x0A000000, 0x0AFFFFFF],   // 10.0.0.0/8
  [0xAC100000, 0xAC1FFFFF],   // 172.16.0.0/12
  [0xC0A80000, 0xC0A8FFFF],   // 192.168.0.0/16
  [0x7F000000, 0x7FFFFFFF],   // 127.0.0.0/8  (loopback)
  [0xA9FE0000, 0xA9FEFFFF],   // 169.254.0.0/16 (link-local / metadata)
  [0x00000000, 0x00FFFFFF],   // 0.0.0.0/8
];

function ipToLong(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIpv4(ip) {
  const long = ipToLong(ip);
  if (long === null) return false;
  return PRIVATE_RANGES.some(([lo, hi]) => long >= lo && long <= hi);
}

function isPrivateIpv6(ip) {
  // BUG-4: strip scope ID (e.g. fe80::1%eth0), normalizar a lowercase
  const lower = ip.toLowerCase().split('%')[0];

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extraer y validar la IPv4 embebida
  if (lower.startsWith('::ffff:')) {
    const embedded = lower.slice(7);
    if (embedded.includes('.')) return isPrivateIpv4(embedded);
  }

  return (
    lower === '::1' ||
    lower === '0:0:0:0:0:0:0:1' ||
    lower === '::' ||
    lower.startsWith('fe80') ||   // cubre fe80:: y fe80: con o sin ceros
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('::ffff:')   // IPv4-mapped genérico
  );
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip.includes(':')) return isPrivateIpv6(ip);
  return isPrivateIpv4(ip);
}

/**
 * Valida que una URL sea segura para hacer fetch desde el servidor.
 * @param {string} rawUrl
 * @throws {AppError} si la URL es peligrosa
 */
function validateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new AppError({ message: 'URL inválida', code: 'SSRF_INVALID_URL', http: 400 });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError({ message: 'URL malformada', code: 'SSRF_INVALID_URL', http: 400 });
  }

  // Protocolo permitido
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new AppError({
      message: `Protocolo no permitido: ${parsed.protocol}`,
      code: 'SSRF_PROTOCOL_BLOCKED',
      http: 400,
    });
  }

  const hostname = parsed.hostname.toLowerCase();

  // Host en lista blanca explícita → permitir siempre
  if (ALLOWED_HOSTS.has(hostname)) return;

  if (!BLOCK_PRIVATE) return;

  // BUG-7: rechazar IPs en formato decimal (ej: 2130706433 = 127.0.0.1)
  // Node.js URL parsea estos como hostname numérico, no como IP con puntos
  if (/^\d+$/.test(hostname)) {
    const decimalToIp = (n) => {
      const num = parseInt(n, 10);
      if (isNaN(num)) return null;
      return [(num >>> 24) & 0xFF, (num >>> 16) & 0xFF, (num >>> 8) & 0xFF, num & 0xFF].join('.');
    };
    const dotted = decimalToIp(hostname);
    if (!dotted || isPrivateIpv4(dotted)) {
      throw new AppError({ message: 'Acceso a dirección IP privada o de loopback no permitido', code: 'SSRF_PRIVATE_IP', http: 400 });
    }
  }

  // Rechazar si el hostname es directamente una IP privada
  if (isPrivateIp(hostname)) {
    throw new AppError({
      message: 'Acceso a dirección IP privada o de loopback no permitido',
      code: 'SSRF_PRIVATE_IP',
      http: 400,
    });
  }

  // Rechazar dominios que resuelven localmente (detección básica)
  const localDomains = ['localhost', 'local', 'internal', 'intranet', 'corp', 'lan'];
  if (localDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
    throw new AppError({
      message: 'Acceso a dominio interno no permitido',
      code: 'SSRF_INTERNAL_DOMAIN',
      http: 400,
    });
  }
}

/**
 * Valida URL con resolución DNS asíncrona (doble verificación post-lookup).
 * Úsala cuando quieras asegurarte de que el dominio no resuelve a una IP privada.
 * @param {string} rawUrl
 * @throws {AppError}
 */
async function validateUrlAsync(rawUrl) {
  validateUrl(rawUrl);   // validación síncrona primero

  if (!BLOCK_PRIVATE) return;

  let parsed;
  try { parsed = new URL(rawUrl); } catch { return; }

  const hostname = parsed.hostname;

  // Si ya es una IP, no hace falta resolver
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) return;

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        throw new AppError({
          message: `El dominio resuelve a una dirección privada (${address})`,
          code: 'SSRF_DNS_REBINDING',
          http: 400,
        });
      }
    }
  } catch (err) {
    if (err.code === 'SSRF_DNS_REBINDING') throw err;
    // DNS lookup failure → bloquear por precaución
    throw new AppError({
      message: 'No se pudo resolver el dominio',
      code: 'SSRF_DNS_FAILURE',
      http: 400,
    });
  }
}

/**
 * Middleware Express que valida campos URL en body/query/params.
 *
 * @param {string[]} fields — lista de rutas de campo en formato "body.callbackUrl"
 *                            o "query.imageUrl". Usa dot-notation.
 * @param {object}   [opts]
 * @param {boolean}  [opts.async=false] — usar validación DNS async
 *
 * @example
 *   router.post('/webhook', ssrfMiddleware(['body.callbackUrl']), handler);
 *   router.post('/fetch',   ssrfMiddleware(['body.url'], { async: true }), handler);
 */
function ssrfMiddleware(fields = [], opts = {}) {
  return async function(req, res, next) {
    try {
      for (const fieldPath of fields) {
        const [source, ...keys] = fieldPath.split('.');
        const container = req[source];
        if (!container) continue;

        let value = container;
        for (const key of keys) {
          value = value?.[key];
        }
        if (!value) continue;

        if (opts.async) {
          await validateUrlAsync(value);
        } else {
          validateUrl(value);
        }
      }
      next();
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        success: false,
        error: { message: err.message, code: err.code || 'SSRF_BLOCKED' },
      });
    }
  };
}

module.exports = { validateUrl, validateUrlAsync, ssrfMiddleware, isPrivateIp };

'use strict';

/**
 * AFIP — Factura Electrónica Argentina (WSFE).
 * Usa @afipsdk/afip.js que encapsula WSAA + WSFE via SOAP.
 *
 * OT-089 — RIESGO DE SUPPLY CHAIN:
 *   @afipsdk/afip.js no tiene auditoría pública de seguridad y es mantenida por
 *   un único contribuidor sin proceso de revisión formal. Mitigaciones aplicadas:
 *   - El SDK solo se instancia una vez por org (cache con TTL de 11h).
 *   - Todas las llamadas están envueltas en circuit breaker + timeout.
 *   - Las credenciales (cert/key/CUIT) vienen de secrets vault, no del SDK.
 *   Alternativa a evaluar: implementar el handshake WSAA/WSFE directamente
 *   con node-soap + xmlsec1 para eliminar la dependencia.
 *
 * Variables de entorno por organización (o globales de entorno):
 *   AFIP_CUIT          — CUIT de la organización (sin guiones, ej: 20123456789)
 *   AFIP_CERT          — Contenido del certificado .pem (o ruta con AFIP_CERT_PATH)
 *   AFIP_KEY           — Clave privada .key (o ruta con AFIP_KEY_PATH)
 *   AFIP_PRODUCTION    — 'true' para producción, 'false' para homologación (sandbox)
 *   AFIP_PUNTO_VENTA   — Número de punto de venta (ej: 1)
 *
 * Tipos de comprobante más comunes:
 *   1  = Factura A       (responsable inscripto → responsable inscripto)
 *   6  = Factura B       (responsable inscripto → consumidor final)
 *   11 = Factura C       (monotributista)
 *   3  = Nota de Crédito A
 *   8  = Nota de Crédito B
 *
 * Docs: https://www.afip.gob.ar/fe/documentos/
 */

const Afip = require('@afipsdk/afip.js');
const fs   = require('fs');
const db   = require('./db');
const { getSecret } = require('./secrets');
const { CircuitBreaker } = require('./circuitBreaker');
const { getRedisSingleton } = require('./redis');
const { createLogger } = require('./logger');

const log = createLogger('afip');
const afipBreaker = new CircuitBreaker('afip', { threshold: 3, timeout: 120000 });

// OT-050: timeout configurable para llamadas AFIP (SOAP puede tardar)
const AFIP_CALL_TIMEOUT_MS = parseInt(process.env.AFIP_CALL_TIMEOUT_MS || '45000', 10);
// OT-050: retry con backoff exponencial
const AFIP_MAX_RETRIES = parseInt(process.env.AFIP_MAX_RETRIES || '2', 10);

// OT-051: TTL de cache de instancias (11h — tokens WSAA expiran a las 12h)
const INSTANCE_CACHE_TTL_MS = parseInt(process.env.AFIP_INSTANCE_CACHE_TTL_MS || String(11 * 60 * 60 * 1000), 10);

// ── Cache de instancias por CUIT ──────────────────────────────────────────────
const _instances = new Map();

async function callWithTimeout(fn) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('AFIP call timeout'), { code: 'AFIP_TIMEOUT' })), AFIP_CALL_TIMEOUT_MS)
    ),
  ]);
}

async function callWithRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= AFIP_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    }
    try {
      return await callWithTimeout(fn);
    } catch (err) {
      lastErr = err;
      if (err.code === 'AFIP_TIMEOUT' || err.code === 'AFIP_CIRCUIT_OPEN') throw err;
    }
  }
  throw lastErr;
}

/**
 * Obtener instancia AFIP para una org.
 * Si la org tiene credenciales en DB las usa; si no, cae a las de entorno.
 * @param {number} orgId
 */
async function getInstance(orgId) {
  // OT-051: invalidar cache después de TTL (tokens WSAA expiran en 12h)
  if (_instances.has(orgId)) {
    const cached = _instances.get(orgId);
    if (Date.now() - cached.cachedAt < INSTANCE_CACHE_TTL_MS) return cached;
    _instances.delete(orgId);
  }

  // Intentar cargar credenciales desde DB
  let cuit, cert, key, production, puntoVenta;

  const creds = orgId
    ? await db.queryOne(
        `SELECT afip_cuit, afip_cert, afip_key, afip_production, afip_punto_venta
         FROM organizations WHERE id=:id`,
        { id: orgId }
      ).catch(() => null)
    : null;

  if (creds?.afip_cuit) {
    cuit        = creds.afip_cuit;
    cert        = creds.afip_cert;
    key         = creds.afip_key;
    production  = creds.afip_production === 1;
    puntoVenta  = creds.afip_punto_venta || 1;
  } else {
    // Fallback a variables de entorno
    cuit        = process.env.AFIP_CUIT;
    production  = process.env.AFIP_PRODUCTION === 'true';
    puntoVenta  = parseInt(process.env.AFIP_PUNTO_VENTA || '1');

    cert = getSecret('AFIP_CERT', { trim: false })
      || (process.env.AFIP_CERT_PATH ? fs.readFileSync(process.env.AFIP_CERT_PATH, 'utf8') : null);
    key  = getSecret('AFIP_KEY', { trim: false })
      || (process.env.AFIP_KEY_PATH  ? fs.readFileSync(process.env.AFIP_KEY_PATH,  'utf8') : null);
  }

  if (!cuit || !cert || !key) {
    throw new Error('Credenciales AFIP no configuradas para esta organización');
  }

  const instance = new Afip({ CUIT: cuit, cert, key, production, res_folder: '/tmp/afip_tokens' });
  // SEC: no almacenar el CUIT en el cache en memoria — reduce la superficie de exposición
  // en heap dumps o errores que serialicen el estado del proceso.
  _instances.set(orgId, { client: instance, puntoVenta, cachedAt: Date.now() });
  return _instances.get(orgId);
}

// ── Obtener último número de comprobante ──────────────────────────────────────
/**
 * @param {number} orgId
 * @param {number} tipoComprobante  (1=FA, 6=FB, 11=FC, etc.)
 */
async function getLastVoucherNumber(orgId, tipoComprobante) {
  if (!afipBreaker.canRequest()) throw Object.assign(new Error('AFIP circuit open'), { code: 'AFIP_CIRCUIT_OPEN' });
  const { client, puntoVenta } = await getInstance(orgId);
  try {
    const result = await callWithRetry(() => client.ElectronicBilling.getLastVoucher(puntoVenta, tipoComprobante));
    afipBreaker.onSuccess();
    return result;
  } catch (err) {
    afipBreaker.onFailure();
    throw err;
  }
}

// ── Autorizar comprobante (obtener CAE) ───────────────────────────────────────
/**
 * Crea el comprobante en AFIP y devuelve el CAE.
 *
 * @param {object} opts
 * @param {number}   opts.orgId
 * @param {number}   opts.tipoComprobante     1=FA, 6=FB, 11=FC
 * @param {number}   opts.tipoDocReceptor     80=CUIT, 86=CUIL, 96=DNI, 99=Consumidor Final
 * @param {string}   opts.nroDocReceptor      CUIT/DNI del receptor ('0' para consumidor final)
 * @param {number}   opts.importeTotal        Total de la factura
 * @param {number}   opts.importeNeto         Importe neto gravado
 * @param {number}   opts.importeIVA          Importe IVA
 * @param {number}   opts.importeNoGravado    Importe no gravado (0 si no aplica)
 * @param {number}   opts.importeExento       Importe exento (0 si no aplica)
 * @param {object[]} [opts.iva]               Alícuotas IVA [{id, baseImp, importe}]
 * @param {string}   [opts.concepto]          1=Productos, 2=Servicios, 3=Ambos (default 3)
 * @returns {{ cae, caeFechaVencimiento, nroComprobante }}
 */
async function authorizeVoucher(opts) {
  const {
    orgId, tipoComprobante, tipoDocReceptor = 99, nroDocReceptor = '0',
    importeTotal, importeNeto = 0, importeIVA = 0,
    importeNoGravado = 0, importeExento = 0,
    iva = [], concepto = '3',
    invoiceId = null,
  } = opts;

  if (!afipBreaker.canRequest()) throw Object.assign(new Error('AFIP circuit open'), { code: 'AFIP_CIRCUIT_OPEN' });

  const { client, puntoVenta } = await getInstance(orgId);

  // OT-046: lock Redis por org + tipoComprobante + puntoVenta para evitar numeración duplicada
  const lockKey = `afip:lock:${orgId}:${tipoComprobante}:${puntoVenta}`;
  const recoveryKey = invoiceId ? `afip:pending-cae:${invoiceId}` : null;
  let redis = null;
  let lockAcquired = false;

  try {
    redis = await getRedisSingleton('afip-lock', 'afip').catch(() => null);
  } catch {}

  if (redis?.isReady) {
    // OT-047: check si hay un CAE pendiente de una autorización anterior (DB update falló)
    if (recoveryKey) {
      try {
        const pending = await redis.get(recoveryKey);
        if (pending) {
          const recovered = JSON.parse(pending);
          log.warn('AFIP: recovering pending CAE from previous failed attempt', { invoiceId, cae: recovered.cae });
          return recovered;
        }
      } catch {}
    }

    const lockHolder = `${process.env.HOSTNAME || process.pid}:${Date.now()}`;
    const lockTtlMs = AFIP_CALL_TIMEOUT_MS * (AFIP_MAX_RETRIES + 1) + 5000;
    try {
      const acquired = await redis.set(lockKey, lockHolder, { NX: true, PX: lockTtlMs });
      lockAcquired = acquired === 'OK';
      if (!lockAcquired) {
        throw Object.assign(new Error('AFIP: otra instancia está autorizando comprobante para este punto de venta'), { code: 'AFIP_LOCK_BUSY' });
      }
    } catch (err) {
      if (err.code === 'AFIP_LOCK_BUSY') throw err;
      // Redis falla → continuar sin lock (fail open, mejor que bloquear)
    }
  }

  let result;
  try {
    const lastNumber = await callWithRetry(() =>
      client.ElectronicBilling.getLastVoucher(puntoVenta, tipoComprobante)
    );
    const nroComp = lastNumber + 1;

    const today = new Date();
    const fecha = today.toISOString().slice(0, 10).replace(/-/g, '');
    const vto = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10).replace(/-/g, '');

    const data = {
      'CantReg':      1,
      'PtoVta':       puntoVenta,
      'CbteTipo':     tipoComprobante,
      'Concepto':     parseInt(concepto),
      'DocTipo':      tipoDocReceptor,
      'DocNro':       nroDocReceptor,
      'CbteDesde':    nroComp,
      'CbteHasta':    nroComp,
      'CbteFch':      fecha,
      'ImpTotal':     importeTotal,
      'ImpTotConc':   importeNoGravado,
      'ImpNeto':      importeNeto,
      'ImpOpEx':      importeExento,
      'ImpIVA':       importeIVA,
      'ImpTrib':      0,
      'FchServDesde': concepto !== '1' ? fecha : null,
      'FchServHasta': concepto !== '1' ? fecha : null,
      'FchVtoPago':   concepto !== '1' ? vto   : null,
      'MonId':        'PES',
      'MonCotiz':     1,
      'Iva':          iva.length ? iva : [{ 'Id': 5, 'BaseImp': importeNeto, 'Importe': importeIVA }],
    };

    result = await callWithRetry(() => client.ElectronicBilling.createVoucher(data));
    afipBreaker.onSuccess();

    const returnValue = {
      cae:                result.CAE,
      caeFechaVencimiento: result.CAEFchVto,
      nroComprobante:     nroComp,
      puntoVenta,
    };

    // OT-047: guardar CAE en Redis como recovery antes de que el caller actualice la DB
    // El caller debe eliminar esta clave después del UPDATE exitoso
    if (recoveryKey && redis?.isReady) {
      try {
        await redis.set(recoveryKey, JSON.stringify(returnValue), { EX: 86400 }); // 24h TTL
      } catch {}
    }

    return returnValue;
  } catch (err) {
    afipBreaker.onFailure();
    throw err;
  } finally {
    if (lockAcquired && redis?.isReady) {
      redis.del(lockKey).catch(() => {});
    }
  }
}

/**
 * Eliminar la clave de recovery de Redis después de confirmar el UPDATE en DB.
 * Llamar desde la ruta, justo después del db.query exitoso.
 */
async function clearCaeRecovery(invoiceId) {
  if (!invoiceId) return;
  try {
    const redis = await getRedisSingleton('afip-lock', 'afip').catch(() => null);
    if (redis?.isReady) await redis.del(`afip:pending-cae:${invoiceId}`);
  } catch {}
}

// ── Tipos de comprobante ──────────────────────────────────────────────────────
const TIPOS_COMPROBANTE = {
  FACTURA_A:        1,
  NOTA_CREDITO_A:   3,
  NOTA_DEBITO_A:    2,
  FACTURA_B:        6,
  NOTA_CREDITO_B:   8,
  NOTA_DEBITO_B:    7,
  FACTURA_C:        11,
  NOTA_CREDITO_C:   13,
};

const TIPO_DOC = {
  CUIT: 80,
  CUIL: 86,
  DNI:  96,
  CONSUMIDOR_FINAL: 99,
};

/**
 * Determinar tipo de comprobante según la condición fiscal del receptor.
 * Responsable Inscripto → FA; Monotributo/Consumidor Final → FB
 * @param {'RI'|'MO'|'CF'|'EX'} condicionFiscal
 */
function getTipoComprobante(condicionFiscal) {
  return condicionFiscal === 'RI' ? TIPOS_COMPROBANTE.FACTURA_A : TIPOS_COMPROBANTE.FACTURA_B;
}

module.exports = {
  getInstance,
  getLastVoucherNumber,
  authorizeVoucher,
  clearCaeRecovery,
  TIPOS_COMPROBANTE,
  TIPO_DOC,
  getTipoComprobante,
};

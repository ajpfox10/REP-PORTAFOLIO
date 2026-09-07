'use strict';
/**
 * Cifra el document_number (DNI) de los clientes que todavía están en texto plano
 * y puebla el blind index (document_number_hash) para permitir búsqueda exacta.
 *
 * IMPORTANTE: ejecutar en el entorno que tiene el FIELD_ENCRYPTION_SECRET de PRODUCCIÓN
 * (p.ej. el shell de Railway del servicio patients). Si se corre con otra clave, la app
 * no podrá descifrar los valores -> pérdida de datos.
 *
 * Es idempotente: salta el cifrado de los registros que ya estén cifrados y solo
 * recalcula el hash cuando falta.
 *
 *   node scripts/maintenance/encrypt-client-dni.js
 */
require('dotenv').config();
const db = require('../../shared/db');
const { encrypt, decrypt, isEncrypted, hashForSearch } = require('../../shared/encryption');

(async () => {
  if (!process.env.FIELD_ENCRYPTION_SECRET) {
    console.error('ABORTADO: FIELD_ENCRYPTION_SECRET no está seteado en este entorno.');
    process.exit(1);
  }

  // ¿Existe la columna del blind index? (la migración de schema la agrega)
  const hashCol = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients'
        AND COLUMN_NAME = 'document_number_hash'`
  );
  const hasHashCol = hashCol.length > 0;
  if (!hasHashCol) {
    console.warn('AVISO: la columna clients.document_number_hash no existe — se omite el blind index.');
  }

  const rows = await db.query(
    `SELECT id, document_number${hasHashCol ? ', document_number_hash' : ''} FROM clients
      WHERE document_number IS NOT NULL AND document_number <> ''`
  );

  let cifrados = 0, saltados = 0, hashes = 0;
  for (const r of rows) {
    const yaCifrado = isEncrypted(r.document_number);
    const plain = yaCifrado ? decrypt(r.document_number) : r.document_number;

    const sets = [];
    const params = { id: r.id };
    if (!yaCifrado) {
      sets.push('document_number = :v');
      params.v = encrypt(r.document_number);
      cifrados++;
    } else {
      saltados++;
    }
    if (hasHashCol && plain && !r.document_number_hash) {
      sets.push('document_number_hash = :h');
      params.h = hashForSearch(plain);
      hashes++;
    }
    if (sets.length) {
      await db.query(`UPDATE clients SET ${sets.join(', ')} WHERE id = :id`, params);
    }
  }
  console.log(`document_number cifrados: ${cifrados} | ya cifrados: ${saltados} | hashes poblados: ${hashes} | total revisados: ${rows.length}`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

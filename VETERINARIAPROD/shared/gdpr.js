'use strict';

/**
 * shared/gdpr.js
 * Módulo de cumplimiento GDPR / Ley 25.326 (Argentina).
 *
 * Funcionalidades:
 *   - Gestión de consentimientos (registro, retiro)
 *   - Derecho de acceso: exportar todos los datos personales de un cliente
 *   - Derecho al olvido: anonimizar datos personales
 *   - Registro de solicitudes (access/erasure/portability/rectification)
 *   - Notificación de brechas de seguridad
 *   - Políticas de retención de datos
 */

const db         = require('./db');
const { hashDocument } = require('./digitalSignature');
const { decrypt } = require('./encryption');

// ─── Consentimientos ──────────────────────────────────────────────────────────

/**
 * Registra un consentimiento de un cliente.
 * @param {object} opts
 * @param {number} opts.clientId
 * @param {string} opts.consentType  — 'marketing','analytics','third_party','telemedicine','photo','data_sharing'
 * @param {boolean} opts.granted
 * @param {string} [opts.source]     — 'portal','staff','paper','sms'
 * @param {string} [opts.ip]
 * @param {string} [opts.userAgent]
 * @param {string} [opts.version]    — versión del texto de política
 */
async function recordConsent (opts) {
  const { clientId, orgId, consentType, granted, source = 'portal', ip, userAgent, version } = opts;

  const [r] = await db.query(
    `INSERT INTO gdpr_consents
       (client_id, org_id, consent_type, granted, granted_at, withdrawn_at, ip_address, user_agent)
     VALUES (:cid, :orgId, :type, :granted, :grantedAt, :withdrawnAt, :ip, :ua)
     ON DUPLICATE KEY UPDATE
       granted      = VALUES(granted),
       granted_at   = VALUES(granted_at),
       withdrawn_at = VALUES(withdrawn_at),
       ip_address   = VALUES(ip_address),
       updated_at   = NOW()`,
    {
      cid        : clientId,
      orgId      : orgId || null,
      type       : consentType,
      granted    : granted ? 1 : 0,
      grantedAt  : granted ? new Date() : null,
      withdrawnAt: granted ? null : new Date(),
      ip         : ip       || null,
      ua         : userAgent || null,
    }
  );
  return { id: r.insertId };
}

/**
 * Lista todos los consentimientos de un cliente.
 */
async function getConsents (clientId) {
  return db.query(
    `SELECT * FROM gdpr_consents WHERE client_id = :cid ORDER BY consent_type`,
    { cid: clientId }
  );
}

/**
 * Retira todos los consentimientos no esenciales de un cliente.
 */
async function withdrawAllConsents (clientId, source = 'portal') {
  const nonEssential = ['marketing', 'analytics', 'third_party', 'photo', 'data_sharing'];
  await db.query(
    `UPDATE gdpr_consents SET granted=0, updated_at=NOW()
     WHERE client_id=:cid AND consent_type IN (:types)`,
    { cid: clientId, types: nonEssential }
  );
}

// ─── Solicitudes ARCO (Acceso, Rectificación, Cancelación, Oposición) ─────────

/**
 * Registra una solicitud ARCO.
 * @param {object} opts
 * @param {number} opts.clientId
 * @param {string} opts.requestType — 'access'|'erasure'|'portability'|'rectification'|'restriction'
 * @param {string} [opts.notes]
 * @param {number} [opts.handledBy] — userId del operador (null si fue por portal)
 * @returns {Promise<{ requestId, dueDate }>}
 */
async function createDataRequest (opts) {
  const { clientId, orgId, branchId, requestType, notes } = opts;

  // Por ley: plazo máximo 30 días
  const dueDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  // org_id y branch_id son NOT NULL en gdpr_data_requests. completed_by se setea
  // recién al completar la solicitud (updateDataRequest), no al crearla.
  const [r] = await db.query(
    `INSERT INTO gdpr_data_requests
       (client_id, org_id, branch_id, request_type, status, notes, due_date)
     VALUES (:cid, :orgId, :branchId, :type, 'pending', :notes, :due)`,
    {
      cid     : clientId,
      orgId   : orgId || null,
      branchId: branchId || null,
      type    : requestType,
      notes   : notes || null,
      due     : dueDate,
    }
  );
  return { requestId: r.insertId, dueDate };
}

/**
 * Actualiza el estado de una solicitud.
 */
async function updateDataRequest (requestId, status, handledBy) {
  await db.query(
    `UPDATE gdpr_data_requests
     SET status=:status, completed_by=:uid, completed_at=IF(:status IN ('completed','rejected'), NOW(), NULL)
     WHERE id=:id`,
    { status, uid: handledBy, id: requestId }
  );
}

// ─── Exportación de datos (Derecho de Acceso / Portabilidad) ─────────────────

/**
 * Exporta todos los datos personales de un cliente en formato JSON.
 * GDPR Art. 15 + Art. 20 — Derecho de acceso y portabilidad.
 *
 * @param {number} clientId
 * @param {number} orgId — para validar que sea del org correcto
 * @returns {Promise<object>} — paquete completo de datos
 */
async function exportPersonalData (clientId, orgId) {
  const [
    client,
    patients,
    appointments,
    invoices,
    messages,
    consents,
    notifications,
    portalActivity,
  ] = await Promise.all([
    // Datos del cliente
    db.queryOne(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.dni,
              c.document_type, c.document_number,
              c.address, c.city, c.birthdate, c.notes,
              c.created_at, c.updated_at
       FROM clients c
       JOIN branches b ON c.branch_id = b.id AND b.organization_id = :orgId
       WHERE c.id = :cid`,
      { cid: clientId, orgId }
    ),

    // Pacientes asociados
    db.query(
      `SELECT p.id, p.name, p.birthdate, p.sex, p.chip_number, p.is_active, p.is_deceased,
              sp.common_name AS species, b.name AS breed, p.created_at
       FROM patients p
       JOIN patient_owners po ON po.patient_id = p.id AND po.client_id = :cid
       JOIN species sp ON p.species_id = sp.id
       LEFT JOIN breeds b ON p.breed_id = b.id`,
      { cid: clientId }
    ),

    // Historial de citas (sin datos médicos sensibles)
    db.query(
      `SELECT a.id, a.scheduled_date, a.status, a.reason,
              p.name AS patient_name, CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       JOIN users    u ON a.vet_id     = u.id
       WHERE a.client_id = :cid OR a.patient_id IN (
         SELECT patient_id FROM patient_owners WHERE client_id = :cid
       )
       ORDER BY a.scheduled_date DESC LIMIT 500`,
      { cid: clientId }
    ),

    // Facturas (sin datos de tarjeta)
    db.query(
      `SELECT i.id, i.invoice_number, i.issued_date, i.total_amount,
              i.paid_amount, i.status
       FROM invoices i WHERE i.client_id = :cid ORDER BY i.issued_date DESC LIMIT 200`,
      { cid: clientId }
    ),

    // Mensajes enviados
    db.query(
      `SELECT ml.channel, ml.template_name, ml.status, ml.sent_at
       FROM message_logs ml
       WHERE ml.related_entity_id = :cid AND ml.related_entity_type = 'client'
       ORDER BY ml.sent_at DESC LIMIT 100`,
      { cid: clientId }
    ),

    // Consentimientos
    db.query(
      `SELECT consent_type, granted, created_at, updated_at
       FROM gdpr_consents WHERE client_id = :cid`,
      { cid: clientId }
    ),

    // Notificaciones
    db.query(
      `SELECT channel AS type, title, body, status, created_at
       FROM notification_logs WHERE client_id = :cid ORDER BY created_at DESC LIMIT 100`,
      { cid: clientId }
    ),

    // Actividad del portal
    db.query(
      `SELECT action, ip_address, created_at
       FROM gdpr_audit_trail WHERE client_id = :cid
         AND action LIKE 'portal.%' ORDER BY created_at DESC LIMIT 200`,
      { cid: clientId }
    ),
  ]);

  if (!client) throw Object.assign(new Error('Cliente no encontrado'), { code: 'CLIENT_NOT_FOUND' });

  // document_number está cifrado en reposo: descifrar para incluir el documento real
  // en el export (Derecho de Acceso — el dato debe entregarse legible al titular).
  if (client.document_number) client.document_number = decrypt(client.document_number);

  const exportPackage = {
    exportDate   : new Date().toISOString(),
    dataController: process.env.ORG_NAME || 'VetManager Pro',
    legalBasis   : 'Ley 25.326 (Argentina) / GDPR Art. 15 & 20',
    client,
    patients,
    appointments,
    invoices,
    messages,
    consents,
    notifications,
    portalActivity,
  };

  // Añadir hash de integridad del paquete
  exportPackage._integrity = hashDocument(exportPackage);

  return exportPackage;
}

// ─── Anonimización (Derecho al Olvido) ───────────────────────────────────────

/**
 * Anonimiza los datos personales de un cliente (GDPR Art. 17).
 * Los registros médicos y financieros se mantienen por obligación legal,
 * pero se desvinculan del cliente real.
 *
 * @param {number} clientId
 * @param {number} orgId
 * @param {number} requestedBy
 */
async function anonymizeClient (clientId, orgId, requestedBy) {
  // Verificar que es del org correcto (fuera de la transacción — no bloquea)
  const client = await db.queryOne(
    `SELECT c.id FROM clients c
     JOIN branches b ON c.branch_id = b.id AND b.organization_id = :orgId
     WHERE c.id = :cid`,
    { cid: clientId, orgId }
  );
  if (!client) throw Object.assign(new Error('Cliente no encontrado'), { code: 'CLIENT_NOT_FOUND' });

  const anonPrefix = `ANON-${clientId}-${Date.now()}`;

  // BUG-22: envolver toda la anonimización en una transacción para atomicidad
  await db.transaction(async (conn) => {
    // Anonimizar datos del cliente
    await conn.query(
      `UPDATE clients SET
         first_name     = 'Anonimizado',
         last_name      = :prefix,
         email          = :email,
         phone          = NULL,
         dni            = NULL,
         document_number = NULL,
         document_number_hash = NULL,
         address        = NULL,
         city           = NULL,
         notes          = NULL,
         birthdate      = NULL,
         portal_password_hash = NULL,
         is_active      = FALSE,
         anonymized_at  = NOW(),
         anonymized_by  = :uid
       WHERE id = :cid`,
      {
        prefix : anonPrefix,
        email  : `${anonPrefix}@deleted.vetmanager.com`,
        uid    : requestedBy,
        cid    : clientId,
      }
    );

    // Eliminar tokens FCM del cliente
    await conn.query(
      `DELETE FROM user_fcm_tokens
       WHERE user_id IN (SELECT user_id FROM clients WHERE id = :cid LIMIT 1)`,
      { cid: clientId }
    ).catch(() => {});  // silenciar si no existe

    // BUG-20: eliminar sesiones de portal activas
    await conn.query(
      `DELETE FROM client_sessions WHERE client_id = :cid`,
      { cid: clientId }
    ).catch(() => {});

    // BUG-20: borrar datos sensibles de sesiones de telemedicina
    await conn.query(
      `UPDATE tele_sessions
       SET chief_complaint = NULL, notes = NULL, updated_at = NOW()
       WHERE client_id = :cid`,
      { cid: clientId }
    ).catch(() => {});

    // BUG-20: vaciar payload de trabajos de notificación pendientes para el cliente
    await conn.query(
      `UPDATE notification_retry_jobs
       SET payload_json = '{}'
       WHERE org_id = :orgId
         AND JSON_EXTRACT(payload_json, '$.clientId') = :cid`,
      { orgId, cid: clientId }
    ).catch(() => {});

    // Retirar todos los consentimientos
    await conn.query(
      `UPDATE gdpr_consents SET granted=0, updated_at=NOW() WHERE client_id=:cid`,
      { cid: clientId }
    );

    // Registrar en audit trail (org_id es NOT NULL)
    await conn.query(
      `INSERT INTO gdpr_audit_trail (org_id, client_id, action, performed_by, detail_json)
       VALUES (:orgId, :cid, 'erasure.completed', :uid, :detail_json)`,
      {
        orgId      : orgId,
        cid        : clientId,
        uid        : requestedBy,
        detail_json: JSON.stringify({ anonPrefix, timestamp: new Date().toISOString() }),
      }
    );
  });

  return { anonymized: true, reference: anonPrefix };
}

// ─── Brechas de seguridad ─────────────────────────────────────────────────────

/**
 * Registra una brecha de seguridad (GDPR Art. 33 — 72 hs para notificar a autoridad).
 */
async function reportBreach (opts) {
  const {
    orgId, title, severity, affectedRecords,
    description, discoveredBy, responseNotes,
  } = opts;

  // title es NOT NULL en data_breaches; derivar de la descripción si no se pasa.
  const breachTitle = title || (description ? String(description).slice(0, 200) : 'Brecha de seguridad');

  const [r] = await db.query(
    `INSERT INTO data_breaches
       (org_id, title, severity, affected_records, description,
        created_by, response_notes, status, detected_at)
     VALUES (:org, :title, :sev, :count, :desc, :by, :notes, 'detected', NOW())`,
    {
      org  : orgId,
      title: breachTitle,
      sev  : severity,
      count: affectedRecords || 0,
      desc : description,
      by   : discoveredBy || null,
      notes: responseNotes || null,
    }
  );
  // GDPR Art. 33 / Ley 25.326: plazo de 72 hs para notificar a la autoridad.
  const notifyDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  return { breachId: r.insertId, notifyDeadline };
}

// ─── Políticas de retención ───────────────────────────────────────────────────

/**
 * Devuelve las políticas de retención configuradas.
 * Base legal: obligaciones contables (10 años), datos médicos (variable según jurisdicción).
 */
function getRetentionPolicies () {
  return [
    { dataType: 'invoices',          retentionYears: 10, legalBasis: 'Código de Comercio Argentina'  },
    { dataType: 'medical_records',   retentionYears: 10, legalBasis: 'Ley 17.132 + resoluciones SENASA' },
    { dataType: 'prescriptions',     retentionYears:  5, legalBasis: 'Resolución SENASA 539/2001'    },
    { dataType: 'audit_logs',        retentionYears:  3, legalBasis: 'Política interna'              },
    { dataType: 'message_logs',      retentionYears:  1, legalBasis: 'Política interna'              },
    { dataType: 'session_tokens',    retentionYears: 0.08, legalBasis: 'Seguridad (30 días)'        },
    { dataType: 'client_pii',        retentionYears:  5, legalBasis: 'Ley 25.326 Argentina'         },
  ];
}

/**
 * Identifica clientes inactivos que superaron la política de retención.
 * @param {number} orgId
 * @returns {Promise<object[]>} — lista de candidatos a anonimizar
 */
async function findRetentionCandidates (orgId) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);  // 5 años sin actividad

  return db.query(
    `SELECT c.id, c.first_name, c.last_name, c.email,
            MAX(i.issued_date) AS last_invoice,
            MAX(a.scheduled_date) AS last_appointment,
            GREATEST(
              COALESCE(MAX(i.issued_date), '2000-01-01'),
              COALESCE(MAX(a.scheduled_date), '2000-01-01')
            ) AS last_activity
     FROM clients c
     LEFT JOIN invoices     i ON i.client_id = c.id
     LEFT JOIN patient_owners po ON po.client_id = c.id AND po.ownership_type='primary'
     LEFT JOIN appointments a ON a.patient_id IN (SELECT patient_id FROM patient_owners WHERE client_id=c.id)
     JOIN branches b ON c.branch_id = b.id AND b.organization_id = :orgId
     WHERE c.is_active = TRUE AND c.anonymized_at IS NULL
     GROUP BY c.id
     HAVING last_activity < :cutoff
     ORDER BY last_activity ASC
     LIMIT 100`,
    { orgId, cutoff: cutoff.toISOString().slice(0, 10) }
  );
}

// ─── Clasificación de datos ───────────────────────────────────────────────────

/**
 * Data classification schema — maps resource/field types to sensitivity levels.
 *
 * Levels (ascending sensitivity):
 *   public       — shareable outside the org without restriction
 *   internal     — visible to all org staff
 *   confidential — limited to role-based access within org
 *   restricted   — strictly need-to-know (PHI / financial / credentials)
 */
const DATA_CLASSIFICATION = {
  // ── Public ───────────────────────────────────────────────────────────────
  species:          { level: 'public',       description: 'Taxonomic reference data' },
  breeds:           { level: 'public',       description: 'Breed reference data' },

  // ── Internal ─────────────────────────────────────────────────────────────
  appointments:     { level: 'internal',     description: 'Appointment scheduling data' },
  invoices_summary: { level: 'internal',     description: 'Invoice summary (no payment details)' },
  audit_logs:       { level: 'internal',     description: 'Operational audit trail' },

  // ── Confidential ──────────────────────────────────────────────────────────
  patients:         { level: 'confidential', description: 'Animal patient records' },
  medical_records:  { level: 'confidential', description: 'Veterinary medical records (PHI)' },
  diagnoses:        { level: 'confidential', description: 'Diagnoses and clinical findings' },
  prescriptions:    { level: 'confidential', description: 'Prescription and medication data' },
  lab_results:      { level: 'confidential', description: 'Laboratory and imaging results' },

  // ── Restricted ────────────────────────────────────────────────────────────
  clients_pii:      { level: 'restricted',   description: 'Client personal identifiable information' },
  payment_details:  { level: 'restricted',   description: 'Payment methods and card data' },
  credentials:      { level: 'restricted',   description: 'Passwords, tokens, API keys' },
  gdpr_consents:    { level: 'restricted',   description: 'Consent records (legal obligation)' },
  user_credentials: { level: 'restricted',   description: '2FA secrets, session tokens' },
};

/**
 * Returns the classification for a resource type, or null if unknown.
 * @param {string} resourceType
 * @returns {{ level: string, description: string }|null}
 */
function classifyResource(resourceType) {
  return DATA_CLASSIFICATION[resourceType] || null;
}

// ─── Aplicación automática de retención ───────────────────────────────────────

/**
 * Enforce data retention: identify and anonymize clients who exceed the
 * retention window (5 years without activity).
 *
 * Designed to be called from a nightly cron job.
 *
 * @param {number} orgId
 * @param {number} systemUserId  — userId to attribute the anonymization to (e.g. system bot)
 * @returns {Promise<{ processed: number, errors: number, results: object[] }>}
 */
async function enforceRetention(orgId, systemUserId) {
  const candidates = await findRetentionCandidates(orgId);
  if (!candidates.length) return { processed: 0, errors: 0, results: [] };

  const results = [];
  let errors = 0;

  for (const client of candidates) {
    try {
      const ref = await anonymizeClient(client.id, orgId, systemUserId);
      results.push({ clientId: client.id, status: 'anonymized', reference: ref.reference });
    } catch (err) {
      errors++;
      results.push({ clientId: client.id, status: 'error', error: err.message });
    }
  }

  return { processed: candidates.length - errors, errors, results };
}

module.exports = {
  recordConsent,
  getConsents,
  withdrawAllConsents,
  createDataRequest,
  updateDataRequest,
  exportPersonalData,
  anonymizeClient,
  reportBreach,
  getRetentionPolicies,
  findRetentionCandidates,
  enforceRetention,
  DATA_CLASSIFICATION,
  classifyResource,
};

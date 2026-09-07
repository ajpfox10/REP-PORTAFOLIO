'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const {
  db,
  R,
  ai,
  decrypt,
  buildPatientSelect,
  buildDiagnosisPrompt,
  requirePerm,
  validate,
  getUser,
  log,
} = require('../ai.common');

const router = Router();

router.post('/',
  requirePerm('ai:use'),
  body('patientId').isInt({ min: 1 }),
  body('symptoms').isArray({ min: 1 }),
  body('symptoms.*').isString().trim().notEmpty(),
  body('anamnesis').optional().isString(),
  body('contextLines').optional().isInt({ min: 1, max: 20 }).toInt(),
  validate,
  async (req, res, next) => {
    try {
      const { patientId, symptoms, anamnesis, contextLines = 3 } = req.body;
      const user = getUser(req);
      const { select, orgFilter } = await buildPatientSelect();

      const patient = await db.queryOne(
        `SELECT ${select}
         FROM patients p
         LEFT JOIN species sp ON p.species_id = sp.id
         LEFT JOIN breeds  br ON p.breed_id   = br.id
         WHERE p.id = :pid ${orgFilter}`,
        { pid: patientId, org: user.orgId }
      );
      if (!patient) return R.notFound(res, 'Paciente no encontrado');

      const records = await db.query(
        `SELECT mr.created_at, mr.chief_complaint, mr.notes,
                GROUP_CONCAT(DISTINCT d.diagnosis_name ORDER BY d.is_primary DESC SEPARATOR '||') AS diagnoses
         FROM medical_records mr
         JOIN patients p ON p.id = mr.patient_id
         LEFT JOIN diagnoses d ON d.medical_record_id = mr.id
         WHERE mr.patient_id = :pid AND p.organization_id = :org
         GROUP BY mr.id, mr.created_at, mr.chief_complaint, mr.notes
         ORDER BY mr.created_at DESC LIMIT :n`,
        { pid: patientId, org: user.orgId, n: contextLines }
      );
      const recentHistory = records.length
        ? '<patient_history>\n' + records.map((r) => {
            const when = r.created_at?.toISOString?.().slice(0, 10) ?? '';
            const diagnoses = (r.diagnoses || '')
              .split('||')
              .filter(Boolean)
              .map(decrypt)
              .join(', ') || 'N/A';
            const notes = decrypt(r.notes) || 'N/A';
            const complaint = decrypt(r.chief_complaint) || 'N/A';
            return `<entry date="${when}"><chief_complaint>${complaint}</chief_complaint><diagnoses>${diagnoses}</diagnoses><notes>${notes}</notes></entry>`;
          }).join('\n') + '\n</patient_history>'
        : null;

      const messages = buildDiagnosisPrompt(patient, symptoms, anamnesis, recentHistory);
      const raw = await ai.complete(messages, { json: true, maxTokens: 1500, temperature: 0.2 });

      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (err) {
        log.warn('diagnosis parse failed', { err: err.message });
        parsed = { diagnoses: [], urgency: 'routine', disclaimer: raw, parseError: true };
      }

      const [ins] = await db.query(
        `INSERT INTO ai_diagnosis_suggestions
           (patient_id, org_id, symptoms_json, anamnesis, diagnoses_json, urgency, model_provider, requested_by)
         VALUES (:pid, :org, :symp, :anamnesis, :dx, :urgency, :prov, :uid)`,
        {
          pid: patientId,
          org: user.orgId,
          symp: JSON.stringify(symptoms),
          anamnesis: anamnesis || null,
          dx: JSON.stringify(parsed.diagnoses || []),
          urgency: parsed.urgency || 'routine',
          prov: ai.PROVIDER,
          uid: user.userId,
        }
      ).catch((err) => {
        log.warn('diagnosis suggestion insert failed', { err: err.message });
        return [{ insertId: null }];
      });

      return R.ok(res, { id: ins.insertId, patient: { id: patient.id, name: patient.name }, ...parsed });
    } catch (e) { next(e); }
  }
);

module.exports = router;

'use strict';

const { Router } = require('express');
const { param } = require('express-validator');
const {
  db,
  R,
  computeRiskScores,
  summarizeRisks,
  decryptRows,
  requirePerm,
  validate,
  getUser,
  ensurePatientInUserScope,
  log,
} = require('../ai.common');

const router = Router();

router.get('/:patientId/risk',
  requirePerm('ai:use'),
  param('patientId').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const user = getUser(req);
      const { patientId } = req.params;
      const scoped = await ensurePatientInUserScope(patientId, user);
      if (!scoped) return R.notFound(res, 'Paciente no encontrado');

      const patient = await db.queryOne(
        `SELECT p.id, p.name, p.birthdate, p.sex, p.weight_kg AS weight,
                sp.common_name AS species, br.name AS breed
         FROM patients p
         LEFT JOIN species sp ON p.species_id = sp.id
         LEFT JOIN breeds  br ON p.breed_id   = br.id
         WHERE p.id = :pid AND p.organization_id = :org`,
        { pid: patientId, org: user.orgId }
      );
      if (!patient) return R.notFound(res, 'Paciente no encontrado');

      const today = new Date().toISOString().slice(0, 10);
      const [{ overdueCount }] = await db.query(
        `SELECT COUNT(*) AS overdueCount FROM vaccinations
         WHERE patient_id = :pid AND next_due_date < :today AND is_active = TRUE`,
        { pid: patientId, today }
      ).catch((err) => {
        log.warn('risk overdue vaccination check failed', { err: err.message });
        return [{ overdueCount: 0 }];
      });

      const lastRecord = await db.queryOne(
        `SELECT MAX(created_at) AS lastCheckup FROM medical_records WHERE patient_id = :pid`,
        { pid: patientId }
      );

      const chronicRows = await db.query(
        `SELECT DISTINCT d.diagnosis_name AS diagnosis
         FROM medical_records mr
         JOIN patients p ON p.id = mr.patient_id
         JOIN diagnoses d ON d.medical_record_id = mr.id
         WHERE mr.patient_id = :pid AND p.organization_id = :org
         ORDER BY mr.created_at DESC LIMIT 20`,
        { pid: patientId, org: user.orgId }
      ).catch((err) => {
        log.warn('risk chronic conditions query failed', { err: err.message });
        return [];
      });
      const chronicConditions = decryptRows(chronicRows, ['diagnosis']).map((r) => r.diagnosis).filter(Boolean);

      const history = {
        overdueVaccinations: parseInt(overdueCount, 10) || 0,
        lastCheckup: lastRecord?.lastCheckup || null,
        chronicConditions,
      };
      const riskResult = computeRiskScores(patient, history);
      const summary = summarizeRisks(riskResult);

      await db.query(
        `INSERT INTO ai_risk_assessments
           (patient_id, org_id, overall_level, risks_json, recommendations_json, history_snapshot_json)
         VALUES (:pid, :org, :level, :risks, :recs, :snap)`,
        {
          pid: patientId,
          org: user.orgId,
          level: riskResult.overallLevel,
          risks: JSON.stringify(riskResult.risks),
          recs: JSON.stringify(summary.recommendations),
          snap: JSON.stringify({ overdueVaccinations: history.overdueVaccinations, lastCheckup: history.lastCheckup }),
        }
      ).catch((err) => log.warn('risk assessment insert failed', { err: err.message }));

      return R.ok(res, {
        patient: { id: patient.id, name: patient.name, species: patient.species, breed: patient.breed },
        ...riskResult,
        ...summary,
      });
    } catch (e) { next(e); }
  }
);

router.get('/:patientId/risk/history',
  requirePerm('ai:use'),
  param('patientId').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const user = getUser(req);
      const scoped = await ensurePatientInUserScope(req.params.patientId, user);
      if (!scoped) return R.notFound(res, 'Paciente no encontrado');

      const rows = await db.query(
        `SELECT id, overall_level, risks_json, recommendations_json, computed_at
         FROM ai_risk_assessments
         WHERE patient_id = :pid AND org_id = :org
         ORDER BY computed_at DESC LIMIT 20`,
        { pid: req.params.patientId, org: user.orgId }
      ).catch((err) => {
        log.warn('risk history query failed', { err: err.message });
        return [];
      });
      return R.ok(res, rows);
    } catch (e) { next(e); }
  }
);

module.exports = router;

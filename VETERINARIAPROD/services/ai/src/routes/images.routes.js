'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const {
  db,
  R,
  ai,
  buildImagePrompt,
  requirePerm,
  validate,
  getUser,
  log,
} = require('../ai.common');

const router = Router();

router.post('/analyze',
  requirePerm('ai:use'),
  body('patientId').isInt({ min: 1 }),
  body('imageType').isIn(['xray', 'ultrasound', 'blood_smear', 'cytology', 'histology', 'fundoscopy', 'ecg', 'other']),
  body('imageUrl').optional().isURL(),
  body('imageBase64').optional().isString().isLength({ max: 8_388_608 }).withMessage('imageBase64 no puede superar 8 MB').custom((val) => {
    if (val !== undefined && !val.startsWith('data:image/')) {
      throw new Error('imageBase64 debe incluir el prefijo data:image/<type>;base64,');
    }
    return true;
  }),
  body('labResultId').optional().isInt({ min: 1 }).toInt(),
  body('region').optional().isString(),
  body('clinicalContext').optional().isString(),
  validate,
  async (req, res, next) => {
    try {
      const { patientId, imageType, imageUrl, imageBase64, region, clinicalContext, labResultId } = req.body;
      const user = getUser(req);
      if (!imageUrl && !imageBase64) return R.badRequest(res, 'Se requiere imageUrl o imageBase64');

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

      const prompt = buildImagePrompt(imageType, patient, region, clinicalContext);
      const rawAnalysis = await ai.analyzeImage(imageUrl || imageBase64, prompt);

      let parsed;
      try { parsed = JSON.parse(rawAnalysis); }
      catch (err) {
        log.warn('image analysis parse failed', { err: err.message });
        parsed = { findings: [], assessment: rawAnalysis, severity: 'unknown', recommendations: [], parseError: true };
      }

      const [ins] = await db.query(
        `INSERT INTO ai_image_analyses
           (patient_id, org_id, lab_result_id, image_type, region, severity,
            findings_json, assessment, recommendations_json, model_provider, requested_by)
         VALUES (:pid, :org, :labId, :type, :region, :sev, :findings, :assess, :recs, :prov, :uid)`,
        {
          pid: patientId,
          org: user.orgId,
          labId: labResultId || null,
          type: imageType,
          region: region || null,
          sev: parsed.severity || 'unknown',
          findings: JSON.stringify(parsed.findings || []),
          assess: parsed.assessment || '',
          recs: JSON.stringify(parsed.recommendations || []),
          prov: ai.PROVIDER,
          uid: user.userId,
        }
      ).catch((err) => {
        log.warn('image analysis insert failed', { err: err.message });
        return [{ insertId: null }];
      });

      return R.ok(res, { id: ins.insertId, patient: { id: patient.id, name: patient.name }, ...parsed });
    } catch (e) { next(e); }
  }
);

module.exports = router;

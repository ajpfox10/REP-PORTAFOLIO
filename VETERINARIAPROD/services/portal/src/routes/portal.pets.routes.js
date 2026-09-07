'use strict';

const { Router } = require('express');
const { db, R, portalAuth, decryptRows } = require('../portal.common');

const router = Router();

async function requireOwnership(clientId, patientId) {
  return db.queryOne(
    `SELECT 1 FROM patient_owners WHERE patient_id=:pid AND client_id=:cid AND deleted_at IS NULL`,
    { pid: patientId, cid: clientId }
  );
}

router.get('/', portalAuth, async (req, res, next) => {
  try {
    const pets = await db.query(
      `SELECT p.id, p.name,
              COALESCE(p.birthdate, p.birth_date) AS birth_date,
              p.sex, p.color,
              COALESCE(p.chip_number, p.microchip_number) AS microchip_number,
              p.photo_url, sp.common_name AS species, br.name AS breed, p.is_active
       FROM patients p
       JOIN patient_owners po ON po.patient_id = p.id AND po.client_id = :cid AND po.deleted_at IS NULL
       JOIN species sp ON p.species_id = sp.id
       LEFT JOIN breeds br ON p.breed_id = br.id
       WHERE p.is_active = 1
       ORDER BY p.name`,
      { cid: req.owner.clientId }
    );
    return R.ok(res, pets);
  } catch (e) { next(e); }
});

router.get('/:id', portalAuth, async (req, res, next) => {
  try {
    const pet = await db.queryOne(
      `SELECT p.id, p.name,
              COALESCE(p.birthdate, p.birth_date) AS birth_date,
              p.sex, p.color,
              COALESCE(p.chip_number, p.microchip_number) AS microchip_number,
              p.photo_url, p.is_active, p.is_deceased, p.weight_kg,
              sp.common_name AS species, br.name AS breed
       FROM patients p
       JOIN patient_owners po ON po.patient_id=p.id AND po.client_id=:cid AND po.deleted_at IS NULL
       JOIN species sp ON p.species_id=sp.id
       LEFT JOIN breeds br ON p.breed_id=br.id
       WHERE p.id=:pid`,
      { cid: req.owner.clientId, pid: req.params.id }
    );
    if (!pet) return R.notFound(res, 'Mascota no encontrada');
    const allergies = await db.query(`SELECT allergen, reaction_type, severity FROM patient_allergies WHERE patient_id=:pid AND is_active=1`, { pid: pet.id });
    return R.ok(res, { ...pet, allergies });
  } catch (e) { next(e); }
});

router.get('/:id/medical-history', portalAuth, async (req, res, next) => {
  try {
    const owned = await requireOwnership(req.owner.clientId, req.params.id);
    if (!owned) return R.forbidden(res, 'Sin acceso a esta mascota');

    const records = await db.query(
      `SELECT mr.id,
              mr.opened_at AS visit_date,
              mr.chief_complaint AS reason_for_visit,
              mr.status,
              mr.weight_kg,
              mr.temperature_celsius,
              mr.chief_complaint,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM medical_records mr
       JOIN users u ON mr.vet_id = u.id
       WHERE mr.patient_id=:pid AND mr.status='signed'
       ORDER BY mr.opened_at DESC
       LIMIT 100`,
      { pid: req.params.id }
    );
    return R.ok(res, decryptRows(records, ['reason_for_visit', 'chief_complaint']));
  } catch (e) { next(e); }
});

router.get('/:id/vaccinations', portalAuth, async (req, res, next) => {
  try {
    const owned = await requireOwnership(req.owner.clientId, req.params.id);
    if (!owned) return R.forbidden(res, 'Sin acceso a esta mascota');
    const rows = await db.query(
      `SELECT v.id, vc.name AS vaccine_name, v.vaccination_date AS administered_date,
              v.next_due_date, v.batch_number AS lot_number, vc.manufacturer,
              CONCAT(u.first_name,' ',u.last_name) AS applied_by
       FROM vaccinations v
       JOIN vaccines vc ON vc.id = v.vaccine_id
       LEFT JOIN users u ON v.administered_by = u.id
       WHERE v.patient_id=:pid
       ORDER BY v.vaccination_date DESC
       LIMIT 200`,
      { pid: req.params.id }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/:id/prescriptions', portalAuth, async (req, res, next) => {
  try {
    const owned = await requireOwnership(req.owner.clientId, req.params.id);
    if (!owned) return R.forbidden(res, 'Sin acceso a esta mascota');
    // SECURITY: join patient_owners para garantizar que el paciente pertenece al cliente
    // y evitar IDOR cross-org a través de medical_records
    const rows = await db.query(
      `SELECT p.id, p.created_at AS prescribed_date, pi.medication_name, pi.dose AS dosage, pi.frequency,
              pi.duration_days, pi.instructions, p.refills_allowed,
              CONCAT(u.first_name,' ',u.last_name) AS prescribed_by
       FROM prescriptions p
       JOIN medical_records mr ON p.medical_record_id = mr.id
       JOIN patient_owners po ON po.patient_id = mr.patient_id AND po.client_id = :cid
       LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
       JOIN users u ON p.prescribed_by = u.id
       WHERE mr.patient_id=:pid
       ORDER BY p.created_at DESC
       LIMIT 200`,
      { pid: req.params.id, cid: req.owner.clientId }
    );
    return R.ok(res, decryptRows(rows, ['medication_name', 'instructions']));
  } catch (e) { next(e); }
});

module.exports = router;

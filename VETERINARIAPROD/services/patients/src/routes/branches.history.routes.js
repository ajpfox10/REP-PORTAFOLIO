'use strict';

const { Router } = require('express');
const { db, R, mb, logBranchesError } = require('./branches.common');

const router = Router();

router.get('/patients/:id/history', async (req, res, next) => {
  try {
    // OT-SEC: verificar que el paciente pertenece a la org del usuario (a través de
    // su dueño primario y el branch). La historia cross-branch es intencional para
    // administradores, pero el paciente debe ser de la misma org.
    const patient = await db.queryOne(
      `SELECT p.id, p.name, sp.common_name AS species
       FROM patients p
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type = 'primary'
       JOIN clients cl ON po.client_id = cl.id
       JOIN branches b ON cl.branch_id = b.id AND b.organization_id = :orgId
       JOIN species sp ON p.species_id = sp.id
       WHERE p.id = :pid
         AND COALESCE(p.is_active, p.active, 1) != 0`,
      { pid: req.params.id, orgId: req.user.orgId }
    );
    if (!patient) return R.notFound(res);

    const history = await mb.crossBranchPatientHistory(req.params.id, req.user.orgId);
    return R.ok(res, { patient, ...history });
  } catch (e) {
    logBranchesError('GET /branches/patients/:id/history', e, { patientId: req.params.id, orgId: req.user?.orgId });
    next(e);
  }
});

module.exports = router;

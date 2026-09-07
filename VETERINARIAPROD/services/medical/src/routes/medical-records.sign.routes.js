'use strict';

const { Router, db, R, logMedicalError } = require('./medical-records.sections.common');

const router = Router();

router.post('/:id/sign', async (req, res, next) => {
  try {
    const isAdmin = req.user.roles?.some(r => ['admin', 'org_admin', 'superadmin'].includes(r));

    const [result] = await db.query(
      `UPDATE medical_records mr
       JOIN patients p ON mr.patient_id = p.id
       SET mr.status = 'signed',
           mr.signed_at = NOW(),
           mr.signed_by = :uid,
           mr.updated_at = NOW()
       WHERE mr.id = :id
         AND p.organization_id = :orgId
         AND (mr.vet_id = :uid OR :isAdmin = 1)`,
      {
        id: req.params.id,
        uid: req.user.userId,
        orgId: req.user.orgId,
        isAdmin: isAdmin ? 1 : 0,
      }
    );

    if (!result.affectedRows) {
      return R.notFound(res, 'Medical record not found');
    }
    return R.ok(res, { message: 'Medical record signed successfully' });
  } catch (e) {
    if (e.message?.includes('SQLSTATE')) {
      return R.badRequest(res, e.message.replace(/.*SQLSTATE\[45000\]:.*: \d+ /, ''));
    }
    logMedicalError('records.POST /medical-records/:id/sign', e, { recordId: req.params.id, userId: req.user?.userId });
    next(e);
  }
});

module.exports = { router };

'use strict';

async function resolveMedicalRecordId(conn, { patientId, branchId, medicalRecordId = null }) {
  if (!patientId || !branchId) return null;

  if (medicalRecordId) {
    const row = await conn.queryOne(
      `SELECT mr.id
         FROM medical_records mr
         LEFT JOIN appointments a ON a.id = mr.appointment_id
         JOIN patients p ON p.id = mr.patient_id
        WHERE mr.id = :medicalRecordId
          AND mr.patient_id = :patientId
          AND (
            a.branch_id = :branchId
            OR EXISTS (
              SELECT 1
                FROM patient_owners po
                JOIN clients c ON c.id = po.client_id
               WHERE po.patient_id = p.id
                 AND c.branch_id = :branchId
                 AND po.deleted_at IS NULL
            )
          )`,
      { medicalRecordId, patientId, branchId }
    );
    if (!row) {
      const err = new Error('Historia clinica fuera de alcance');
      err.httpStatus = 403;
      throw err;
    }
    return row.id;
  }

  const row = await conn.queryOne(
    `SELECT mr.id
       FROM medical_records mr
       LEFT JOIN appointments a ON a.id = mr.appointment_id
       JOIN patients p ON p.id = mr.patient_id
      WHERE mr.patient_id = :patientId
        AND (
          a.branch_id = :branchId
          OR EXISTS (
            SELECT 1
              FROM patient_owners po
              JOIN clients c ON c.id = po.client_id
             WHERE po.patient_id = p.id
               AND c.branch_id = :branchId
               AND po.deleted_at IS NULL
          )
        )
      ORDER BY FIELD(mr.status, 'open', 'amended', 'signed'),
               COALESCE(mr.visit_date, mr.opened_at) DESC,
               mr.id DESC
      LIMIT 1`,
    { patientId, branchId }
  );

  return row?.id || null;
}

module.exports = {
  resolveMedicalRecordId,
};

'use strict';

const { db } = require('./appointments.common');

async function getAppointmentWithContext(id, branchId, orgId) {
  const appt = await db.queryOne(
    `SELECT a.*, at2.name AS type_name,
            p.name AS patient_name, sp.common_name AS species,
            CONCAT(cl.first_name,' ',cl.last_name) AS owner_name,
            cl.phone AS owner_phone, cl.email AS owner_email,
            CONCAT(u.first_name,' ',u.last_name) AS vet_name
     FROM appointments a
     LEFT JOIN appointment_types at2 ON a.appointment_type_id = at2.id
     JOIN patients p   ON a.patient_id  = p.id
     JOIN species  sp  ON p.species_id  = sp.id
     JOIN users    u   ON a.vet_id      = u.id
     JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type = 'primary'
     JOIN clients  cl  ON po.client_id  = cl.id
     WHERE a.id = :id AND a.branch_id = :bid${orgId ? ' AND p.organization_id = :orgId' : ''}`,
    orgId ? { id, bid: branchId, orgId } : { id, bid: branchId }
  );

  if (!appt) return null;

  const branch = await db.queryOne(
    `SELECT b.name, b.address, b.phone, o.email AS clinic_email
     FROM branches b
     JOIN organizations o ON b.organization_id = o.id
     WHERE b.id = :bid`,
    { bid: branchId }
  );

  return {
    appt,
    clinic: {
      name: branch?.name,
      address: branch?.address,
      phone: branch?.phone,
      email: branch?.clinic_email,
    },
  };
}

async function getClinicInfo(branchId) {
  const branch = await db.queryOne(
    `SELECT b.name, b.address, b.phone, o.email AS clinic_email
     FROM branches b
     JOIN organizations o ON b.organization_id = o.id
     WHERE b.id = :bid`,
    { bid: branchId }
  );

  return {
    name: branch?.name,
    address: branch?.address,
    phone: branch?.phone,
    email: branch?.clinic_email,
  };
}

module.exports = {
  getAppointmentWithContext,
  getClinicInfo,
};

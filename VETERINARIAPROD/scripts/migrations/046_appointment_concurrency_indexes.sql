-- Supports row/gap locking for overlap checks when creating medical appointments.
ALTER TABLE appointments
  ADD INDEX IF NOT EXISTS idx_appointments_branch_vet_date
    (branch_id, vet_id, scheduled_date),
  ADD INDEX IF NOT EXISTS idx_appointments_branch_patient_date
    (branch_id, patient_id, scheduled_date);

'use strict';
/**
 * Plugin: Clinical Alerts
 * Escucha eventos de negocio y genera alertas clínicas automáticas.
 */
const logger = require('../shared/logger');

module.exports = {
  id:          'clinical-alerts',
  name:        'Clinical Alerts',
  version:     '1.0.0',
  description: 'Generates clinical alerts on key events (vaccination due, lab results)',

  hooks: {
    'patient.lab_result_created': async (data) => {
      const { patientId, orgId, testName, resultValue, referenceRange } = data;
      if (!resultValue || !referenceRange) return;

      const { min, max } = referenceRange;
      const val = parseFloat(resultValue);

      if (val < min || val > max) {
        logger.warn('[clinical-alerts] Abnormal lab result', {
          patientId, orgId, testName,
          value: val, min, max,
          deviation: val < min ? 'low' : 'high',
        });
        // Aquí se podría disparar una notificación push/email
      }
    },

    'appointment.created': async (data) => {
      const { patientId, orgId, appointmentDate } = data;
      logger.info('[clinical-alerts] Appointment scheduled', { patientId, orgId, appointmentDate });
    },
  },
};

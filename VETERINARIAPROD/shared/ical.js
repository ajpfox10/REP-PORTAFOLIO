'use strict';

/**
 * shared/ical.js
 * Generación de archivos iCal (.ics) para citas y recordatorios.
 * Compatible con Apple Calendar, Outlook, Google Calendar (import), etc.
 *
 * Usamos el módulo 'ical-generator' que ya maneja el formato RFC 5545.
 */

const ical = require('ical-generator');

const CLINIC_NAME = process.env.CLINIC_DEFAULT_NAME || 'VetManager';
const TZ          = process.env.TZ                  || 'America/Argentina/Buenos_Aires';

// ─── Generar .ics para una sola cita ─────────────────────────────────────────

/**
 * Genera el contenido iCal para una cita.
 * @param {object} appt — fila de appointments con joins
 * @param {object} [clinic] — { name, address, phone }
 * @returns {string} contenido .ics
 */
function generateAppointmentIcs (appt, clinic = {}) {
  const cal = ical.default({
    name     : clinic.name || CLINIC_NAME,
    timezone : TZ,
    prodId   : `//VetManager//VetManager API//ES`,
  });

  _addAppointmentEvent(cal, appt, clinic);

  return cal.toString();
}

/**
 * Genera un .ics con múltiples citas (útil para exportar agenda del día).
 * @param {object[]} appointments
 * @param {object}   [clinic]
 * @returns {string} contenido .ics
 */
function generateAgendaIcs (appointments, clinic = {}) {
  const cal = ical.default({
    name     : `Agenda ${clinic.name || CLINIC_NAME}`,
    timezone : TZ,
    prodId   : `//VetManager//VetManager API//ES`,
  });

  for (const appt of appointments) {
    _addAppointmentEvent(cal, appt, clinic);
  }

  return cal.toString();
}

/**
 * Genera un .ics de recordatorio de vacunación.
 * @param {object} vaccination — { id, patient_name, vaccine_name, due_date, owner_name, owner_email }
 * @param {object} [clinic]
 * @returns {string} contenido .ics
 */
function generateVaccinationReminder (vaccination, clinic = {}) {
  const cal = ical.default({
    name     : clinic.name || CLINIC_NAME,
    timezone : TZ,
    prodId   : `//VetManager//VetManager API//ES`,
  });

  const dueDate = new Date(vaccination.due_date);

  cal.createEvent({
    id          : `vacc-${vaccination.id}@vetmanager`,
    summary     : `💉 Vacuna: ${vaccination.vaccine_name} — ${vaccination.patient_name}`,
    description : [
      `Paciente: ${vaccination.patient_name}`,
      vaccination.species ? `Especie: ${vaccination.species}` : '',
      `Propietario: ${vaccination.owner_name}`,
      `Vacuna: ${vaccination.vaccine_name}`,
      vaccination.notes ? `Notas: ${vaccination.notes}` : '',
      `\nComuníquese con ${clinic.name || CLINIC_NAME} para agendar el turno.`,
    ].filter(Boolean).join('\n'),
    start       : dueDate,
    end         : new Date(dueDate.getTime() + 60 * 60_000),   // 1 hora
    allDay      : true,
    timezone    : TZ,
    alarms      : [
      { type: 'display', triggerType: 'display', trigger: -7 * 24 * 60 },   // 7 días antes
      { type: 'display', triggerType: 'display', trigger: -24 * 60 },        // 1 día antes
    ],
    organizer   : clinic.email
      ? { name: clinic.name || CLINIC_NAME, email: clinic.email }
      : undefined,
    attendees   : vaccination.owner_email
      ? [{ name: vaccination.owner_name, email: vaccination.owner_email, rsvp: false }]
      : undefined,
    x: [
      { key: 'X-VETMANAGER-VACCINATION-ID', value: String(vaccination.id) },
    ],
  });

  return cal.toString();
}

// ─── Helper privado ───────────────────────────────────────────────────────────

function _addAppointmentEvent (cal, appt, clinic) {
  const start = new Date(appt.scheduled_date);
  const end   = new Date(start.getTime() + (appt.duration_minutes || 30) * 60_000);

  const statusMap = {
    scheduled   : 'TENTATIVE',
    confirmed   : 'CONFIRMED',
    in_progress : 'CONFIRMED',
    completed   : 'CONFIRMED',
    cancelled   : 'CANCELLED',
    no_show     : 'CANCELLED',
  };

  const description = [
    appt.owner_name  ? `Propietario: ${appt.owner_name}`  : '',
    appt.owner_phone ? `Teléfono: ${appt.owner_phone}`    : '',
    appt.species     ? `Especie: ${appt.species}`         : '',
    appt.reason      ? `Motivo: ${appt.reason}`           : '',
    appt.vet_name    ? `Veterinario: ${appt.vet_name}`    : '',
    appt.notes       ? `Notas: ${appt.notes}`             : '',
    clinic.address   ? `Dirección: ${clinic.address}`     : '',
    clinic.phone     ? `Tel clínica: ${clinic.phone}`     : '',
  ].filter(Boolean).join('\n');

  cal.createEvent({
    id          : `appt-${appt.id}@vetmanager`,
    summary     : `🐾 ${appt.patient_name || 'Paciente'} — ${appt.type_name || appt.reason || 'Consulta'}`,
    description,
    location    : clinic.address || undefined,
    start,
    end,
    timezone    : TZ,
    status      : statusMap[appt.status] || 'TENTATIVE',
    alarms      : [
      { type: 'display', triggerType: 'display', trigger: -60 },   // 60 min antes
      { type: 'display', triggerType: 'display', trigger: -15 },   // 15 min antes
    ],
    organizer   : clinic.email
      ? { name: clinic.name || CLINIC_NAME, email: clinic.email }
      : undefined,
    attendees   : appt.owner_email
      ? [{ name: appt.owner_name, email: appt.owner_email, rsvp: false }]
      : undefined,
    x: [
      { key: 'X-VETMANAGER-APPOINTMENT-ID', value: String(appt.id) },
      { key: 'X-VETMANAGER-BRANCH-ID',      value: String(appt.branch_id || '') },
    ],
  });
}

module.exports = {
  generateAppointmentIcs,
  generateAgendaIcs,
  generateVaccinationReminder,
};

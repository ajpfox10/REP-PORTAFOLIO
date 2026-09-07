'use strict';

/**
 * tests/unit/calendar.test.js
 * Tests unitarios para shared/calendar.js y shared/ical.js
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockInsert   = jest.fn();
const mockUpdate   = jest.fn();
const mockDelete   = jest.fn();
const mockList     = jest.fn();
const mockRevoke   = jest.fn();
const mockGenUrl   = jest.fn();
const mockGetToken = jest.fn();

jest.mock('googleapis', () => {
  const fakeOAuth2 = class {
    generateAuthUrl (opts) { return mockGenUrl(opts); }
    setCredentials  ()     {}
    getToken        (code) { return mockGetToken(code); }
    revokeToken     (at)   { return mockRevoke(at); }
    on              ()     {}
  };
  return {
    google: {
      auth     : { OAuth2: fakeOAuth2 },
      calendar : () => ({
        events: {
          insert : (...a) => mockInsert(...a),
          update : (...a) => mockUpdate(...a),
          delete : (...a) => mockDelete(...a),
          list   : (...a) => mockList(...a),
        },
      }),
    },
  };
});

jest.mock('../../shared/db', () => ({
  query    : jest.fn(),
  queryOne : jest.fn(),
}));

const db         = require('../../shared/db');
const calMod     = require('../../shared/calendar');
const { generateAppointmentIcs, generateAgendaIcs, generateVaccinationReminder } = require('../../shared/ical');

// ─── Fixture ─────────────────────────────────────────────────────────────────

const APPT = {
  id               : 42,
  branch_id        : 1,
  patient_name     : 'Luna',
  species          : 'Felino',
  owner_name       : 'María García',
  owner_phone      : '+5491155554444',
  owner_email      : 'maria@example.com',
  vet_name         : 'Dr. López',
  type_name        : 'Consulta general',
  reason           : 'Control anual',
  notes            : 'Ninguna',
  scheduled_date   : new Date('2026-04-10T10:00:00Z'),
  duration_minutes : 30,
  status           : 'confirmed',
  google_event_id  : null,
};

const TOKENS = {
  user_id       : 7,
  access_token  : 'ya29.fake_access_token',
  refresh_token : '1//fake_refresh_token',
  expiry_date   : Date.now() + 3_600_000,
};

// ─── Tests: calendar.js ───────────────────────────────────────────────────────

describe('shared/calendar — getAuthUrl', () => {
  test('genera una URL de autorización con los parámetros correctos', () => {
    mockGenUrl.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?fake=1');
    const url = calMod.getAuthUrl(7);
    expect(url).toMatch(/^https/);
    expect(mockGenUrl).toHaveBeenCalledWith(
      expect.objectContaining({ access_type: 'offline', prompt: 'consent', state: '7' })
    );
  });
});

describe('shared/calendar — exchangeCode', () => {
  test('intercambia el code y guarda tokens en DB', async () => {
    mockGetToken.mockResolvedValue({ tokens: { access_token: 'ya29.new', refresh_token: '1//new', expiry_date: 9999999 } });
    db.query.mockResolvedValue([]);
    const tokens = await calMod.exchangeCode(7, 'auth_code_xyz');
    expect(tokens.access_token).toBe('ya29.new');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO google_calendar_tokens'),
      expect.objectContaining({ uid: 7 })
    );
  });
});

describe('shared/calendar — isConnected', () => {
  test('devuelve true si hay tokens guardados', async () => {
    db.queryOne.mockResolvedValue(TOKENS);
    expect(await calMod.isConnected(7)).toBe(true);
  });

  test('devuelve false si no hay tokens', async () => {
    db.queryOne.mockResolvedValue(null);
    expect(await calMod.isConnected(99)).toBe(false);
  });
});

describe('shared/calendar — createEvent', () => {
  beforeEach(() => {
    db.queryOne.mockResolvedValue(TOKENS);
    db.query.mockResolvedValue([]);
    mockInsert.mockResolvedValue({ data: { id: 'gcal_123', htmlLink: 'https://calendar.google.com/ev/123' } });
  });

  test('crea evento y guarda google_event_id en DB', async () => {
    const result = await calMod.createEvent(7, APPT);
    expect(result.eventId).toBe('gcal_123');
    expect(result.htmlLink).toContain('calendar.google.com');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE appointments SET google_event_id'),
      expect.objectContaining({ eid: 'gcal_123', id: 42 })
    );
  });

  test('lanza GCAL_NOT_CONNECTED si no hay tokens', async () => {
    db.queryOne.mockResolvedValue(null);
    await expect(calMod.createEvent(7, APPT))
      .rejects.toMatchObject({ code: 'GCAL_NOT_CONNECTED' });
  });
});

describe('shared/calendar — updateEvent', () => {
  beforeEach(() => {
    db.queryOne.mockResolvedValue(TOKENS);
    db.query.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({ data: { id: 'gcal_123' } });
    mockInsert.mockResolvedValue({ data: { id: 'gcal_new', htmlLink: 'https://...' } });
  });

  test('actualiza evento si tiene google_event_id', async () => {
    const result = await calMod.updateEvent(7, { ...APPT, google_event_id: 'gcal_123' });
    expect(result.eventId).toBe('gcal_123');
    expect(mockUpdate).toHaveBeenCalled();
  });

  test('crea evento nuevo si no tiene google_event_id', async () => {
    const result = await calMod.updateEvent(7, APPT);
    expect(mockInsert).toHaveBeenCalled();
    expect(result.eventId).toBe('gcal_new');
  });
});

describe('shared/calendar — deleteEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.queryOne.mockResolvedValue(TOKENS);
    db.query.mockResolvedValue([]);
    mockDelete.mockResolvedValue({});
  });

  test('elimina evento y limpia DB', async () => {
    await calMod.deleteEvent(7, 'gcal_123');
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'primary', eventId: 'gcal_123' })
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE appointments SET google_event_id = NULL'),
      expect.objectContaining({ eid: 'gcal_123' })
    );
  });

  test('no hace nada si eventId es null', async () => {
    await calMod.deleteEvent(7, null);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('ignora error 410 (evento ya borrado en Google)', async () => {
    mockDelete.mockRejectedValue(Object.assign(new Error('Gone'), { code: 410 }));
    await expect(calMod.deleteEvent(7, 'gcal_gone')).resolves.toBeUndefined();
  });
});

describe('shared/calendar — listEvents', () => {
  test('devuelve items del calendario', async () => {
    db.queryOne.mockResolvedValue(TOKENS);
    mockList.mockResolvedValue({
      data: { items: [{ id: 'ev1', summary: 'Turno Luna' }, { id: 'ev2', summary: 'Turno Max' }] },
    });
    const evts = await calMod.listEvents(7, '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z');
    expect(evts).toHaveLength(2);
    expect(evts[0].summary).toBe('Turno Luna');
  });

  test('devuelve array vacío si no hay eventos', async () => {
    db.queryOne.mockResolvedValue(TOKENS);
    mockList.mockResolvedValue({ data: { items: [] } });
    const evts = await calMod.listEvents(7, '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z');
    expect(evts).toHaveLength(0);
  });
});

// ─── Tests: ical.js ───────────────────────────────────────────────────────────

describe('shared/ical — generateAppointmentIcs', () => {
  const clinic = { name: 'VetManager', address: 'Av. Corrientes 1234', phone: '011-4444-5555', email: 'info@vet.com' };

  test('genera un string .ics con cabeceras válidas', () => {
    const ics = generateAppointmentIcs(APPT, clinic);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  test('incluye nombre del paciente en el summary', () => {
    const ics = generateAppointmentIcs(APPT, clinic);
    expect(ics).toContain('Luna');
  });

  test('incluye tipo de cita', () => {
    const ics = generateAppointmentIcs(APPT, clinic);
    expect(ics).toContain('Consulta general');
  });

  test('incluye alarmas (VALARM)', () => {
    const ics = generateAppointmentIcs(APPT, clinic);
    expect(ics).toContain('BEGIN:VALARM');
  });

  test('incluye ID de VetManager en propiedades extendidas', () => {
    const ics = generateAppointmentIcs(APPT, clinic);
    expect(ics).toContain('X-VETMANAGER-APPOINTMENT-ID:42');
  });

  test('cita cancelada → STATUS:CANCELLED', () => {
    const ics = generateAppointmentIcs({ ...APPT, status: 'cancelled' }, clinic);
    expect(ics).toContain('STATUS:CANCELLED');
  });

  test('cita confirmada → STATUS:CONFIRMED', () => {
    const ics = generateAppointmentIcs({ ...APPT, status: 'confirmed' }, clinic);
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  test('cita scheduled → STATUS:TENTATIVE', () => {
    const ics = generateAppointmentIcs({ ...APPT, status: 'scheduled' }, clinic);
    expect(ics).toContain('STATUS:TENTATIVE');
  });
});

describe('shared/ical — generateAgendaIcs', () => {
  test('genera .ics con múltiples eventos', () => {
    const appts = [
      { ...APPT, id: 1, patient_name: 'Luna' },
      { ...APPT, id: 2, patient_name: 'Max'  },
      { ...APPT, id: 3, patient_name: 'Coco' },
    ];
    const ics = generateAgendaIcs(appts, { name: 'VetManager' });
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(3);
    expect(ics).toContain('Luna');
    expect(ics).toContain('Max');
    expect(ics).toContain('Coco');
  });

  test('genera .ics vacío sin eventos', () => {
    const ics = generateAgendaIcs([], { name: 'VetManager' });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

describe('shared/ical — generateVaccinationReminder', () => {
  const vacc = {
    id           : 10,
    patient_name : 'Toby',
    vaccine_name : 'Triple Felina',
    due_date     : new Date('2026-05-01'),
    owner_name   : 'Carlos Pérez',
    owner_email  : 'carlos@example.com',
    species      : 'Felino',
  };

  test('incluye el nombre de la vacuna', () => {
    const ics = generateVaccinationReminder(vacc, { name: 'VetManager' });
    expect(ics).toContain('Triple Felina');
    expect(ics).toContain('Toby');
  });

  test('incluye alarma VALARM', () => {
    const ics = generateVaccinationReminder(vacc, { name: 'VetManager' });
    expect(ics).toContain('BEGIN:VALARM');
  });

  test('incluye ID de vacunación en propiedades extendidas', () => {
    const ics = generateVaccinationReminder(vacc, { name: 'VetManager' });
    expect(ics).toContain('X-VETMANAGER-VACCINATION-ID:10');
  });
});

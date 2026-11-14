-- 123__agenda_google_calendar.sql
-- Agenda de turnos ↔ Google Calendar (cuenta de antecedentes, mismo cliente OAuth que el robot de Gmail).
-- Robot scripts/google_calendar_turnos.py (cada 5 min):
--   · crea un calendario por agenda ("Turnos – <agenda>") y guarda su id en agendas.gcal_calendar_id
--   · SUBE los turnos con gcal_pendiente = 1 (alta / cambio de estado / cancelación → borra el evento)
--   · BAJA todos los eventos de esos calendarios a gcal_eventos (syncToken incremental)
-- Los eventos cargados A MANO en Google (origen MANUAL) ocupan el horario: la agenda no ofrece
-- turnos que se superpongan (services/agendaTurnos.ts → disponibilidad).
-- Se aplica también en runtime (ensureAgendaTablas): ahí un ADD COLUMN que ya existe (error 1060) se
-- ignora. MySQL 8 no tiene ADD COLUMN IF NOT EXISTS → un ALTER por columna.

ALTER TABLE agendas ADD COLUMN gcal_calendar_id VARCHAR(255) NULL COMMENT 'calendario de Google de esta agenda (lo crea el robot)';
ALTER TABLE agenda_turnos ADD COLUMN gcal_event_id VARCHAR(255) NULL;
ALTER TABLE agenda_turnos ADD COLUMN gcal_pendiente TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = el robot tiene que subirlo/actualizarlo';
ALTER TABLE agenda_turnos ADD COLUMN gcal_error VARCHAR(300) NULL;

CREATE TABLE IF NOT EXISTS gcal_eventos (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  calendar_id         VARCHAR(255) NOT NULL,
  event_id            VARCHAR(255) NOT NULL,
  agenda_id           INT UNSIGNED NULL,
  origen              ENUM('SISTEMA','MANUAL') NOT NULL DEFAULT 'MANUAL' COMMENT 'SISTEMA = lo subió el robot desde un turno',
  turno_id            INT UNSIGNED NULL,
  dni                 INT NULL COMMENT 'DNI que aparece en el título/descr. de un evento manual, si existe en personal',
  titulo              VARCHAR(500) NULL,
  descripcion         TEXT NULL,
  ubicacion           VARCHAR(500) NULL,
  inicio              DATETIME NULL COMMENT 'hora argentina',
  fin                 DATETIME NULL,
  todo_el_dia         TINYINT(1) NOT NULL DEFAULT 0,
  estado              VARCHAR(20) NOT NULL DEFAULT 'confirmed' COMMENT 'confirmed | tentative | cancelled',
  creador             VARCHAR(255) NULL,
  actualizado_google  DATETIME NULL,
  synced_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gcal_evento (calendar_id, event_id),
  KEY idx_gcal_agenda_inicio (agenda_id, inicio),
  KEY idx_gcal_turno (turno_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gcal_sync (
  calendar_id   VARCHAR(255) NOT NULL,
  sync_token    VARCHAR(500) NULL,
  ultimo_ok     DATETIME NULL,
  ultimo_error  VARCHAR(500) NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (calendar_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, prog_cada_n_dias, prog_hora, tarea_windows, destino_dir, destino_nombre, lo_leen, notas)
VALUES
  ('google_calendar_turnos', 'Agenda de turnos ↔ Google Calendar (sube turnos, baja eventos)', 'Google Calendar', 10,
   'python google_calendar_turnos.py', 0, 1, '', NULL, '07:00', NULL,
   NULL, NULL, 'Agenda de turnos (📅 Calendario Google)',
   'Cuenta de antecedentes por API (token en scripts/google_calendar_token.json; la 1ra vez: python google_calendar_turnos.py --autorizar). Corre CADA 5 MINUTOS (trigger puesto a mano, como pase_planta): si se guarda la programación desde la página Robots vuelve a diario. Eventos cargados a mano en Google ocupan el horario de la agenda.');

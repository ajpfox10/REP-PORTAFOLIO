-- 122__agenda_turnos.sql
-- Agenda de turnos que el agente pide solo, desde un enlace personal (WhatsApp).
--
--  agendas                → cada sector arma la suya (Jubilación, Salud Laboral, Personal...)
--  agenda_franjas         → grilla semanal: día, hora desde/hasta, duración del turno, cupo
--  agenda_bloqueos        → días/horas que no se atiende (agenda_id NULL = todas las agendas)
--  agenda_habilitaciones  → la oficina habilita a un agente → enlace único (token); al pedir el
--                           turno queda USADO y ya no sirve para otro
--  agenda_turnos          → el turno tomado, vinculado al agente (dni)
--
-- Que NO se repitan: los UNIQUE sobre columnas generadas los hace cumplir la base.
--  - slot_activo: (agenda, fecha, hora, lugar) de los turnos no cancelados. `lugar` va de 1 al cupo.
--  - dni_activo:  un solo turno RESERVADO por agente y agenda.
--  - hab_activa:  una sola habilitación HABILITADO por agente y agenda.
-- Los feriados de la tabla `feriados` se saltean solos.
-- Si la agenda tiene carga_jubilacion = 1, el turno además se carga en jubilacion_citas.
--
-- Se aplica sola en runtime (ensureAgendaTablas en src/services/agendaTurnos.ts); esta es la DDL canónica.

CREATE TABLE IF NOT EXISTS agendas (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre             VARCHAR(120) NOT NULL,
  descripcion        VARCHAR(500) NULL,
  lugar              VARCHAR(200) NULL COMMENT 'dónde se atiende (se muestra al agente)',
  anticipacion_dias  SMALLINT NOT NULL DEFAULT 1  COMMENT 'desde cuántos días adelante se puede pedir (0 = hoy)',
  ventana_dias       SMALLINT NOT NULL DEFAULT 30 COMMENT 'hasta cuántos días adelante se ofrecen turnos',
  vence_dias         SMALLINT NOT NULL DEFAULT 15 COMMENT 'días que dura el enlace sin usar',
  cancelar_horas     SMALLINT NOT NULL DEFAULT 24 COMMENT 'hasta cuántas horas antes el agente puede cancelar',
  carga_jubilacion   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = el turno también se carga en jubilacion_citas',
  mensaje_whatsapp   TEXT NULL,
  activa             TINYINT(1) NOT NULL DEFAULT 1,
  created_by         INT NULL,
  updated_by         INT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agendas_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agenda_franjas (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  agenda_id     INT UNSIGNED NOT NULL,
  dia_semana    TINYINT NOT NULL COMMENT '0=domingo … 6=sábado',
  hora_desde    TIME NOT NULL,
  hora_hasta    TIME NOT NULL,
  duracion_min  SMALLINT NOT NULL DEFAULT 20,
  cupo          TINYINT NOT NULL DEFAULT 1 COMMENT 'agentes por horario',
  PRIMARY KEY (id),
  KEY idx_af_agenda (agenda_id, dia_semana),
  CONSTRAINT fk_af_agenda FOREIGN KEY (agenda_id) REFERENCES agendas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agenda_bloqueos (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  agenda_id    INT UNSIGNED NULL COMMENT 'NULL = bloquea todas las agendas',
  fecha_desde  DATE NOT NULL,
  fecha_hasta  DATE NOT NULL,
  hora_desde   TIME NULL COMMENT 'NULL = el día entero',
  hora_hasta   TIME NULL,
  motivo       VARCHAR(200) NULL,
  created_by   INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at   DATETIME NULL,
  deleted_by   INT NULL,
  PRIMARY KEY (id),
  KEY idx_ab_rango (fecha_desde, fecha_hasta),
  CONSTRAINT fk_ab_agenda FOREIGN KEY (agenda_id) REFERENCES agendas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agenda_habilitaciones (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  agenda_id    INT UNSIGNED NOT NULL,
  dni          INT NOT NULL,
  token        CHAR(43) NOT NULL COMMENT 'va en el enlace; 32 bytes al azar en base64url',
  estado       ENUM('HABILITADO','USADO','VENCIDO','ANULADO') NOT NULL DEFAULT 'HABILITADO',
  vence_el     DATE NOT NULL,
  turno_id     INT UNSIGNED NULL,
  observacion  VARCHAR(300) NULL,
  hab_activa   VARCHAR(40) GENERATED ALWAYS AS (IF(estado = 'HABILITADO', CONCAT(agenda_id, '|', dni), NULL)) STORED,
  created_by   INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usado_at     DATETIME NULL,
  anulado_at   DATETIME NULL,
  anulado_by   INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ah_token (token),
  UNIQUE KEY uq_ah_activa (hab_activa),
  KEY idx_ah_agenda_estado (agenda_id, estado),
  KEY idx_ah_dni (dni),
  CONSTRAINT fk_ah_agenda FOREIGN KEY (agenda_id) REFERENCES agendas (id),
  CONSTRAINT fk_ah_dni FOREIGN KEY (dni) REFERENCES personal (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agenda_turnos (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  agenda_id          INT UNSIGNED NOT NULL,
  habilitacion_id    INT UNSIGNED NULL,
  dni                INT NOT NULL,
  fecha              DATE NOT NULL,
  hora               TIME NOT NULL,
  lugar              TINYINT NOT NULL DEFAULT 1 COMMENT '1..cupo del horario',
  estado             ENUM('RESERVADO','ATENDIDO','AUSENTE','CANCELADO') NOT NULL DEFAULT 'RESERVADO',
  origen             ENUM('ENLACE','INTERNO') NOT NULL DEFAULT 'ENLACE',
  telefono_contacto  VARCHAR(40) NULL,
  observaciones      VARCHAR(500) NULL,
  jubilacion_cita_id BIGINT UNSIGNED NULL,
  slot_activo        VARCHAR(60) GENERATED ALWAYS AS (IF(estado = 'CANCELADO', NULL, CONCAT(agenda_id, '|', fecha, '|', hora, '|', lugar))) STORED,
  dni_activo         VARCHAR(40) GENERATED ALWAYS AS (IF(estado = 'RESERVADO', CONCAT(agenda_id, '|', dni), NULL)) STORED,
  created_by         INT NULL COMMENT 'NULL = lo pidió el agente por el enlace',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  cancelado_at       DATETIME NULL,
  cancelado_por      VARCHAR(20) NULL COMMENT 'AGENTE u OFICINA',
  PRIMARY KEY (id),
  UNIQUE KEY uq_at_slot (slot_activo),
  UNIQUE KEY uq_at_dni (dni_activo),
  KEY idx_at_agenda_fecha (agenda_id, fecha, hora),
  KEY idx_at_dni (dni),
  CONSTRAINT fk_at_agenda FOREIGN KEY (agenda_id) REFERENCES agendas (id),
  CONSTRAINT fk_at_dni FOREIGN KEY (dni) REFERENCES personal (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

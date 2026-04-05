-- =============================================================
-- DEFENSA CIVIL ARGENTINA - SISTEMA DE REPORTE DE INCIDENTES
-- Schema v1.0
-- Ejecutar con usuario con permisos suficientes (ver .env.*)
-- =============================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET time_zone = '-03:00'; -- Hora Argentina (ART)

-- =============================================================
-- TABLA: users
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          VARCHAR(36)  NOT NULL,
  username      VARCHAR(50)  NOT NULL,
  email         VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','medium','read') NOT NULL DEFAULT 'read',
  full_name     VARCHAR(100) NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login    DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_uuid     (uuid),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email    (email),
  KEY idx_users_role      (role),
  KEY idx_users_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: refresh_tokens
-- =============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  DATETIME     NOT NULL,
  is_revoked  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY idx_refresh_tokens_user_id (user_id),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: incident_types
-- =============================================================
CREATE TABLE IF NOT EXISTS incident_types (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(30)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description TEXT         NULL,
  icon        VARCHAR(50)  NULL,
  color_hex   VARCHAR(7)   NULL DEFAULT '#FF0000',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_incident_types_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: incident_subtypes
-- =============================================================
CREATE TABLE IF NOT EXISTS incident_subtypes (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  incident_type_id INT UNSIGNED NOT NULL,
  code             VARCHAR(30)  NOT NULL,
  name             VARCHAR(100) NOT NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_incident_subtypes (incident_type_id, code),
  KEY idx_incident_subtypes_type (incident_type_id),
  CONSTRAINT fk_subtypes_type FOREIGN KEY (incident_type_id) REFERENCES incident_types (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: provinces
-- =============================================================
CREATE TABLE IF NOT EXISTS provinces (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(10)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  geojson_ref VARCHAR(100) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_provinces_code (code),
  KEY idx_provinces_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: partidos (municipios/departamentos)
-- =============================================================
CREATE TABLE IF NOT EXISTS partidos (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  province_id INT UNSIGNED NOT NULL,
  name        VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_partidos_province (province_id),
  CONSTRAINT fk_partidos_province FOREIGN KEY (province_id) REFERENCES provinces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: localities
-- =============================================================
CREATE TABLE IF NOT EXISTS localities (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  partido_id  INT UNSIGNED NOT NULL,
  name        VARCHAR(100) NOT NULL,
  postal_code VARCHAR(10)  NULL,
  latitude    DECIMAL(10,8) NULL,
  longitude   DECIMAL(11,8) NULL,
  PRIMARY KEY (id),
  KEY idx_localities_partido (partido_id),
  CONSTRAINT fk_localities_partido FOREIGN KEY (partido_id) REFERENCES partidos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: incidents
-- =============================================================
CREATE TABLE IF NOT EXISTS incidents (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                  VARCHAR(36)  NOT NULL,
  incident_number       VARCHAR(20)  NOT NULL,
  incident_type_id      INT UNSIGNED NOT NULL,
  incident_subtype_id   INT UNSIGNED NULL,
  title                 VARCHAR(200) NOT NULL,
  description           TEXT         NOT NULL,
  status                ENUM('RECIBIDO','EN_CAMINO','EN_ESCENA','CONTROLADO','CERRADO','CANCELADO') NOT NULL DEFAULT 'RECIBIDO',
  priority              ENUM('BAJA','MEDIA','ALTA','CRITICA') NOT NULL DEFAULT 'MEDIA',
  province_id           INT UNSIGNED NULL,
  partido_id            INT UNSIGNED NULL,
  locality_id           INT UNSIGNED NULL,
  address               VARCHAR(255) NULL,
  latitude              DECIMAL(10,8) NULL,
  longitude             DECIMAL(11,8) NULL,
  affected_persons_count INT UNSIGNED NOT NULL DEFAULT 0,
  injured_count         INT UNSIGNED NOT NULL DEFAULT 0,
  deceased_count        INT UNSIGNED NOT NULL DEFAULT 0,
  evacuated_count       INT UNSIGNED NOT NULL DEFAULT 0,
  reported_by_user_id   INT UNSIGNED NOT NULL,
  assigned_officer      VARCHAR(100) NULL,
  started_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  controlled_at         DATETIME     NULL,
  closed_at             DATETIME     NULL,
  notes                 TEXT         NULL,
  is_deleted            TINYINT(1)   NOT NULL DEFAULT 0,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_incidents_uuid            (uuid),
  UNIQUE KEY uq_incidents_number          (incident_number),
  KEY idx_incidents_status          (status),
  KEY idx_incidents_type            (incident_type_id),
  KEY idx_incidents_priority        (priority),
  KEY idx_incidents_province        (province_id),
  KEY idx_incidents_reporter        (reported_by_user_id),
  KEY idx_incidents_coords          (latitude, longitude),
  KEY idx_incidents_started_at      (started_at),
  KEY idx_incidents_is_deleted      (is_deleted),
  -- Índices compuestos para los filtros más frecuentes
  KEY idx_incidents_deleted_status  (is_deleted, status),
  KEY idx_incidents_deleted_started (is_deleted, started_at),
  KEY idx_incidents_deleted_type    (is_deleted, incident_type_id),
  CONSTRAINT fk_incidents_type      FOREIGN KEY (incident_type_id)    REFERENCES incident_types    (id),
  CONSTRAINT fk_incidents_subtype   FOREIGN KEY (incident_subtype_id) REFERENCES incident_subtypes (id),
  CONSTRAINT fk_incidents_province  FOREIGN KEY (province_id)         REFERENCES provinces         (id),
  CONSTRAINT fk_incidents_partido   FOREIGN KEY (partido_id)          REFERENCES partidos          (id),
  CONSTRAINT fk_incidents_locality  FOREIGN KEY (locality_id)         REFERENCES localities        (id),
  CONSTRAINT fk_incidents_reporter  FOREIGN KEY (reported_by_user_id) REFERENCES users             (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: incident_units
-- =============================================================
CREATE TABLE IF NOT EXISTS incident_units (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  incident_id     INT UNSIGNED NOT NULL,
  unit_name       VARCHAR(100) NOT NULL,
  unit_type       ENUM('BOMBEROS','POLICIA','AMBULANCIA','DEFENSA_CIVIL','RESCATE','GENDARMERIA','PREFECTURA','EJERCITO','CRUZ_ROJA','OTRO') NOT NULL,
  unit_number     VARCHAR(30)  NULL,
  personnel_count INT UNSIGNED NOT NULL DEFAULT 0,
  arrived_at      DATETIME     NULL,
  departed_at     DATETIME     NULL,
  notes           VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_incident_units_incident (incident_id),
  CONSTRAINT fk_incident_units_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: incident_resources
-- =============================================================
CREATE TABLE IF NOT EXISTS incident_resources (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  incident_id   INT UNSIGNED NOT NULL,
  resource_type ENUM('VEHICULO','EQUIPO','MATERIAL','HERRAMIENTA','OTRO') NOT NULL,
  resource_name VARCHAR(100) NOT NULL,
  quantity      INT UNSIGNED NOT NULL DEFAULT 1,
  notes         VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_incident_resources_incident (incident_id),
  CONSTRAINT fk_incident_resources_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: incident_status_history
-- =============================================================
CREATE TABLE IF NOT EXISTS incident_status_history (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  incident_id        INT UNSIGNED NOT NULL,
  previous_status    ENUM('RECIBIDO','EN_CAMINO','EN_ESCENA','CONTROLADO','CERRADO','CANCELADO') NULL,
  new_status         ENUM('RECIBIDO','EN_CAMINO','EN_ESCENA','CONTROLADO','CERRADO','CANCELADO') NOT NULL,
  changed_by_user_id INT UNSIGNED NOT NULL,
  notes              VARCHAR(500) NULL,
  changed_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status_history_incident (incident_id),
  CONSTRAINT fk_status_history_incident FOREIGN KEY (incident_id)        REFERENCES incidents (id) ON DELETE CASCADE,
  CONSTRAINT fk_status_history_user     FOREIGN KEY (changed_by_user_id) REFERENCES users     (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: audit_logs
-- =============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NULL,
  action      VARCHAR(50)  NOT NULL,
  entity_type VARCHAR(50)  NULL,
  entity_id   VARCHAR(36)  NULL,
  old_values  JSON         NULL,
  new_values  JSON         NULL,
  ip_address  VARCHAR(45)  NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_logs_user       (user_id),
  KEY idx_audit_logs_action     (action),
  KEY idx_audit_logs_entity     (entity_type, entity_id),
  KEY idx_audit_logs_created_at (created_at),
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: police_stations (comisarias)
-- =============================================================
CREATE TABLE IF NOT EXISTS police_stations (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(150) NOT NULL,
  address     VARCHAR(255) NULL,
  phone       VARCHAR(50)  NULL,
  province_id INT UNSIGNED NULL,
  partido_id  INT UNSIGNED NULL,
  latitude    DECIMAL(10,8) NULL,
  longitude   DECIMAL(11,8) NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_police_stations_province (province_id),
  KEY idx_police_stations_coords   (latitude, longitude),
  CONSTRAINT fk_police_stations_province FOREIGN KEY (province_id) REFERENCES provinces (id),
  CONSTRAINT fk_police_stations_partido  FOREIGN KEY (partido_id)  REFERENCES partidos  (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- TABLA: incident_number_sequences
-- Garantiza numeración correlativa sin race conditions
-- =============================================================
CREATE TABLE IF NOT EXISTS incident_number_sequences (
  year        SMALLINT UNSIGNED NOT NULL,
  last_seq    INT UNSIGNED      NOT NULL DEFAULT 0,
  PRIMARY KEY (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- EVENT: limpieza periódica de refresh tokens vencidos/revocados
-- =============================================================
SET GLOBAL event_scheduler = ON;

CREATE EVENT IF NOT EXISTS evt_cleanup_refresh_tokens
  ON SCHEDULE EVERY 1 DAY
  STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR)
  DO
    DELETE FROM refresh_tokens
    WHERE is_revoked = 1
       OR expires_at < NOW() - INTERVAL 1 DAY;

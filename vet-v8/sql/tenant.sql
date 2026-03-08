-- ============================================================================
-- VETERINARIA SAAS PLATFORM — TENANT DATABASE SCHEMA
-- Versión: 3.0.0  |  Motor: MySQL 8.4 InnoDB  |  Charset: utf8mb4
--
-- Este script crea el schema para cada tenant (clínica veterinaria).
-- Es ejecutado automáticamente por provisioningService.ts al crear un tenant.
-- También puede ser ejecutado manualmente para dev/test:
--
--   mysql -u root -p tenant_miClinica < sql/tenant.sql
--
-- Convenciones:
--   - Todas las tablas tienen `tenant_id VARCHAR(64)` para RLS.
--   - PKs: BIGINT AUTO_INCREMENT salvo donde se indica UUID.
--   - Soft delete: columna `is_active TINYINT(1) DEFAULT 1`.
--   - Timestamps: `created_at` + `updated_at` en tablas mutables.
--   - Campos sensibles cifrados a nivel app: columnas *_enc TEXT.
--   - Índices: siempre (tenant_id), luego claves de búsqueda comunes.
-- ============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;

-- ────────────────────────────────────────────────────────────────────────────
-- SCHEMA VERSIONING
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_meta (
  singleton       TINYINT(1)  NOT NULL DEFAULT 1,
  schema_version  INT         NOT NULL DEFAULT 1,
  updated_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (singleton),
  CONSTRAINT chk_singleton CHECK (singleton = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Single-row table tracking the current schema version for cache invalidation';

INSERT INTO schema_meta (singleton, schema_version) VALUES (1, 1)
  ON DUPLICATE KEY UPDATE singleton = singleton;


-- ────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS — Registro de migraciones SQL aplicadas (checksum inmutable)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS migrations (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  name        VARCHAR(255)  NOT NULL,
  checksum    VARCHAR(128)  NOT NULL,
  executed_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- USERS — Usuarios de la clínica (staff)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  tenant_id         VARCHAR(64)   NOT NULL,
  email             VARCHAR(255)  NOT NULL,
  password_hash     VARCHAR(255)  NOT NULL,
  roles             JSON          NOT NULL DEFAULT ('["viewer"]'),
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  token_version     INT           NOT NULL DEFAULT 0   COMMENT 'Bump to invalidate all sessions globally',
  mfa_enabled       TINYINT(1)    NOT NULL DEFAULT 0,
  totp_secret_enc   TEXT          NULL     COMMENT 'AES-256-GCM encrypted TOTP secret (KMS envelope)',
  locale            VARCHAR(8)    NOT NULL DEFAULT 'es',
  sucursal_id       BIGINT        NULL,
  veterinario_id    BIGINT        NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at     DATETIME      NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_email (tenant_id, email),
  INDEX idx_tenant (tenant_id),
  INDEX idx_sucursal (sucursal_id),
  INDEX idx_veterinario (veterinario_id),

  CONSTRAINT chk_email_format CHECK (email REGEXP '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Staff users — login, MFA, roles. NOT exposed via dynamic CRUD.';


-- ────────────────────────────────────────────────────────────────────────────
-- SUCURSALES — Sucursales / clínicas físicas del tenant
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sucursales (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id   VARCHAR(64)   NOT NULL,
  nombre      VARCHAR(128)  NOT NULL,
  direccion   VARCHAR(255)  NULL,
  ciudad      VARCHAR(128)  NULL,
  provincia   VARCHAR(64)   NULL,
  telefono    VARCHAR(32)   NULL,
  email       VARCHAR(255)  NULL,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- VETERINARIOS — Staff médico de la clínica
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS veterinarios (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id     VARCHAR(64)   NOT NULL,
  sucursal_id   BIGINT        NULL,
  nombre        VARCHAR(128)  NOT NULL,
  apellido      VARCHAR(128)  NOT NULL,
  matricula     VARCHAR(64)   NULL     COMMENT 'Matrícula profesional habilitante',
  especialidad  VARCHAR(128)  NULL,
  email         VARCHAR(255)  NULL,
  telefono      VARCHAR(32)   NULL,
  color_agenda  VARCHAR(7)    NULL     COMMENT 'Hex color for calendar display',
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_sucursal (sucursal_id),
  INDEX idx_matricula (matricula),
  CONSTRAINT fk_vet_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- PROPIETARIOS — Dueños de las mascotas
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS propietarios (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id   VARCHAR(64)   NOT NULL,
  sucursal_id BIGINT        NULL,
  nombre      VARCHAR(128)  NOT NULL,
  apellido    VARCHAR(128)  NOT NULL,
  email       VARCHAR(255)  NULL,
  telefono    VARCHAR(32)   NULL,
  direccion   VARCHAR(255)  NULL,
  ciudad      VARCHAR(128)  NULL,
  dni         VARCHAR(32)   NULL,
  notas       TEXT          NULL,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_sucursal (sucursal_id),
  INDEX idx_email (email),
  INDEX idx_dni (dni),
  FULLTEXT INDEX ft_nombre (nombre, apellido)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- PACIENTES — Las mascotas (animales bajo cuidado de la clínica)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pacientes (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id         VARCHAR(64)   NOT NULL,
  sucursal_id       BIGINT        NULL,
  propietario_id    BIGINT        NULL,
  owner_user_id     VARCHAR(36)   NULL     COMMENT 'App user that registered this patient',
  nombre            VARCHAR(128)  NOT NULL,
  especie           VARCHAR(64)   NOT NULL,
  raza              VARCHAR(128)  NULL,
  color             VARCHAR(64)   NULL,
  fecha_nacimiento  DATE          NULL,
  sexo              ENUM('M','F','desconocido') NOT NULL DEFAULT 'desconocido',
  castrado          TINYINT(1)    NULL,
  peso_kg           DECIMAL(6,2)  NULL,
  microchip         VARCHAR(64)   NULL     COMMENT 'ISO 11784/11785 microchip number',
  pasaporte_num     VARCHAR(64)   NULL,
  alergias          TEXT          NULL,
  observaciones     TEXT          NULL,
  foto_url          VARCHAR(512)  NULL,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_sucursal (sucursal_id),
  INDEX idx_propietario (propietario_id),
  INDEX idx_microchip (microchip),
  FULLTEXT INDEX ft_nombre (nombre, raza),
  CONSTRAINT fk_pac_sucursal    FOREIGN KEY (sucursal_id)    REFERENCES sucursales   (id) ON DELETE SET NULL,
  CONSTRAINT fk_pac_propietario FOREIGN KEY (propietario_id) REFERENCES propietarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Core domain: pets/animals under veterinary care';


-- ────────────────────────────────────────────────────────────────────────────
-- TURNOS — Agenda de citas (appointment scheduling)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turnos (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id       VARCHAR(64)   NOT NULL,
  sucursal_id     BIGINT        NULL,
  veterinario_id  BIGINT        NULL,
  paciente_id     BIGINT        NULL,
  propietario_id  BIGINT        NULL,
  fecha_hora      DATETIME      NOT NULL,
  duracion_min    INT           NOT NULL DEFAULT 30,
  motivo          VARCHAR(255)  NULL,
  estado          ENUM('pendiente','confirmado','cancelado','completado','no_show')
                                NOT NULL DEFAULT 'pendiente',
  notas           TEXT          NULL,
  recordatorio_env TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = reminder already sent',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_vet_fecha (veterinario_id, fecha_hora),
  INDEX idx_paciente (paciente_id),
  INDEX idx_propietario (propietario_id),
  INDEX idx_fecha_hora (fecha_hora),
  INDEX idx_estado (estado),
  CONSTRAINT fk_tur_sucursal     FOREIGN KEY (sucursal_id)    REFERENCES sucursales   (id) ON DELETE SET NULL,
  CONSTRAINT fk_tur_veterinario  FOREIGN KEY (veterinario_id) REFERENCES veterinarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_tur_paciente     FOREIGN KEY (paciente_id)    REFERENCES pacientes    (id) ON DELETE SET NULL,
  CONSTRAINT fk_tur_propietario  FOREIGN KEY (propietario_id) REFERENCES propietarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- CONSULTAS — Historia clínica / registros médicos (SOAP)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultas (
  id                      BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id               VARCHAR(64)   NOT NULL,
  turno_id                BIGINT        NULL,
  paciente_id             BIGINT        NOT NULL,
  veterinario_id          BIGINT        NULL,
  sucursal_id             BIGINT        NULL,
  fecha                   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- SOAP
  motivo                  TEXT          NULL COMMENT 'Subjective: motivo de consulta',
  anamnesis               TEXT          NULL COMMENT 'Subjective: historia del paciente',
  examen_fisico           TEXT          NULL COMMENT 'Objective: examen físico completo',
  diagnostico             TEXT          NULL COMMENT 'Assessment: diagnóstico presuntivo/definitivo',
  diagnostico_cie10       VARCHAR(16)   NULL COMMENT 'CIE-10 or VeNom code',
  tratamiento             TEXT          NULL COMMENT 'Plan: tratamiento prescripto',
  -- Signos vitales
  temperatura             DECIMAL(4,1)  NULL COMMENT 'Celsius',
  peso_kg                 DECIMAL(6,2)  NULL,
  frecuencia_cardiaca     INT           NULL COMMENT 'lpm',
  frecuencia_respiratoria INT           NULL COMMENT 'rpm',
  trc                     VARCHAR(16)   NULL COMMENT 'Tiempo de relleno capilar',
  mucosas                 VARCHAR(64)   NULL,
  -- Seguimiento
  proxima_consulta        DATE          NULL,
  requiere_internacion    TINYINT(1)    NOT NULL DEFAULT 0,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_paciente (paciente_id),
  INDEX idx_vet (veterinario_id),
  INDEX idx_fecha (fecha),
  INDEX idx_turno (turno_id),
  CONSTRAINT fk_con_paciente    FOREIGN KEY (paciente_id)    REFERENCES pacientes    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_con_veterinario FOREIGN KEY (veterinario_id) REFERENCES veterinarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_con_turno       FOREIGN KEY (turno_id)       REFERENCES turnos       (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Medical records — SOAP format with vital signs';


-- ────────────────────────────────────────────────────────────────────────────
-- PRESCRIPCIONES — Recetas médicas vinculadas a consultas
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescripciones (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id       VARCHAR(64)   NOT NULL,
  consulta_id     BIGINT        NOT NULL,
  paciente_id     BIGINT        NOT NULL,
  veterinario_id  BIGINT        NULL,
  medicamento     VARCHAR(255)  NOT NULL,
  dosis           VARCHAR(128)  NULL,
  frecuencia      VARCHAR(128)  NULL,
  duracion        VARCHAR(128)  NULL,
  via             VARCHAR(64)   NULL COMMENT 'oral, IV, IM, SC, tópico, etc.',
  instrucciones   TEXT          NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_consulta (consulta_id),
  INDEX idx_paciente (paciente_id),
  CONSTRAINT fk_presc_consulta    FOREIGN KEY (consulta_id)    REFERENCES consultas    (id) ON DELETE CASCADE,
  CONSTRAINT fk_presc_paciente    FOREIGN KEY (paciente_id)    REFERENCES pacientes    (id) ON DELETE CASCADE,
  CONSTRAINT fk_presc_veterinario FOREIGN KEY (veterinario_id) REFERENCES veterinarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- VACUNAS — Cartilla de vacunación
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vacunas (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id         VARCHAR(64)   NOT NULL,
  paciente_id       BIGINT        NOT NULL,
  veterinario_id    BIGINT        NULL,
  nombre            VARCHAR(128)  NOT NULL,
  laboratorio       VARCHAR(128)  NULL,
  lote              VARCHAR(64)   NULL,
  fecha_aplicacion  DATE          NOT NULL,
  fecha_vencimiento DATE          NULL,
  proxima_dosis     DATE          NULL,
  recordatorio_env  TINYINT(1)    NOT NULL DEFAULT 0,
  notas             TEXT          NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_paciente (paciente_id),
  INDEX idx_proxima_dosis (proxima_dosis),
  CONSTRAINT fk_vac_paciente    FOREIGN KEY (paciente_id)    REFERENCES pacientes    (id) ON DELETE CASCADE,
  CONSTRAINT fk_vac_veterinario FOREIGN KEY (veterinario_id) REFERENCES veterinarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- DESPARASITACIONES — Control antiparasitario
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS desparasitaciones (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id         VARCHAR(64)   NOT NULL,
  paciente_id       BIGINT        NOT NULL,
  veterinario_id    BIGINT        NULL,
  tipo              ENUM('interna','externa','combinada') NOT NULL DEFAULT 'interna',
  producto          VARCHAR(128)  NOT NULL,
  fecha_aplicacion  DATE          NOT NULL,
  proxima_dosis     DATE          NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_paciente (paciente_id),
  INDEX idx_proxima_dosis (proxima_dosis),
  CONSTRAINT fk_desp_paciente FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- INTERNACIONES — Hospitalización de pacientes
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS internaciones (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id       VARCHAR(64)   NOT NULL,
  sucursal_id     BIGINT        NULL,
  paciente_id     BIGINT        NOT NULL,
  veterinario_id  BIGINT        NULL,
  consulta_id     BIGINT        NULL,
  fecha_ingreso   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_egreso    DATETIME      NULL,
  motivo          TEXT          NULL,
  tratamiento     TEXT          NULL,
  estado          ENUM('internado','alta','fallecido') NOT NULL DEFAULT 'internado',
  jaula_num       VARCHAR(16)   NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_paciente (paciente_id),
  INDEX idx_estado (estado),
  CONSTRAINT fk_int_paciente    FOREIGN KEY (paciente_id)    REFERENCES pacientes    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_int_veterinario FOREIGN KEY (veterinario_id) REFERENCES veterinarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- PRODUCTOS — Inventario / farmacia / insumos
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id     VARCHAR(64)   NOT NULL,
  sucursal_id   BIGINT        NULL,
  codigo        VARCHAR(64)   NULL     COMMENT 'SKU / código de barras',
  nombre        VARCHAR(255)  NOT NULL,
  descripcion   TEXT          NULL,
  categoria     VARCHAR(64)   NULL,
  subcategoria  VARCHAR(64)   NULL,
  marca         VARCHAR(128)  NULL,
  precio        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  costo         DECIMAL(12,2) NULL,
  iva_pct       DECIMAL(5,2)  NOT NULL DEFAULT 21.00 COMMENT 'IVA % (AR default 21%)',
  stock         INT           NOT NULL DEFAULT 0,
  stock_minimo  INT           NOT NULL DEFAULT 5,
  unidad        VARCHAR(32)   NOT NULL DEFAULT 'unidad',
  requiere_receta TINYINT(1)  NOT NULL DEFAULT 0,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_sucursal (sucursal_id),
  INDEX idx_categoria (categoria),
  INDEX idx_codigo (codigo),
  FULLTEXT INDEX ft_nombre (nombre, descripcion),
  CONSTRAINT fk_prod_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- MOVIMIENTOS DE STOCK — Trazabilidad de inventario
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_movimientos (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id       VARCHAR(64)   NOT NULL,
  producto_id     BIGINT        NOT NULL,
  sucursal_id     BIGINT        NULL,
  tipo            ENUM('entrada','salida','ajuste','venta','uso_clinico') NOT NULL,
  cantidad        INT           NOT NULL,
  stock_post      INT           NOT NULL COMMENT 'Stock after movement',
  referencia      VARCHAR(128)  NULL     COMMENT 'e.g. consulta_id, orden_id',
  notas           TEXT          NULL,
  actor_user_id   VARCHAR(36)   NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_producto (producto_id),
  INDEX idx_created_at (created_at),
  CONSTRAINT fk_mov_producto FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- FACTURACION — Comprobantes / facturas
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturas (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id         VARCHAR(64)   NOT NULL,
  sucursal_id       BIGINT        NULL,
  propietario_id    BIGINT        NULL,
  consulta_id       BIGINT        NULL,
  numero            VARCHAR(32)   NULL     COMMENT 'Número de comprobante (AFIP/fiscal)',
  tipo              ENUM('A','B','C','X','presupuesto') NOT NULL DEFAULT 'B',
  estado            ENUM('borrador','emitida','pagada','anulada') NOT NULL DEFAULT 'borrador',
  subtotal          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  iva_total         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total             DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  moneda            VARCHAR(3)    NOT NULL DEFAULT 'ARS',
  notas             TEXT          NULL,
  emitida_at        DATETIME      NULL,
  vencimiento       DATE          NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_propietario (propietario_id),
  INDEX idx_estado (estado),
  INDEX idx_emitida (emitida_at),
  CONSTRAINT fk_fac_sucursal    FOREIGN KEY (sucursal_id)    REFERENCES sucursales   (id) ON DELETE SET NULL,
  CONSTRAINT fk_fac_propietario FOREIGN KEY (propietario_id) REFERENCES propietarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS factura_items (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id       VARCHAR(64)   NOT NULL,
  factura_id      BIGINT        NOT NULL,
  producto_id     BIGINT        NULL,
  descripcion     VARCHAR(255)  NOT NULL,
  cantidad        DECIMAL(10,3) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(12,2) NOT NULL,
  iva_pct         DECIMAL(5,2)  NOT NULL DEFAULT 21.00,
  subtotal        DECIMAL(12,2) NOT NULL,

  PRIMARY KEY (id),
  INDEX idx_factura (factura_id),
  CONSTRAINT fk_fi_factura  FOREIGN KEY (factura_id)  REFERENCES facturas  (id) ON DELETE CASCADE,
  CONSTRAINT fk_fi_producto FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- FILES — Metadatos de archivos subidos a S3
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id              VARCHAR(64)   NOT NULL,
  tenant_id       VARCHAR(64)   NOT NULL,
  s3_key          VARCHAR(512)  NOT NULL,
  content_type    VARCHAR(128)  NOT NULL,
  original_name   VARCHAR(255)  NOT NULL,
  size_bytes      BIGINT        NULL,
  purpose         VARCHAR(64)   NOT NULL DEFAULT 'general'
                                COMMENT 'general | radiografia | resultado_lab | foto_paciente',
  linked_to_type  VARCHAR(64)   NULL     COMMENT 'paciente | consulta | etc.',
  linked_to_id    VARCHAR(64)   NULL,
  created_by      VARCHAR(36)   NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_linked (linked_to_type, linked_to_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────────────────────
-- AUDITORIA — Append-only audit trail de todas las mutaciones
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria_log (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  ts            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_user_id VARCHAR(64)   NULL,
  tenant_id     VARCHAR(64)   NOT NULL,
  action        VARCHAR(64)   NOT NULL,
  resource      VARCHAR(128)  NOT NULL,
  resource_id   VARCHAR(128)  NULL,
  ip            VARCHAR(64)   NULL,
  user_agent    VARCHAR(512)  NULL,
  request_id    VARCHAR(64)   NULL,
  before_json   JSON          NULL,
  after_json    JSON          NULL,

  PRIMARY KEY (id),
  INDEX idx_tenant_ts      (tenant_id, ts),
  INDEX idx_actor          (actor_user_id),
  INDEX idx_resource       (resource, resource_id),
  INDEX idx_action         (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Append-only audit trail — never UPDATE or DELETE rows here';

SET foreign_key_checks = 1;

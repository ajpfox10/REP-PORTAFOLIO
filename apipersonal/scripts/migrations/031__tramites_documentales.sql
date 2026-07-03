-- 031__tramites_documentales.sql
-- Soporte para gestion masiva de tramites documentales:
-- becarios, interinos Ley 10430, expedientes y PDFs combinados en DOCU.

CREATE TABLE IF NOT EXISTS `tramites_documentales_lotes` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `poblacion`           VARCHAR(50)     NOT NULL,
  `tramite`             VARCHAR(50)     NOT NULL,
  `expediente_modo`     ENUM('unico','individual') NOT NULL DEFAULT 'unico',
  `expediente`          VARCHAR(100)    NULL,
  `rango_anio_desde`    INT             NULL,
  `rango_anio_hasta`    INT             NULL,
  `estado`              VARCHAR(40)     NOT NULL DEFAULT 'BORRADOR',
  `input_dir`           VARCHAR(700)    NULL,
  `docu_base_dir`       VARCHAR(700)    NULL,
  `created_by`          BIGINT UNSIGNED NULL,
  `created_at`          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`          DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tdl_estado` (`estado`),
  KEY `idx_tdl_tramite` (`poblacion`, `tramite`),
  KEY `idx_tdl_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tramites_documentales_agentes` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `lote_id`              BIGINT UNSIGNED NULL,
  `dni`                  INT             NOT NULL,
  `apellido_nombre`      VARCHAR(220)    NULL,
  `poblacion`            VARCHAR(50)     NULL,
  `tramite`              VARCHAR(50)     NULL,
  `tipo_beca`            VARCHAR(120)    NULL,
  `fecha_ingreso_excel`  DATE            NULL,
  `anio_designacion`     INT             NULL,
  `expediente`           VARCHAR(100)    NULL,
  `incluido`             TINYINT(1)      NOT NULL DEFAULT 1,
  `estado`               VARCHAR(40)     NOT NULL DEFAULT 'PENDIENTE',
  `motivo_exclusion`     VARCHAR(500)    NULL,
  `created_by`           BIGINT UNSIGNED NULL,
  `created_at`           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`           DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tda_dni` (`dni`),
  KEY `idx_tda_lote` (`lote_id`),
  KEY `idx_tda_estado` (`estado`),
  KEY `idx_tda_tramite` (`poblacion`, `tramite`),
  KEY `idx_tda_deleted` (`deleted_at`),
  CONSTRAINT `fk_tda_lote`
    FOREIGN KEY (`lote_id`) REFERENCES `tramites_documentales_lotes` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tramites_documentales_archivos` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `lote_id`         BIGINT UNSIGNED NULL,
  `agente_id`       BIGINT UNSIGNED NULL,
  `dni`             INT             NULL,
  `file_name`       VARCHAR(255)    NOT NULL,
  `source_path`     VARCHAR(700)    NULL,
  `target_path`     VARCHAR(700)    NULL,
  `combined_path`   VARCHAR(700)    NULL,
  `tblarchivo_id`   BIGINT UNSIGNED NULL,
  `pages`           INT             NULL,
  `bytes`           BIGINT UNSIGNED NULL,
  `lectura`         ENUM('texto','ocr','sin_texto') NOT NULL DEFAULT 'sin_texto',
  `status`          VARCHAR(40)     NOT NULL,
  `reason`          VARCHAR(500)    NULL,
  `candidates_json` JSON            NULL,
  `incluido`        TINYINT(1)      NOT NULL DEFAULT 1,
  `created_by`      BIGINT UNSIGNED NULL,
  `created_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tdf_dni` (`dni`),
  KEY `idx_tdf_lote` (`lote_id`),
  KEY `idx_tdf_agente` (`agente_id`),
  KEY `idx_tdf_status` (`status`),
  KEY `idx_tdf_tblarchivo` (`tblarchivo_id`),
  KEY `idx_tdf_deleted` (`deleted_at`),
  CONSTRAINT `fk_tdf_lote`
    FOREIGN KEY (`lote_id`) REFERENCES `tramites_documentales_lotes` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tdf_agente`
    FOREIGN KEY (`agente_id`) REFERENCES `tramites_documentales_agentes` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permisos (clave, descripcion)
VALUES
  ('crud:tramites_documentales_lotes:read',     'Leer lotes de tramites documentales'),
  ('crud:tramites_documentales_lotes:create',   'Crear lotes de tramites documentales'),
  ('crud:tramites_documentales_lotes:update',   'Actualizar lotes de tramites documentales'),
  ('crud:tramites_documentales_lotes:delete',   'Eliminar lotes de tramites documentales'),
  ('crud:tramites_documentales_agentes:read',   'Leer agentes de tramites documentales'),
  ('crud:tramites_documentales_agentes:create', 'Crear agentes de tramites documentales'),
  ('crud:tramites_documentales_agentes:update', 'Actualizar agentes de tramites documentales'),
  ('crud:tramites_documentales_agentes:delete', 'Eliminar agentes de tramites documentales'),
  ('crud:tramites_documentales_archivos:read',  'Leer archivos de tramites documentales');

-- ============================================================
-- Migration: 012__legajo_personal.sql
-- Descripción: Tablas para el Legajo Personal (formulario oficial
--              Provincia de Buenos Aires — Ministerio de Salud).
--              Complementa datos ya existentes en personal,
--              personaldetalle, agentes, bonificaciones, etc.
-- Idempotente: usa IF NOT EXISTS / INSERT IGNORE.
-- ============================================================

-- ── 1. legajo_familia (Página 04) ────────────────────────────────────────────
-- Grupo familiar del agente
CREATE TABLE IF NOT EXISTS `legajo_familia` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,               -- FK → personal.dni
  `parentesco`       VARCHAR(50)      NOT NULL,               -- Cónyuge, Hijo/a, Padre, Madre...
  `codigo`           VARCHAR(10)      NULL,
  `apellido_nombres` VARCHAR(200)     NOT NULL,
  `sexo`             ENUM('M','F','X') NULL,
  `vive`             TINYINT(1)       NOT NULL DEFAULT 1,
  `fecha_nacimiento` DATE             NULL,
  `es_empleado`      VARCHAR(200)     NULL,                   -- Cargo/empleo si trabaja
  `es_jubilado`      VARCHAR(200)     NULL,                   -- Caja y monto si jubilado
  `observaciones`    TEXT             NULL,
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_familia_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. legajo_familia_expedientes (Página 05) ────────────────────────────────
-- Expedientes vinculados al grupo familiar
CREATE TABLE IF NOT EXISTS `legajo_familia_expedientes` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,
  `expediente`       VARCHAR(100)     NULL,
  `fecha_informe`    DATE             NULL,
  `motivo`           VARCHAR(300)     NULL,
  `observacion`      TEXT             NULL,
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_familia_exp_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. legajo_funcion_destino (Página 08) ────────────────────────────────────
-- Funciones y destinos del agente a lo largo del tiempo
CREATE TABLE IF NOT EXISTS `legajo_funcion_destino` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,
  `funcion`          VARCHAR(200)     NULL,
  `destino`          VARCHAR(200)     NULL,
  `resolucion`       VARCHAR(100)     NULL,
  `fecha_ingreso`    DATE             NULL,
  `fecha_egreso`     DATE             NULL,
  `observaciones`    TEXT             NULL,
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_fd_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. legajo_licencias (Página 09) ──────────────────────────────────────────
-- Licencias formales (resolución/decreto)
CREATE TABLE IF NOT EXISTS `legajo_licencias` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,
  `resolucion`       VARCHAR(100)     NULL,
  `fecha`            DATE             NULL,
  `motivo`           VARCHAR(300)     NULL,
  `termino`          VARCHAR(100)     NULL,                   -- duración / término
  `a_partir_dia`     TINYINT          NULL,
  `a_partir_mes`     TINYINT          NULL,
  `a_partir_anio`    SMALLINT         NULL,
  `con_sueldo`       TINYINT(1)       NOT NULL DEFAULT 0,
  `con_50pct`        TINYINT(1)       NOT NULL DEFAULT 0,
  `sin_sueldo`       TINYINT(1)       NOT NULL DEFAULT 0,
  `observaciones`    TEXT             NULL,
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_lic_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. legajo_concepto_menciones (Página 11) ─────────────────────────────────
-- Evaluaciones de concepto y menciones especiales
CREATE TABLE IF NOT EXISTS `legajo_concepto_menciones` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,
  `fecha`            DATE             NULL,
  `referencias`      TEXT             NULL,                   -- texto libre de la mención
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_cm_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 6. legajo_penas_disciplinarias (Página 12) ───────────────────────────────
-- Sanciones disciplinarias aplicadas al agente
CREATE TABLE IF NOT EXISTS `legajo_penas_disciplinarias` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,
  `expediente_letra` VARCHAR(20)      NULL,
  `expediente_nro`   VARCHAR(50)      NULL,
  `expediente_anio`  SMALLINT         NULL,
  `decreto_resolucion` VARCHAR(100)   NULL,
  `fecha`            DATE             NULL,
  `calidad_pena`     VARCHAR(200)     NULL,                   -- tipo de pena
  `motivo`           TEXT             NULL,
  `observaciones`    TEXT             NULL,
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_pd_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 7. legajo_incompatibilidad (Página 14) ───────────────────────────────────
-- Declaración jurada de incompatibilidades / conflicto de interés
CREATE TABLE IF NOT EXISTS `legajo_incompatibilidad` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,
  `tiene_jubilacion` TINYINT(1)       NOT NULL DEFAULT 0,
  `jubilacion_ley`   VARCHAR(100)     NULL,
  `jubilacion_caja`  VARCHAR(100)     NULL,
  `jubilacion_monto` DECIMAL(12,2)    NULL,
  `jubilacion_fecha` DATE             NULL,
  `otro_cargo`       TINYINT(1)       NOT NULL DEFAULT 0,
  `otro_cargo_nivel` ENUM('NACIONAL','PROVINCIAL','MUNICIPAL','NINGUNO') NULL,
  `otro_cargo_lugar` VARCHAR(200)     NULL,
  `otro_cargo_monto` DECIMAL(12,2)    NULL,
  `otro_cargo_fecha_ingreso` DATE     NULL,
  `otras_actividades`        VARCHAR(300)  NULL,
  `otras_actividades_lugar`  VARCHAR(200)  NULL,
  `otras_actividades_monto`  DECIMAL(12,2) NULL,
  `otras_actividades_fecha`  DATE          NULL,
  `observaciones`    TEXT             NULL,
  `fecha_declaracion` DATE            NULL,
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_inc_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 8. legajo_embargos (Página 15) ───────────────────────────────────────────
-- Embargos sobre el salario del agente
CREATE TABLE IF NOT EXISTS `legajo_embargos` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,
  `expediente`       VARCHAR(100)     NULL,
  `fecha`            DATE             NULL,
  `suma_embargada`   DECIMAL(12,2)    NULL,
  `autoridad`        VARCHAR(200)     NULL,                   -- autoridad que ordena el embargo
  `ejecutante`       VARCHAR(200)     NULL,                   -- nombre del acreedor
  `fecha_levantamiento` DATE          NULL,
  `observaciones`    TEXT             NULL,
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_emb_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 9. legajo_declaracion_bienes (Página 16) ─────────────────────────────────
-- Declaración jurada de bienes
CREATE TABLE IF NOT EXISTS `legajo_declaracion_bienes` (
  `id`               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `dni`              INT              NOT NULL,
  `descripcion`      TEXT             NOT NULL,               -- descripción del bien
  `fecha`            DATE             NULL,
  `created_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME         NULL,
  `created_by`       INT              NULL,
  `updated_by`       INT              NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_legajo_db_dni` (`dni`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Columnas faltantes en bonificaciones (idempotente via procedure) ──────────
DROP PROCEDURE IF EXISTS `add_col_if_missing`;
DELIMITER //
CREATE PROCEDURE `add_col_if_missing`(
  tbl VARCHAR(64), col VARCHAR(64), definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL add_col_if_missing('bonificaciones', 'norma_legal',  'VARCHAR(200) NULL AFTER `decreto_numero`');
CALL add_col_if_missing('bonificaciones', 'a_partir',     'DATE NULL AFTER `fecha`');
CALL add_col_if_missing('bonificaciones', 'fecha_baja',   'DATE NULL');
CALL add_col_if_missing('bonificaciones', 'expediente',   'VARCHAR(100) NULL');
CALL add_col_if_missing('bonificaciones', 'created_at',   'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP');
CALL add_col_if_missing('bonificaciones', 'updated_at',   'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

DROP PROCEDURE IF EXISTS `add_col_if_missing`;

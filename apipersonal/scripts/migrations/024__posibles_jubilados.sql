-- 024__posibles_jubilados.sql
-- Registro de agentes identificados como posibles jubilados

CREATE TABLE IF NOT EXISTS posibles_jubilados (
  id                    bigint unsigned NOT NULL AUTO_INCREMENT,
  dni                   int             NOT NULL,
  apellido              varchar(100)    NOT NULL,
  nombre                varchar(100)    NOT NULL,
  fecha_nacimiento      date            NULL,
  fecha_ingreso         date            NULL,
  ley_nombre            varchar(200)    NULL,
  ocupacion_nombre      varchar(200)    NULL,
  es_insalubre          tinyint(1)      NOT NULL DEFAULT 0,
  tipo_jubilacion       varchar(50)     NULL COMMENT 'ORDINARIA | AGOTAMIENTO_PREMATURO | PRORRATEO',
  estado                enum('IDENTIFICADO','EN_TRAMITE','JUBILADO','DESCARTADO') NOT NULL DEFAULT 'IDENTIFICADO',
  observaciones         text            NULL,
  jubilacion_calculo_id bigint unsigned NULL,
  creado_por            bigint unsigned NULL,
  creado_por_nombre     varchar(190)    NULL,
  modificado_por        bigint unsigned NULL,
  modificado_por_nombre varchar(190)    NULL,
  created_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            datetime        NULL,
  PRIMARY KEY (id),
  INDEX idx_posibles_jub_dni        (dni),
  INDEX idx_posibles_jub_estado     (estado),
  INDEX idx_posibles_jub_created_at (created_at),
  INDEX idx_posibles_jub_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

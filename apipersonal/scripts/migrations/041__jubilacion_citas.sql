-- 041__jubilacion_citas.sql
-- Agenda de citas con agentes candidatos a jubilación.
-- Tras la cita, el agente puede promoverse al registro de posibles_jubilados
-- (POST /jubilacion/citas/:id/promover), quedando vinculado por posible_jubilado_id.

CREATE TABLE IF NOT EXISTS jubilacion_citas (
  id                    bigint unsigned NOT NULL AUTO_INCREMENT,
  dni                   int             NOT NULL,
  apellido              varchar(100)    NOT NULL,
  nombre                varchar(100)    NOT NULL,
  ley_nombre            varchar(200)    NULL,
  ocupacion_nombre      varchar(200)    NULL,
  fecha_cita            date            NOT NULL,
  hora_cita             time            NOT NULL,
  motivo                varchar(200)    NULL,
  estado                enum('AGENDADA','ATENDIDA','AUSENTE','REPROGRAMADA','CANCELADA') NOT NULL DEFAULT 'AGENDADA',
  observaciones         text            NULL,
  posible_jubilado_id   bigint unsigned NULL COMMENT 'posibles_jubilados.id cuando la cita derivó en alta al registro',
  creado_por            bigint unsigned NULL,
  creado_por_nombre     varchar(190)    NULL,
  modificado_por        bigint unsigned NULL,
  modificado_por_nombre varchar(190)    NULL,
  created_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            datetime        NULL,
  PRIMARY KEY (id),
  INDEX idx_jub_citas_dni        (dni),
  INDEX idx_jub_citas_fecha      (fecha_cita, hora_cita),
  INDEX idx_jub_citas_estado     (estado),
  INDEX idx_jub_citas_deleted_at (deleted_at),
  INDEX idx_jub_citas_posible    (posible_jubilado_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 112: habilitaciones del admin para que Salud Laboral cargue reconocimientos médicos
-- con fecha de un mes anterior (07/11/2026). Una fila = un agente (DNI) + un mes (YYYY-MM)
-- habilitado hasta `vigente_hasta`. Sin habilitación vigente, el CRUD rechaza fecha_desde
-- anterior al 1° del mes actual para usuarios no admin.
CREATE TABLE IF NOT EXISTS salud_laboral_habilitaciones (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  dni             VARCHAR(20)  NOT NULL,
  agente_nombre   VARCHAR(200) NULL,
  mes             CHAR(7)      NOT NULL,          -- 'YYYY-MM' habilitado
  vigente_hasta   DATE         NOT NULL,          -- inclusive
  motivo          VARCHAR(500) NULL,
  creado_por_id   INT          NULL,
  creado_por_email VARCHAR(200) NULL,
  creado_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revocada_at     DATETIME     NULL,
  revocada_por_id INT          NULL,
  INDEX idx_slh_dni_mes (dni, mes),
  INDEX idx_slh_vigente (vigente_hasta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

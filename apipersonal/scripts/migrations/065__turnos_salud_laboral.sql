-- 065 — Turnos con la médica de Salud Laboral
-- Un agente ausente (cod. 28) sin licencia de la médica recibe un turno (cita) para que la
-- médica cubra un rango de licencia. Se cruza en Ausentes 28 → pestaña "Ausentes vs Licencias".
-- La cobertura real sale de reconocimientos_medicos (grilla de Reconocimientos de Salud Laboral).
-- La tabla también se crea sola en runtime (turnosSaludLaboral.routes.ts → ensureTabla).
-- Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS turnos_salud_laboral (
  id             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni            INT          NOT NULL,
  fecha_turno    DATE         NOT NULL,              -- día de la cita con la médica
  hora_turno     TIME         NULL,
  fecha_desde    DATE         NOT NULL,              -- rango de licencia a cubrir
  fecha_hasta    DATE         NOT NULL,
  observaciones  VARCHAR(500) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted_at     DATETIME     NULL,
  created_by     INT          NULL,
  updated_by     INT          NULL,
  deleted_by     INT          NULL,
  KEY idx_tsl_dni_rango (dni, fecha_desde, fecha_hasta),
  KEY idx_tsl_fecha_turno (fecha_turno),
  CONSTRAINT fk_tsl_dni__personal FOREIGN KEY (dni)        REFERENCES personal (dni) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tsl_created_by    FOREIGN KEY (created_by) REFERENCES usuarios (id)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_tsl_updated_by    FOREIGN KEY (updated_by) REFERENCES usuarios (id)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_tsl_deleted_by    FOREIGN KEY (deleted_by) REFERENCES usuarios (id)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_tsl_rango CHECK (fecha_hasta >= fecha_desde)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 063 — Casos de violencia laboral
-- Un caso por hecho: víctima (agente), expediente, agresor interno (agente) o externo,
-- intervención y recomendaciones del equipo de violencia (DAVSAL / cambio de horario /
-- cambio de sector) y todo lo remitido (N remisiones por caso).
-- El número de expediente también se espeja como fila en `expedientes` del agente
-- (caratula 'VIOLENCIA LABORAL - EXPEDIENTE'), para que aparezca en Resoluciones/Expedientes.
-- Las tablas también se crean solas en runtime (casosViolencia.routes.ts → ensureTablas).
-- Idempotente: CREATE TABLE IF NOT EXISTS + INSERT IGNORE.

-- Catálogo de destinos a donde se remite
CREATE TABLE IF NOT EXISTS casos_violencia_destinos (
  id      INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre  VARCHAR(120) NOT NULL,
  activo  TINYINT(1)   NOT NULL DEFAULT 1,
  orden   INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uq_cvd_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO casos_violencia_destinos (nombre, orden) VALUES
  ('DAVSAL', 1), ('Salud Laboral', 2), ('Dirección', 3), ('Jefatura de servicio', 4),
  ('Legales', 5), ('Personal / RRHH', 6), ('Otro', 99);

CREATE TABLE IF NOT EXISTS casos_violencia (
  id                         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni                        INT          NOT NULL,              -- víctima
  servicio_id                INT          NULL,                  -- servicio de la víctima al momento del hecho
  fecha_hecho                DATE         NULL,
  descripcion                TEXT         NULL,
  expediente_numero          VARCHAR(255) NULL,
  expediente_id              INT          NULL,                  -- fila espejada en `expedientes`
  agresor_tipo               ENUM('INTERNO','EXTERNO') NOT NULL,
  agresor_dni                INT          NULL,                  -- INTERNO: agente del hospital
  agresor_servicio_id        INT          NULL,
  agresor_externo_nombre     VARCHAR(200) NULL,                  -- EXTERNO
  agresor_externo_vinculo    VARCHAR(120) NULL,                  -- paciente, familiar, proveedor…
  equipo_intervino           TINYINT(1)   NOT NULL DEFAULT 0,
  equipo_fecha_intervencion  DATE         NULL,
  equipo_observaciones       TEXT         NULL,
  rec_davsal                 TINYINT(1)   NOT NULL DEFAULT 0,
  rec_cambio_horario         TINYINT(1)   NOT NULL DEFAULT 0,
  rec_cambio_sector          TINYINT(1)   NOT NULL DEFAULT 0,
  rec_otra                   VARCHAR(255) NULL,
  estado                     ENUM('ABIERTO','EN_SEGUIMIENTO','CERRADO') NOT NULL DEFAULT 'ABIERTO',
  created_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted_at                 DATETIME     NULL,
  created_by                 INT          NULL,
  updated_by                 INT          NULL,
  deleted_by                 INT          NULL,
  KEY idx_cv_dni (dni),
  KEY idx_cv_agresor_dni (agresor_dni),
  KEY idx_cv_estado (estado),
  CONSTRAINT fk_cv_dni__personal          FOREIGN KEY (dni)                 REFERENCES personal (dni)    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cv_agresor_dni__personal  FOREIGN KEY (agresor_dni)         REFERENCES personal (dni)    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cv_servicio               FOREIGN KEY (servicio_id)         REFERENCES servicios (id)    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cv_agresor_servicio       FOREIGN KEY (agresor_servicio_id) REFERENCES servicios (id)    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cv_expediente             FOREIGN KEY (expediente_id)       REFERENCES expedientes (id)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cv_created_by             FOREIGN KEY (created_by)          REFERENCES usuarios (id)     ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cv_updated_by             FOREIGN KEY (updated_by)          REFERENCES usuarios (id)     ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cv_deleted_by             FOREIGN KEY (deleted_by)          REFERENCES usuarios (id)     ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_cv_agresor CHECK (
    (agresor_tipo = 'INTERNO' AND agresor_dni IS NOT NULL) OR
    (agresor_tipo = 'EXTERNO' AND agresor_dni IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Todo lo remitido: N por caso
CREATE TABLE IF NOT EXISTS casos_violencia_remisiones (
  id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  caso_id      INT          NOT NULL,
  destino_id   INT          NOT NULL,
  fecha        DATE         NOT NULL,
  numero       VARCHAR(255) NULL,                                -- nota / expediente / IF
  observacion  TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at   DATETIME     NULL,
  created_by   INT          NULL,
  deleted_by   INT          NULL,
  KEY idx_cvr_caso (caso_id),
  CONSTRAINT fk_cvr_caso       FOREIGN KEY (caso_id)    REFERENCES casos_violencia (id)          ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_cvr_destino    FOREIGN KEY (destino_id) REFERENCES casos_violencia_destinos (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cvr_created_by FOREIGN KEY (created_by) REFERENCES usuarios (id)                 ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cvr_deleted_by FOREIGN KEY (deleted_by) REFERENCES usuarios (id)                 ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Auditoría (quién creó / modificó / borró, con antes y después)
CREATE TABLE IF NOT EXISTS casos_violencia_auditoria (
  id             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  caso_id        INT          NOT NULL,
  accion         VARCHAR(40)  NOT NULL,
  usuario_id     INT          NULL,
  datos_antes    JSON         NULL,
  datos_despues  JSON         NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cva_caso (caso_id),
  CONSTRAINT fk_cva_caso    FOREIGN KEY (caso_id)    REFERENCES casos_violencia (id) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_cva_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

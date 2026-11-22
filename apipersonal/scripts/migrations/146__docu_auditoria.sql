-- 146__docu_auditoria.sql (22/11/2026, pedido del usuario)
-- Auditoría de la documentación en DOCU: una fila por archivo guardado/movido, con quién, desde qué PC
-- y por qué vía (robot, subida desde Trámites, movido). La muestra la pestaña "Auditoría" de Trámites
-- Documentales junto con lo que ya queda en tblarchivos (escáner, mail) y audit_log.
-- La escriben: services/docuAuditoria.ts (docu-upload / docu-move de Trámites) y los robots
-- (descargar_legajo_digital_siape.py, ...). Se aplica también en runtime (ensureDocuAuditoria).

CREATE TABLE IF NOT EXISTS docu_auditoria (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  dni         INT NOT NULL,
  ruta        VARCHAR(600) NOT NULL,            -- relativa a DOCU (ej. 12345678\Curriculum\Curriculum SIAPE 16-11-2026.pdf)
  documento   VARCHAR(200) NULL,                -- tipo / carpeta del documento
  origen      VARCHAR(20) NOT NULL,             -- robot | subida | movido | escaner | mail
  usuario_id  INT NULL,
  pc          VARCHAR(120) NULL,                -- nombre de red de la PC (o del servidor si fue un robot)
  ip          VARCHAR(45) NULL,
  robot       VARCHAR(80) NULL,                 -- script del robot (robots_config.script) si lo guardó un robot
  detalle     VARCHAR(500) NULL,
  creado_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_docu_aud_dni (dni, creado_at),
  KEY ix_docu_aud_creado (creado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

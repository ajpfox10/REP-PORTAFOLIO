-- Juntas médicas hechas (Salud Laboral → pestaña ⚖️ Juntas médicas).
-- Antes una junta era solo un PDF suelto en tblarchivos (tipo/nombre con "junta"/"dictamen"):
-- sin fecha de la junta, resultado ni días. Acá queda cada junta con sus datos y el escaneo
-- vinculado (archivo_id → tblarchivos.id). Las demás páginas (tareas livianas, jefe, licencias
-- médicas) muestran el PDF desde acá.
-- juntas_medicas_descartes: escaneos con "junta" en el nombre que NO son un dictamen
-- (solicitud de nueva fecha, cédula, descargo…) para que no vuelvan a aparecer como "sin registrar".
-- Idempotente (el router hace el mismo CREATE TABLE IF NOT EXISTS al arrancar).

CREATE TABLE IF NOT EXISTS juntas_medicas (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  dni                  VARCHAR(20)  NOT NULL,
  agente_nombre        VARCHAR(200) NULL,
  servicio             VARCHAR(200) NULL,
  fecha_junta          DATE         NULL,
  resultado            VARCHAR(40)  NULL,
  fecha_desde          DATE         NULL,
  fecha_hasta          DATE         NULL,
  cantidad_dias        INT          NULL,
  observaciones        TEXT         NULL,
  archivo_id           INT          NULL,
  activo               TINYINT(1)   NOT NULL DEFAULT 1,
  creado_por_id        INT          NULL,
  creado_por_email     VARCHAR(200) NULL,
  creado_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modificado_por_id    INT          NULL,
  modificado_por_email VARCHAR(200) NULL,
  modificado_at        DATETIME     NULL,
  eliminado_por_id     INT          NULL,
  eliminado_por_email  VARCHAR(200) NULL,
  eliminado_at         DATETIME     NULL,
  INDEX idx_jm_dni (dni),
  INDEX idx_jm_fecha (fecha_junta),
  INDEX idx_jm_archivo (archivo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS juntas_medicas_descartes (
  archivo_id     INT          NOT NULL PRIMARY KEY,
  usuario_id     INT          NULL,
  usuario_email  VARCHAR(200) NULL,
  at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

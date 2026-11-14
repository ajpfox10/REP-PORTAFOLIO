-- 128: historial de los avisos por WhatsApp de Gestiones Personales (gp_avisos_whatsapp, mig 127).
-- Cada cambio de estado (ESCRITO / ENVIADO / OMITIDO / error al escribir) deja una fila: a quién,
-- qué estado, a qué número, el detalle y qué usuario de personalv5 lo hizo. No se borra nunca.
-- La API también crea la tabla si falta y carga lo anterior con el estado vigente de cada aviso.
CREATE TABLE IF NOT EXISTS gp_avisos_historial (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  aviso_id INT NOT NULL,
  dni INT NOT NULL,
  agente VARCHAR(150) NULL,
  estado_anterior VARCHAR(12) NULL,
  estado VARCHAR(12) NOT NULL,            -- PENDIENTE | ESCRITO | ENVIADO | OMITIDO | ERROR
  telefono VARCHAR(30) NULL,
  detalle VARCHAR(300) NULL,
  usuario_id INT NULL,
  usuario_email VARCHAR(200) NULL,
  at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_gpah_aviso (aviso_id),
  KEY ix_gpah_at (at),
  KEY ix_gpah_dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Lo que ya se hizo antes de esta tabla: una fila por aviso con su estado actual (sin usuario).
INSERT INTO gp_avisos_historial (aviso_id, dni, agente, estado_anterior, estado, telefono, detalle, at)
SELECT a.id, a.dni, a.agente, NULL,
       CASE WHEN a.estado = 'PENDIENTE' AND a.detalle IS NOT NULL THEN 'ERROR' ELSE a.estado END,
       a.telefono, a.detalle, a.estado_at
  FROM gp_avisos_whatsapp a
 WHERE a.estado_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM gp_avisos_historial h WHERE h.aviso_id = a.id);

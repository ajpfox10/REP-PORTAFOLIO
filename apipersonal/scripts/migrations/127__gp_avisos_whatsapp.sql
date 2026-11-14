-- 127: avisos por WhatsApp a los agentes que el robot intranet_gp_confirmar confirmó en
-- Gestiones Personales (clave provisoria = DNI). El robot anota cada confirmado como PENDIENTE;
-- desde Reportes → WhatsApp la extensión deja el mensaje ESCRITO (sin enviar) chat por chat y
-- la persona toca Enviar y lo marca ENVIADO. La API también crea las tablas si faltan.
CREATE TABLE IF NOT EXISTS gp_avisos_whatsapp (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni INT NOT NULL,
  cuil VARCHAR(11) NOT NULL,
  legajo VARCHAR(10) NULL,
  agente VARCHAR(150) NULL,               -- nombre como figura en Gestiones Personales
  confirmado_el DATE NOT NULL,
  confirmado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado ENUM('PENDIENTE','ESCRITO','ENVIADO','OMITIDO') NOT NULL DEFAULT 'PENDIENTE',
  estado_at DATETIME NULL,
  telefono VARCHAR(30) NULL,              -- número al que se le escribió
  detalle VARCHAR(300) NULL,
  UNIQUE KEY uq_gpaw_cuil_dia (cuil, confirmado_el),
  KEY ix_gpaw_estado (estado),
  KEY ix_gpaw_dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS gp_avisos_config (
  id TINYINT NOT NULL PRIMARY KEY,
  mensaje TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO gp_avisos_config (id, mensaje) VALUES (1,
  'Hola {nombre}, ya está confirmado tu usuario de Gestiones Personales del Ministerio. Entrá con tu DNI como clave provisoria y cambiala por una propia.');

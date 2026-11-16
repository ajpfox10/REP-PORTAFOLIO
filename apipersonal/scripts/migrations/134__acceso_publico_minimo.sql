-- Acceso mínimo del servidor público (bot de WhatsApp + página de la Agenda de turnos).
-- El servidor público es lo único expuesto a internet (túnel ngrok/Cloudflare). Con su usuario de MySQL
-- de permisos mínimos (scripts/crear_usuario_publico.cmd) solo puede:
--   - anotar el cuerpo del webhook de Meta en whatsapp_bot_entrada (INSERT, sin poder leer);
--   - leer la clave secreta + token de verificación de Meta (vista v_publico_wa_claves);
--   - leer nombre/ley/ocupación de quienes recibieron un enlace de turno (vista v_publico_agenda_agente)
--     y las tablas de la agenda.
-- La API interna procesa la bandeja (whatsappBot.ts → procesarBandeja) con su usuario completo.
-- Idempotente: la API hace lo mismo al arrancar (ensureBotTablas / ensureVistaPublicaAgenda).

CREATE TABLE IF NOT EXISTS whatsapp_bot_config (
  k VARCHAR(60) NOT NULL PRIMARY KEY,
  valor TEXT NULL,
  updated_by VARCHAR(120) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_bot_entrada (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  cuerpo MEDIUMTEXT NOT NULL,
  recibido_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  procesado_at DATETIME NULL,
  error VARCHAR(500) NULL,
  KEY ix_estado (estado, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_publico_wa_claves AS
SELECT k, valor FROM whatsapp_bot_config WHERE k IN ('wa_app_secret', 'wa_verify_token');

CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_publico_agenda_agente AS
SELECT p.dni, p.apellido, p.nombre,
       (SELECT l.nombre FROM agentes a LEFT JOIN ley l ON l.id = a.ley_id
         WHERE a.dni = p.dni AND a.deleted_at IS NULL
         ORDER BY (a.estado_empleo = 'ACTIVO') DESC, a.fecha_ingreso DESC, a.id DESC LIMIT 1) AS ley_nombre,
       (SELECT o.nombre FROM agentes a LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id
         WHERE a.dni = p.dni AND a.deleted_at IS NULL
         ORDER BY (a.estado_empleo = 'ACTIVO') DESC, a.fecha_ingreso DESC, a.id DESC LIMIT 1) AS ocupacion_nombre
  FROM personal p
 WHERE p.dni IN (SELECT h.dni FROM agenda_habilitaciones h);

-- 143__agenda_cola_envios.sql (21/11/2026, pedido del usuario)
-- Cola de envíos de la agenda de turnos: el servidor no tiene WhatsApp abierto. La oficina pone enlaces
-- en la cola desde cualquier PC y los manda UNA PC marcada que tiene la app + la extensión + WhatsApp Web
-- abiertos ("Esta PC manda los mensajes de la agenda"). Esa PC toma de a uno (sin que dos PCs tomen el mismo),
-- el servidor vuelve a revisar que la persona no tenga turno ya reservado, y la PC devuelve el resultado.
-- Se aplica también en runtime (ensureAgendaTablas).

CREATE TABLE IF NOT EXISTS agenda_envios_cola (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  habilitacion_id INT NOT NULL,
  agenda_id       INT NOT NULL,
  dni             BIGINT NOT NULL,
  estado          ENUM('PENDIENTE','TOMADO','ENVIADO','ERROR','SALTEADO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  prueba_destino  VARCHAR(30) NULL COMMENT 'prueba: se manda a este número y NO se marca enviado',
  celular         VARCHAR(30) NULL COMMENT 'a qué número se mandó',
  url_usada       VARCHAR(255) NULL COMMENT 'dirección pública que llevaba el mensaje',
  toma            VARCHAR(40) NULL,
  pc              VARCHAR(60) NULL COMMENT 'PC que lo tomó/mandó',
  detalle         VARCHAR(500) NULL,
  intentos        INT NOT NULL DEFAULT 0,
  created_by      INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tomado_at       DATETIME NULL,
  terminado_at    DATETIME NULL,
  KEY ix_aec_estado (estado, id),
  KEY ix_aec_hab (habilitacion_id),
  KEY ix_aec_agenda (agenda_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

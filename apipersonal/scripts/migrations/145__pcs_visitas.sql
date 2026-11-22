-- 145__pcs_visitas.sql (21/11/2026, pedido del usuario)
-- Qué PCs usaron la app (navegador con usuario) en las últimas horas/días: una fila por IP con el último
-- pedido. La anota services/pcsConectadas.ts (como mucho una escritura por minuto por PC) y la muestra la
-- lista "PCs conectadas" de la Agenda de turnos (selector 1 h / 24 h / 48 h). Sobrevive reinicios de la API.
-- Se aplica también en runtime (ensureAgendaTablas).

CREATE TABLE IF NOT EXISTS pcs_visitas (
  ip          VARCHAR(45) NOT NULL PRIMARY KEY,
  user_id     INT NULL,
  user_agent  VARCHAR(200) NULL,
  primer_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pedidos     INT NOT NULL DEFAULT 0,
  KEY ix_pv_ultimo (ultimo_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

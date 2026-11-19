-- 138__legajo_autocarga.sql (18/11/2026, pedido del usuario)
-- Legajo por enlace: la oficina habilita a un agente → enlace único /l/<token> (mismo servidor público y túnel
-- de la Agenda de turnos) → el agente completa sus datos (hoja 1, familia, incompatibilidad, bienes, DJ).
-- Lo que manda queda ACÁ (tabla de espera): el servidor público nunca escribe en legajo_* ni en personal.
-- La oficina lo revisa en /app/legajo → "Recibidos por enlace" y al aprobar se carga con la misma lógica del
-- importador del Formulario de Google (completa lo vacío; pisar es opcional). El Formulario de Google sigue.
--
-- Estados: HABILITADO (puede completar) → ENVIADO (en revisión, ya no edita) → APROBADO
--          ENVIADO → DEVUELTO (la oficina pide corregir: vuelve a editar con el mismo enlace) → ENVIADO …
--          HABILITADO/DEVUELTO → VENCIDO (vence_el) · cualquiera abierto → ANULADO
-- respuestas = { "<título de la pregunta del Formulario de Google>": valor } (mismas claves que lee el importador).
-- Se aplica también en runtime (ensureAutocargaTabla en services/legajoAutocarga.ts).

CREATE TABLE IF NOT EXISTS legajo_autocarga (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dni INT NOT NULL,
  token CHAR(43) NOT NULL,
  nombre_mostrar VARCHAR(160) NULL COMMENT 'lo único del agente que ve el servidor público',
  estado ENUM('HABILITADO','ENVIADO','DEVUELTO','APROBADO','ANULADO','VENCIDO') NOT NULL DEFAULT 'HABILITADO',
  vence_el DATE NOT NULL,
  respuestas JSON NULL,
  telefono VARCHAR(20) NULL,
  guardado_at DATETIME NULL,
  enviado_at DATETIME NULL,
  devolucion_motivo VARCHAR(500) NULL,
  revisado_at DATETIME NULL,
  revisado_by INT NULL,
  resumen JSON NULL COMMENT 'qué se cargó al aprobar',
  observacion VARCHAR(255) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INT NULL,
  anulado_at DATETIME NULL,
  anulado_by INT NULL,
  abierto_dni INT GENERATED ALWAYS AS (IF(estado IN ('HABILITADO','ENVIADO','DEVUELTO'), dni, NULL)) STORED,
  UNIQUE KEY uq_la_token (token),
  UNIQUE KEY uq_la_abierto (abierto_dni),
  KEY idx_la_dni (dni),
  KEY idx_la_estado (estado),
  CONSTRAINT fk_la_personal FOREIGN KEY (dni) REFERENCES personal (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

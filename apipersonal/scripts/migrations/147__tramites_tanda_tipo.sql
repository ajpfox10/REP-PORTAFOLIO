-- 147__tramites_tanda_tipo.sql (25/11/2026, pedido del usuario)
-- Tipo de trámite de cada tanda (Designación de agente = proceso 'PASE A TRANSITORIA', Renovación de
-- extranjeros = 'RENOVACION EXTRANJEROS', u otro que se cree). El tipo define qué documentos lleva el
-- trámite: las filas de orden_documentos_expediente con ese proceso (pestaña "Documentos por trámite").
-- Sin fila acá: tanda "RENOVACI…" → renovación de extranjeros; el resto → designación.
-- Se aplica también en runtime (ensureTandaTipo en tramitesDocumentales.routes.ts).

CREATE TABLE IF NOT EXISTS tramites_tanda_tipo (
  tanda           VARCHAR(80)  NOT NULL PRIMARY KEY,
  proceso         VARCHAR(80)  NOT NULL,
  usuario         VARCHAR(120) NULL,
  actualizado_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

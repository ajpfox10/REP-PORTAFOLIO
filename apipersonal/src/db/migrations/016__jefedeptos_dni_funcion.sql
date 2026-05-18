-- ============================================================
-- 016: jefedeptos — historial de ocupación de jefaturas
--
-- jefaturas  → catálogo de cargos (nomenclatura)
-- jefedeptos → historial: quién (dni→personal) ocupó
--              qué cargo (jefatura_id→jefaturas), cuándo y
--              con qué acto administrativo.
-- ============================================================

ALTER TABLE jefedeptos
  -- FK al catálogo de cargos (reemplaza el campo texto jefedepto)
  ADD COLUMN jefatura_id    INT          NULL DEFAULT NULL AFTER id,
  -- FK al agente que ocupa el cargo
  ADD COLUMN dni            INT          NULL DEFAULT NULL AFTER jefatura_id,
  -- Datos del acto administrativo
  ADD COLUMN tipo_funcion   VARCHAR(50)  NULL DEFAULT NULL AFTER oficinacentral,
  ADD COLUMN nro_acto_admin VARCHAR(100) NULL DEFAULT NULL AFTER tipo_funcion,
  ADD COLUMN fecha_desde    DATE         NULL DEFAULT NULL AFTER nro_acto_admin,
  ADD COLUMN fecha_hasta    DATE         NULL DEFAULT NULL AFTER fecha_desde,
  -- Auditoría
  ADD COLUMN created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER fecha_hasta,
  ADD COLUMN updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE jefedeptos
  ADD CONSTRAINT fk_jefedeptos_jefatura
    FOREIGN KEY (jefatura_id) REFERENCES jefaturas(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_jefedeptos_personal
    FOREIGN KEY (dni) REFERENCES personal(dni)
    ON UPDATE CASCADE ON DELETE SET NULL;

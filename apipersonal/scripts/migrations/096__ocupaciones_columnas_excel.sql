-- 096__ocupaciones_columnas_excel.sql
-- `ocupaciones` con todas las columnas del Excel del nomenclador 10430: agrupamiento,
-- codigo, denominacion (nombre), letra de clase, tareas, requisitos, caracteristicas
-- especiales, incorporado por, dejado sin efecto por y ambito de aplicacion.
-- Los valores se copian de nomenclador_cargos (mig 094) para las ocupaciones con
-- nomenclador_cargo_id; las demas quedan NULL. scripts/cargar_ocupaciones_nomenclador.py
-- vuelve a sincronizarlas cada vez que se corre.
--
-- NO es idempotente como SQL plano: verificar en information_schema antes de correrlo.

ALTER TABLE ocupaciones
  ADD COLUMN agrupamiento_id        TINYINT NULL AFTER agrupamiento,
  ADD COLUMN letra                  CHAR(1) NULL AFTER codigo,
  ADD COLUMN descripcion_tareas     TEXT NULL,
  ADD COLUMN requisitos             TEXT NULL,
  ADD COLUMN caracteristicas        TEXT NULL,
  ADD COLUMN incorporado_por        VARCHAR(255) NULL,
  ADD COLUMN dejado_sin_efecto_por  VARCHAR(255) NULL,
  ADD COLUMN ambito_aplicacion      VARCHAR(255) NULL,
  ADD KEY ix_ocupaciones_agrupamiento (agrupamiento_id),
  ADD CONSTRAINT fk_ocupaciones_agrupamiento
    FOREIGN KEY (agrupamiento_id) REFERENCES nomenclador_agrupamientos (id);

UPDATE ocupaciones o
  JOIN nomenclador_cargos c ON c.id = o.nomenclador_cargo_id
   SET o.agrupamiento_id       = c.agrupamiento_id,
       o.letra                 = c.letra,
       o.descripcion_tareas    = c.descripcion_tareas,
       o.requisitos            = c.requisitos,
       o.caracteristicas       = c.caracteristicas,
       o.incorporado_por       = c.incorporado_por,
       o.dejado_sin_efecto_por = c.dejado_sin_efecto_por,
       o.ambito_aplicacion     = c.ambito_aplicacion;

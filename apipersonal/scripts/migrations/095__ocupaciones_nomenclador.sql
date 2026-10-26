-- 095__ocupaciones_nomenclador.sql
-- `ocupaciones` de la Ley 10430 pasa a ser el nomenclador de cargos (mig 094): una
-- ocupacion por cargo del Excel, con su agrupamiento, codigo y FK a nomenclador_cargos.
-- Las ocupaciones de otras leyes no se tocan (nomenclador_cargo_id NULL).
--
-- Lo carga scripts/cargar_ocupaciones_nomenclador.py. nombre se ensancha porque hay
-- denominaciones de hasta 84 caracteres.
--
-- NO es idempotente como SQL plano: verificar en information_schema antes de correrlo.

ALTER TABLE ocupaciones
  MODIFY COLUMN nombre VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  ADD COLUMN nomenclador_cargo_id INT NULL AFTER ley_id,
  ADD UNIQUE KEY ux_ocupacion_nomenclador_cargo (nomenclador_cargo_id),
  ADD CONSTRAINT fk_ocupaciones_nomenclador_cargo
    FOREIGN KEY (nomenclador_cargo_id) REFERENCES nomenclador_cargos (id);

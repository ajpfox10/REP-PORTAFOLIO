-- 097__ocupaciones_insalubre_norma.sql
-- Funciones consideradas de caracter insalubre (D:\G\Funciones Insalubres.xlsx) sobre las
-- ocupaciones del nomenclador 10430 (mig 095): se marca es_insalubre = 1 y la norma que
-- la establece va en la columna nueva norma_insalubre.
--
-- Agrupamiento 4 (Tecnico): hemoterapia (auxiliar 89-92, ayudante 169-172), radiologia
--   (auxiliar 133-136, tecnico 529-532), tecnico laboratorista 573-576, eviscerador 249-252,
--   preparador de histologia 413-416, auxiliar de patologia 125-128.
-- Agrupamiento 2 (Obrero): todo salvo conmutador telefonico (40, 41).
-- Agrupamiento 1 (Servicio): choferes (13-15) y camilleros (3); lavadero (28-31).
-- BIOQUIMICO (marcado antes por el usuario) no se toca.
--
-- NO es idempotente como SQL plano (ADD COLUMN): verificar en information_schema antes de correrlo.

ALTER TABLE ocupaciones
  ADD COLUMN norma_insalubre VARCHAR(255) NULL AFTER es_insalubre;

UPDATE ocupaciones o JOIN nomenclador_cargos c ON c.id = o.nomenclador_cargo_id
   SET o.es_insalubre = 1,
       o.norma_insalubre = 'Resolución Nº 164/72 - Artículo 7º'
 WHERE c.agrupamiento_id = 4
   AND (c.codigo BETWEEN 89 AND 92 OR c.codigo BETWEEN 169 AND 172 OR c.codigo BETWEEN 133 AND 136
        OR c.codigo BETWEEN 529 AND 532 OR c.codigo BETWEEN 573 AND 576 OR c.codigo BETWEEN 249 AND 252
        OR c.codigo BETWEEN 413 AND 416 OR c.codigo BETWEEN 125 AND 128);

UPDATE ocupaciones o JOIN nomenclador_cargos c ON c.id = o.nomenclador_cargo_id
   SET o.es_insalubre = 1,
       o.norma_insalubre = 'Incluido en la Res. Nº 164/72 - Art. 7º por Resolución Nº 1217/92'
 WHERE (c.agrupamiento_id = 2 AND c.codigo NOT IN (38, 40, 41))
    OR (c.agrupamiento_id = 1 AND c.codigo IN (3, 13, 14, 15));

UPDATE ocupaciones o JOIN nomenclador_cargos c ON c.id = o.nomenclador_cargo_id
   SET o.es_insalubre = 1,
       o.norma_insalubre = 'Incluido en la Res. Nº 164/72 - Art. 7º por Resolución Nº 2854/75'
 WHERE c.agrupamiento_id = 2 AND c.codigo = 38;

UPDATE ocupaciones o JOIN nomenclador_cargos c ON c.id = o.nomenclador_cargo_id
   SET o.es_insalubre = 1,
       o.norma_insalubre = 'Decreto Nº 406/83 - Establece las tareas como insalubres'
 WHERE c.agrupamiento_id = 1 AND c.codigo BETWEEN 28 AND 31;

-- 018__allow_duplicate_agentes_dni.sql
-- Permite conservar historial de vinculaciones laborales para un mismo DNI.
-- La unicidad del agente/persona queda en personal.dni; agentes.dni debe admitir
-- varias filas historicas y una fila vigente por deleted_at/estado_empleo.

ALTER TABLE `agentes` DROP INDEX `uq_agentes_dni`;

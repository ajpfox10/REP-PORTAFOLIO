-- 002__enforce_id_pk_everywhere.sql
-- Objetivo: estandarizar PK simple `id` en TODAS las tablas (normalización).
-- Nota: las tablas están vacías, así que no hay backfill.

SET FOREIGN_KEY_CHECKS = 0;

-- categoria: PK legacy = `ID` (lo dejamos como UNIQUE)
ALTER TABLE `categoria` DROP PRIMARY KEY;
ALTER TABLE `categoria`
  ADD COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_categoria__ID` (`ID`);

-- codigoa: PK legacy = `nu` (lo dejamos como UNIQUE)
ALTER TABLE `codigoa` DROP PRIMARY KEY;
ALTER TABLE `codigoa`
  ADD COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_codigoa__nu` (`nu`);

-- personal: PK legacy = `dni` (lo dejamos como UNIQUE)
ALTER TABLE `personal` DROP PRIMARY KEY;
ALTER TABLE `personal`
  ADD COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_personal__dni` (`dni`);

-- sequelizemeta: PK legacy = `name` (ya tiene UNIQUE(name); lo preservamos)
ALTER TABLE `sequelizemeta` DROP PRIMARY KEY;
ALTER TABLE `sequelizemeta`
  ADD COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`id`);

SET FOREIGN_KEY_CHECKS = 1;

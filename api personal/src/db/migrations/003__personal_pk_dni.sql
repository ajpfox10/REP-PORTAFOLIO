-- 002__personal_pk_dni.sql
-- Normalización: PK natural en personal = dni (identificador único de negocio)

SET FOREIGN_KEY_CHECKS = 0;

-- Asegurar tipo/nullable (ajustá tipo si tu dni es VARCHAR en tu DB; acá lo dejo BIGINT como ejemplo seguro)
ALTER TABLE `personal`
  MODIFY `dni` BIGINT NOT NULL;

-- Si ya existe PK distinto, lo bajamos y ponemos PK(dni)
-- (si ya era PK(dni), no pasa nada)
ALTER TABLE `personal`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`dni`);

SET FOREIGN_KEY_CHECKS = 1;

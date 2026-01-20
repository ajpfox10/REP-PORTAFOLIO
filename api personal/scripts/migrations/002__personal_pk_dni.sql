SET FOREIGN_KEY_CHECKS = 0;

-- Ajustá el tipo si tu DNI es BIGINT o VARCHAR. Si ya es correcto, dejalo.
-- Ejemplo seguro si trabajás con DNI como texto:
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `personal`
  MODIFY `dni` INT NOT NULL;

ALTER TABLE `personal`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`dni`);

SET FOREIGN_KEY_CHECKS = 1;

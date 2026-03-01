-- 003__dni_foreign_keys.sql
-- Generado automáticamente: FKs hacia personal(dni) donde exista columna 'dni'

SET FOREIGN_KEY_CHECKS = 0;

-- agentes
ALTER TABLE `agentes` ADD INDEX `idx_agentes__dni` (`dni`);
ALTER TABLE `agentes` ADD CONSTRAINT `fk_agentes__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- agentes_servicios
ALTER TABLE `agentes_servicios` ADD INDEX `idx_agentes_servicios__dni` (`dni`);
ALTER TABLE `agentes_servicios` ADD CONSTRAINT `fk_agentes_servicios__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- bonificaciones
ALTER TABLE `bonificaciones` ADD INDEX `idx_bonificaciones__dni` (`dni`);
ALTER TABLE `bonificaciones` ADD CONSTRAINT `fk_bonificaciones__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- cc
ALTER TABLE `cc` ADD INDEX `idx_cc__dni` (`dni`);
ALTER TABLE `cc` ADD CONSTRAINT `fk_cc__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- citaciones
ALTER TABLE `citaciones` ADD INDEX `idx_citaciones__dni` (`dni`);
ALTER TABLE `citaciones` ADD CONSTRAINT `fk_citaciones__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- consultas
ALTER TABLE `consultas` ADD INDEX `idx_consultas__dni` (`dni`);
ALTER TABLE `consultas` ADD CONSTRAINT `fk_consultas__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- expedientes
ALTER TABLE `expedientes` ADD INDEX `idx_expedientes__dni` (`dni`);
ALTER TABLE `expedientes` ADD CONSTRAINT `fk_expedientes__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- inconvenientesagentes
ALTER TABLE `inconvenientesagentes` ADD INDEX `idx_inconvenientesagentes__dni` (`dni`);
ALTER TABLE `inconvenientesagentes` ADD CONSTRAINT `fk_inconvenientesagentes__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- ordenesdetrabajo
ALTER TABLE `ordenesdetrabajo` ADD INDEX `idx_ordenesdetrabajo__dni` (`dni`);
ALTER TABLE `ordenesdetrabajo` ADD CONSTRAINT `fk_ordenesdetrabajo__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- pedidos
ALTER TABLE `pedidos` ADD INDEX `idx_pedidos__dni` (`dni`);
ALTER TABLE `pedidos` ADD CONSTRAINT `fk_pedidos__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- resoluciones
ALTER TABLE `resoluciones` ADD INDEX `idx_resoluciones__dni` (`dni`);
ALTER TABLE `resoluciones` ADD CONSTRAINT `fk_resoluciones__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- tblarchivos
ALTER TABLE `tblarchivos` ADD INDEX `idx_tblarchivos__dni` (`dni`);
ALTER TABLE `tblarchivos` ADD CONSTRAINT `fk_tblarchivos__dni__personal_dni` FOREIGN KEY (`dni`) REFERENCES `personal`(`dni`) ON UPDATE RESTRICT ON DELETE RESTRICT;

SET FOREIGN_KEY_CHECKS = 1;

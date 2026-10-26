-- 080: mínimo de personal por sector × turno × tipo de día (habil = lun–vie, finde = sáb/dom/feriado), lo carga el jefe desde "Presentismo por turno" (Mi Sector).
-- servicio_id = primer id del grupo del jefe (Sala 24 + Dpto 34 de Enfermería se guardan como 24).
-- sector = nombre del sector (igual que la tarjeta de Mi Sector, que agrupa sectores homónimos de 24 y 34).
-- La tabla también se crea sola en runtime (ensureMinimosTable en presentismoSector.routes.ts).
CREATE TABLE IF NOT EXISTS dotacion_minima (
  id INT NOT NULL AUTO_INCREMENT,
  servicio_id INT NOT NULL,
  sector VARCHAR(150) NOT NULL,
  turno VARCHAR(10) NOT NULL,
  tipo_dia VARCHAR(6) NOT NULL DEFAULT 'habil',
  minimo INT NOT NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dotacion_minima (servicio_id, sector, turno, tipo_dia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

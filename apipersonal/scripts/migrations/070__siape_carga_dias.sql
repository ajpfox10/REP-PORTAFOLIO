-- 070__siape_carga_dias.sql
-- Estado por día de la carga de francos/compensatorios en SiAPe (robot cargar_francos_siape.py).
-- 1 fila por dni+fecha: CARGADO / YA_EXISTIA no se reintentan; ERROR se reintenta hasta
-- SIAPE_MAX_INTENTOS. reconocimientos_medicos.procesado=1 recién con todos los días listos.
-- El robot la crea solo al arrancar (SQL_TABLA_DIAS); este archivo es el espejo. Idempotente.

CREATE TABLE IF NOT EXISTS `siape_carga_dias` (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reconocimiento_id INT NOT NULL,
  dni VARCHAR(20) NOT NULL,
  fecha DATE NOT NULL,
  estado ENUM('CARGADO','YA_EXISTIA','ERROR') NOT NULL,
  categoria VARCHAR(40) NULL,
  detalle VARCHAR(500) NULL,
  intentos INT NOT NULL DEFAULT 0,
  creado_en DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_siape_carga_dias_dni_fecha (dni, fecha),
  KEY ix_siape_carga_dias_rec (reconocimiento_id),
  KEY ix_siape_carga_dias_estado (estado, categoria),
  CONSTRAINT fk_siape_carga_dias_rec FOREIGN KEY (reconocimiento_id)
    REFERENCES reconocimientos_medicos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

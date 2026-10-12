-- 071__samo_meses_habilitados.sql
-- SAMO → "Licencias Ministerio": meses que un admin habilitó con la clave fija SAMO_CLAVE_HABILITACION (.env).
-- Sin fila para el año/mes, SAMO no ve ese mes. La API también crea la tabla si no existe
-- (src/routes/samoMinisterio.routes.ts). Idempotente.

CREATE TABLE IF NOT EXISTS samo_meses_habilitados (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  anio SMALLINT NOT NULL,
  mes TINYINT NOT NULL,
  habilitado_por INT NULL,
  habilitado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_samo_meses_anio_mes (anio, mes)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

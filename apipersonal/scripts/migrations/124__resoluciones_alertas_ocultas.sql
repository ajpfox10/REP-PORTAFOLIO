-- 124: alertas "resolución sin archivo escaneado" desactivadas a mano (una fila por resolución).
-- La tabla también se crea sola en runtime (resolucionesSinArchivo.routes.ts → ensureTabla).
CREATE TABLE IF NOT EXISTS resoluciones_alertas_ocultas (
  resolucion_id INT NOT NULL,
  ocultado_por  INT NULL,
  ocultado_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resolucion_id),
  CONSTRAINT fk_res_alertas_ocultas_res FOREIGN KEY (resolucion_id) REFERENCES resoluciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

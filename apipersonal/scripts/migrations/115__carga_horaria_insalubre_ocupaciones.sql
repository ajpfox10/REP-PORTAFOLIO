-- 115: ocupaciones que hacen la carga horaria reducida por insalubridad (07/11/2026).
-- Lista propia de Herramientas → Carga horaria por ley. NO toca ocupaciones.es_insalubre
-- (esa marca es de jubilación: insalubre neta de toda la carrera). Para las horas cuenta
-- como insalubre si la ocupación está en esta lista O tiene es_insalubre = 1.
CREATE TABLE IF NOT EXISTS carga_horaria_insalubre_ocupaciones (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  ocupacion_id INT      NOT NULL,
  created_by   INT      NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chio_ocupacion (ocupacion_id),
  CONSTRAINT fk_chio_ocupacion FOREIGN KEY (ocupacion_id) REFERENCES ocupaciones (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

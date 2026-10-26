-- 091: feriados por año (pedido 24/10/2026).
--   · feriados: ya existía (cargada a mano el 15/05/2026, 2024–2026) sin migración ni pantalla. Acá queda
--     la DDL y se suma el tipo 'no_laborable' (días no laborables / asuetos).
--   · feriados_anios: un año está "cargado" recién cuando alguien lo confirma completo en /app/feriados.
--     Si al 4.º día hábil de enero el año no está confirmado, la app se bloquea para los administradores
--     (crud:*:*) y el robot de ausentes de la Intranet no carga ese año.
--   2024–2026 se dan por confirmados (carga inicial).
-- Idempotente.

CREATE TABLE IF NOT EXISTS feriados (
  id INT NOT NULL AUTO_INCREMENT,
  fecha DATE NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo ENUM('nacional','provincial','puente','trasladable','no_laborable') NOT NULL DEFAULT 'nacional',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_feriados_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE feriados
  MODIFY tipo ENUM('nacional','provincial','puente','trasladable','no_laborable') NOT NULL DEFAULT 'nacional';

CREATE TABLE IF NOT EXISTS feriados_anios (
  anio SMALLINT UNSIGNED NOT NULL,
  confirmado_por INT NULL,
  confirmado_por_nombre VARCHAR(150) NULL,
  confirmado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO feriados_anios (anio, confirmado_por, confirmado_por_nombre)
VALUES (2024, NULL, 'Carga inicial'), (2025, NULL, 'Carga inicial'), (2026, NULL, 'Carga inicial');

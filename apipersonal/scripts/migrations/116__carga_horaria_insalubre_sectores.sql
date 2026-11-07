-- 116: sectores insalubres para la carga horaria (07/11/2026). Herramientas → Carga horaria por ley.
-- El agente con sector vigente (agentes_sectores) en esta lista toma las horas "Insalubre" de su ley,
-- igual que si su ocupación fuera insalubre (mig 115).
CREATE TABLE IF NOT EXISTS carga_horaria_insalubre_sectores (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  sector_id  INT      NOT NULL,
  created_by INT      NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chis_sector (sector_id),
  CONSTRAINT fk_chis_sector FOREIGN KEY (sector_id) REFERENCES sectores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

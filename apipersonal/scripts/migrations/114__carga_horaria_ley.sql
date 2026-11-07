-- 114: carga horaria semanal por ley (07/11/2026). Herramientas → Carga horaria por ley.
-- Los certificados (Certificado de Trabajo y Cert. Base Vieja) toman las horas de acá:
--   ocupación insalubre (ocupaciones.es_insalubre = 1) y horas_insalubre cargada → horas_insalubre
--   servicio marcado como agotamiento prematuro y horas_agotamiento cargada  → horas_agotamiento
--   si no, horas_base; si la ley no tiene nada cargado → régimen horario del agente (como antes).
CREATE TABLE IF NOT EXISTS carga_horaria_ley (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  ley_id            INT          NOT NULL,
  horas_base        SMALLINT     NULL,
  horas_insalubre   SMALLINT     NULL,
  horas_agotamiento SMALLINT     NULL,
  observaciones     VARCHAR(500) NULL,
  updated_by        INT          NULL,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chl_ley (ley_id),
  CONSTRAINT fk_chl_ley FOREIGN KEY (ley_id) REFERENCES ley (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Servicios cuyo personal cumple tareas de agotamiento prematuro.
CREATE TABLE IF NOT EXISTS carga_horaria_agotamiento_servicios (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  servicio_id INT      NOT NULL,
  created_by  INT      NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chas_servicio (servicio_id),
  CONSTRAINT fk_chas_servicio FOREIGN KEY (servicio_id) REFERENCES servicios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ley 10430 (ids 1 "10430" y 3 "LEY 10430"): 48 hs; 36 hs por insalubridad / agotamiento prematuro.
INSERT IGNORE INTO carga_horaria_ley (ley_id, horas_base, horas_insalubre, horas_agotamiento, observaciones)
VALUES (1, 48, 36, 36, 'Ley 10430: 36 hs por insalubridad o agotamiento prematuro'),
       (3, 48, 36, 36, 'Ley 10430: 36 hs por insalubridad o agotamiento prematuro');

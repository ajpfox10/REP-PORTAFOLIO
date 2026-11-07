-- 117: control "residentes activos en SIAPE" (07/11/2026).
-- SIAPE a veces da de baja por su cuenta a residentes / ex residentes que siguen activos en la base.
-- Se controla con la exportación HORARIOS.xlsx (consulta 76, diaria) y las fotos mensuales de
-- HORARIOS_HISTORIAL: cada foto procesada guarda, para los DNI controlados, si figuraban en SIAPE.
-- Servicio: src/services/residentesControlSiape.ts (también las crea en runtime si faltan).
CREATE TABLE IF NOT EXISTS residentes_siape_fotos (
  fecha         DATE         NOT NULL,
  archivo       VARCHAR(400) NOT NULL,
  archivo_mtime DATETIME     NULL,
  filas         INT          NOT NULL DEFAULT 0,
  procesado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS residentes_siape_presencia (
  fecha    DATE       NOT NULL,
  dni      INT        NOT NULL,
  en_siape TINYINT(1) NOT NULL,
  PRIMARY KEY (fecha, dni),
  KEY idx_rsp_dni (dni, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

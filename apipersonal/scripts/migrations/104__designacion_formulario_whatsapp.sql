-- 104: envíos por WhatsApp del link del formulario de Designación a los agentes de una tanda
--   de Trámites Documentales (pedido 01/11/2026). Una fila por intento; prueba = 1 no cuenta
--   como enviado. El link y el texto del mensaje viven en app_runtime_config
--   (config_key 'designacion_formulario').
CREATE TABLE IF NOT EXISTS designacion_form_whatsapp (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni         INT NOT NULL,
  tanda       VARCHAR(120) NULL COMMENT 'tanda de tramites_tanda_interinos desde la que se mandó',
  destino     VARCHAR(60) NULL COMMENT 'número o contacto al que fue',
  modo        VARCHAR(20) NULL COMMENT 'TELEFONO / NOMBRE / MANUAL',
  estado      VARCHAR(20) NOT NULL COMMENT 'ENVIADO / NO_ENCONTRADO / SIN_WHATSAPP / ERROR',
  detalle     VARCHAR(255) NULL,
  prueba      TINYINT(1) NOT NULL DEFAULT 0,
  mensaje     TEXT NULL,
  enviado_por INT NULL,
  created_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_desig_wsp_dni (dni),
  KEY idx_desig_wsp_tanda (tanda),
  CONSTRAINT fk_desig_wsp_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_desig_wsp_enviado_por FOREIGN KEY (enviado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

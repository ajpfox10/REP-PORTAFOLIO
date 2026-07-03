-- 023__guarderia.sql
-- Registro de guardería y salario: agentes que deben realizar el trámite
-- de guardería/salario a los 45 días del nacimiento (nombradas, no becarias).

CREATE TABLE IF NOT EXISTS `guarderia` (
  `id`                        INT           NOT NULL AUTO_INCREMENT,
  `dni`                       INT           NOT NULL,
  `fecha_nacimiento`          DATE          NOT NULL,
  `alerta_45_avisada`         TINYINT(1)    NOT NULL DEFAULT 0,
  `alerta_45_fecha`           DATETIME      NULL,
  `alerta_45_usuario_id`      INT           NULL,
  `alerta_45_usuario_nombre`  VARCHAR(255)  NULL,
  `alerta_45_usuario_email`   VARCHAR(255)  NULL,
  `tramite_realizado`         TINYINT(1)    NOT NULL DEFAULT 0,
  `tramite_fecha`             DATETIME      NULL,
  `tramite_usuario_id`        INT           NULL,
  `tramite_usuario_nombre`    VARCHAR(255)  NULL,
  `tramite_usuario_email`     VARCHAR(255)  NULL,
  `observaciones`             TEXT          NULL,
  `created_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`                DATETIME      NULL,
  `created_by`                INT           NULL,
  `updated_by`                INT           NULL,
  `deleted_by`                INT           NULL,
  PRIMARY KEY (`id`),
  KEY `idx_guarderia_dni`         (`dni`),
  KEY `idx_guarderia_nacimiento`  (`fecha_nacimiento`),
  KEY `idx_guarderia_deleted`     (`deleted_at`),
  CONSTRAINT `fk_guarderia_dni` FOREIGN KEY (`dni`)
    REFERENCES `personal` (`dni`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

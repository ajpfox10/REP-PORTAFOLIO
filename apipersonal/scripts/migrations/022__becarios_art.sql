-- 022__becarios_art.sql
-- Registro de agentes becarios dados de alta en ART.
-- Almacena solo dni (clave de cruce con personal/agentes) y pagina ART.
-- Auditoría: creado_por / actualizado_por referencian id de usuarios.

CREATE TABLE IF NOT EXISTS `becarios_art` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `dni`             INT           NOT NULL,
  `pagina`          VARCHAR(50)   NOT NULL,
  `creado_por`      INT           NULL,
  `actualizado_por` INT           NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME      NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_becarios_art_dni` (`dni`),
  KEY `idx_becarios_art_pagina` (`pagina`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

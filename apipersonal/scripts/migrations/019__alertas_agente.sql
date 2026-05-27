-- 019__alertas_agente.sql
-- Sistema de alertas manuales por agente: un usuario crea una alerta sobre un agente
-- y todos los demás la ven como banner al consultar ese agente.
-- El cierre es individual: cada usuario la cierra para sí mismo.

CREATE TABLE IF NOT EXISTS `alertas_agente` (
  `id`          INT           NOT NULL AUTO_INCREMENT,
  `dni`         INT           NOT NULL,
  `titulo`      VARCHAR(255)  NOT NULL,
  `mensaje`     TEXT          NOT NULL,
  `urgente`     TINYINT(1)    NOT NULL DEFAULT 0,
  `activa`      TINYINT(1)    NOT NULL DEFAULT 1,
  `creado_por`  INT           NULL,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME      NULL,
  PRIMARY KEY (`id`),
  KEY `idx_alertas_agente_dni` (`dni`),
  KEY `idx_alertas_agente_activa` (`activa`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `alertas_agente_usuarios` (
  `id`          INT       NOT NULL AUTO_INCREMENT,
  `alerta_id`   INT       NOT NULL,
  `usuario_id`  INT       NOT NULL,
  `visto_at`    DATETIME  NULL,
  `cerrado_at`  DATETIME  NULL,
  `created_at`  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_alerta_usuario` (`alerta_id`, `usuario_id`),
  KEY `idx_aau_usuario` (`usuario_id`),
  CONSTRAINT `fk_aau_alerta` FOREIGN KEY (`alerta_id`) REFERENCES `alertas_agente` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 029__sin_salida_ausentes.sql
-- Registro de agentes marcados "AUSENTE" por NO fichar la salida.
--
-- Origen de los datos: módulo "Sin fichaje de salida" (POST /api/v1/sin-salida),
-- que cruza el biométrico (adms_db.checkinout) con los horarios (Excel) y SIAP.
-- Cuando un operador resuelve un caso SIN_SALIDA como ausente, se persiste aquí:
--   - QUIÉN lo cargó      → cargado_por (usuarios.id)
--   - QUÉ agente          → dni / nombre
--   - CONTEXTO del turno  → fecha, día, horario que le correspondía (entrada/salida),
--                            entrada real fichada, servicio / UPA / ocupación.
--
-- cargado_por queda como INT indexado SIN FK dura a usuarios (misma convención que
-- alertas_agente.creado_por y app_runtime_config.updated_by): usuarios admite borrado
-- lógico y el principal "dev" puede no existir en la tabla.

CREATE TABLE IF NOT EXISTS `sin_salida_ausentes` (
  `id`                      INT           NOT NULL AUTO_INCREMENT,
  `dni`                     VARCHAR(20)   NOT NULL,                    -- agente que NO fichó salida
  `nombre`                  VARCHAR(255)  NULL,
  `fecha`                   DATE          NOT NULL,                    -- día del turno sin salida
  `dia_semana`              VARCHAR(10)   NULL,
  `hora_entrada_programada` VARCHAR(5)    NULL,                        -- le correspondía entrar
  `hora_salida_programada`  VARCHAR(5)    NULL,                        -- le correspondía salir
  `entrada_real`            VARCHAR(5)    NULL,                        -- hora que sí fichó
  `upa`                     VARCHAR(100)  NULL,
  `servicio`                VARCHAR(255)  NULL,
  `ocupacion`               VARCHAR(255)  NULL,
  `es_guardia`              TINYINT(1)    NOT NULL DEFAULT 0,
  `estado_origen`           VARCHAR(30)   NULL,                        -- estado detectado (SIN_SALIDA…)
  `resolucion`              VARCHAR(20)   NOT NULL DEFAULT 'AUSENTE',
  `observacion`             TEXT          NULL,
  `cargado_por`             INT           NULL,                        -- usuarios.id (QUIÉN cargó)
  `created_at`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`              DATETIME      NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ausente_dni_fecha` (`dni`, `fecha`),
  KEY `idx_ausente_fecha` (`fecha`),
  KEY `idx_ausente_cargado_por` (`cargado_por`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

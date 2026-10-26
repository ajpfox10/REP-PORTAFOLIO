-- 093: mensajes al reloj desde Gestión (pedido 26/10/2026).
--   mensajes_reloj = la cola: un mensaje personal para un agente, con apellido y nombre tal como estaban al
--   mandarlo, el texto (máx. 80, sin acentos porque el ADMS viejo los rompe) y cuántos minutos queda vigente.
--   sms_uid es el número de mensaje que va al reloj (1..65535: en los firmwares TFT el id de SMS es de 16 bits).
--   mensajes_reloj_envios = una fila por reloj al que se encoló, con los ids de los dos comandos en
--   adms_db.devcmds (DATA UPDATE SMS + DATA UPDATE USER_SMS); el resultado se lee de devcmds.CmdReturn.
CREATE TABLE IF NOT EXISTS mensajes_reloj (
  id            INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni           INT NOT NULL,
  apellido      VARCHAR(100) NOT NULL,
  nombre        VARCHAR(100) NOT NULL,
  mensaje       VARCHAR(80) NOT NULL,
  vigencia_min  SMALLINT UNSIGNED NOT NULL DEFAULT 1440,
  sms_uid       SMALLINT UNSIGNED NULL,
  estado        ENUM('pendiente','encolado','simulado','error') NOT NULL DEFAULT 'pendiente'
                COMMENT 'simulado = instancia con FICHERO_SUBIDA_DESHABILITADA, no se mandó a los relojes',
  error         VARCHAR(255) NULL,
  created_at    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    INT NULL,
  KEY idx_msj_reloj_dni (dni),
  KEY idx_msj_reloj_creado (created_at),
  CONSTRAINT fk_msj_reloj_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_msj_reloj_created_by FOREIGN KEY (created_by) REFERENCES usuarios(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mensajes_reloj_envios (
  id               INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mensaje_id       INT NOT NULL,
  sn               VARCHAR(20) NOT NULL COMMENT 'adms_db.iclock.SN',
  reloj            VARCHAR(60) NULL COMMENT 'alias del reloj al momento del envío',
  devcmd_sms_id    INT NULL COMMENT 'adms_db.devcmds.id de DATA UPDATE SMS',
  devcmd_user_id   INT NULL COMMENT 'adms_db.devcmds.id de DATA UPDATE USER_SMS',
  created_at       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_msj_env_mensaje (mensaje_id),
  CONSTRAINT fk_msj_env_mensaje FOREIGN KEY (mensaje_id) REFERENCES mensajes_reloj(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

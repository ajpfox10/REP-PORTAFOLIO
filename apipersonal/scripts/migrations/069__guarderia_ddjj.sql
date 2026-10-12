-- 069__guarderia_ddjj.sql
-- DDJJ para Reintegro de Guardería y/o Jardín Maternal (modal de la página Guardería y Salario).
-- 1 DDJJ por DNI (snapshot de lo impreso) + sus menores. Ambas atadas a personal(dni).
-- La API las crea sola al levantar (ensureTablas en src/routes/guarderiaDdjj.routes.ts);
-- este archivo es el espejo. Idempotente (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS `guarderia_ddjj` (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni INT NOT NULL,
  reparticion VARCHAR(200) NULL,
  apellido_nombre VARCHAR(200) NULL,
  documento VARCHAR(20) NULL,
  fecha_nacimiento DATE NULL,
  estado_civil VARCHAR(40) NULL,
  nacionalidad VARCHAR(80) NULL,
  cargo VARCHAR(150) NULL,
  horario VARCHAR(100) NULL,
  legajo VARCHAR(30) NULL,
  domicilio VARCHAR(250) NULL,
  fecha_reintegro DATE NULL,
  ninos_a_cargo VARCHAR(150) NULL,
  condicion_tutela VARCHAR(250) NULL,
  motivo_no_ingresa VARCHAR(300) NULL,
  otro_apellido_nombre VARCHAR(200) NULL,
  otro_domicilio VARCHAR(250) NULL,
  otro_documento VARCHAR(20) NULL,
  otro_fecha_nacimiento DATE NULL,
  otro_estado_civil VARCHAR(40) NULL,
  otro_nacionalidad VARCHAR(80) NULL,
  otro_lugar_trabajo VARCHAR(200) NULL,
  firma_aclaracion VARCHAR(150) NULL,
  lugar VARCHAR(100) NULL,
  fecha DATE NULL,
  certifica_pertenece VARCHAR(150) NULL,
  certifica_aclaracion VARCHAR(150) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT NULL, updated_by INT NULL,
  UNIQUE KEY ux_guarderia_ddjj_dni (dni),
  CONSTRAINT fk_guarderia_ddjj_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `guarderia_ddjj_menores` (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ddjj_id INT NOT NULL,
  dni INT NOT NULL,
  orden TINYINT NOT NULL DEFAULT 1,
  apellido_nombre VARCHAR(200) NULL,
  documento VARCHAR(20) NULL,
  fecha_nacimiento DATE NULL,
  patologia TINYINT(1) NULL,
  atencion_temporaria VARCHAR(150) NULL,
  atencion_permanente VARCHAR(150) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_guarderia_ddjj_menores_ddjj (ddjj_id),
  KEY ix_guarderia_ddjj_menores_dni (dni),
  CONSTRAINT fk_guarderia_ddjj_menores_ddjj FOREIGN KEY (ddjj_id) REFERENCES guarderia_ddjj(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_guarderia_ddjj_menores_dni FOREIGN KEY (dni) REFERENCES personal(dni)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

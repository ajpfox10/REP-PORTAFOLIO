-- Clinical + Agenda MVP tables

CREATE TABLE IF NOT EXISTS pacientes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(128) NOT NULL,
  apellido VARCHAR(128) NOT NULL,
  email VARCHAR(256) NULL,
  telefono VARCHAR(64) NULL,
  direccion VARCHAR(256) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  INDEX idx_pac_ap (apellido, nombre)
);

CREATE TABLE IF NOT EXISTS mascotas (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  paciente_id BIGINT NOT NULL,
  nombre VARCHAR(128) NOT NULL,
  especie VARCHAR(64) NOT NULL,
  raza VARCHAR(64) NULL,
  sexo CHAR(1) NULL,
  nacimiento DATE NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  INDEX idx_masc_pac (paciente_id),
  CONSTRAINT fk_masc_pac FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS consultas (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  mascota_id BIGINT NOT NULL,
  fecha_hora DATETIME NOT NULL,
  motivo VARCHAR(256) NOT NULL,
  notas_enc JSON NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  INDEX idx_cons_masc (mascota_id),
  INDEX idx_cons_fecha (fecha_hora),
  CONSTRAINT fk_cons_masc FOREIGN KEY (mascota_id) REFERENCES mascotas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vacunas (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  paciente_id BIGINT NOT NULL,
  nombre VARCHAR(128) NOT NULL,
  proxima_dosis DATE NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  INDEX idx_vac_pac (paciente_id),
  CONSTRAINT fk_vac_pac FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agenda_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  resource_type VARCHAR(16) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  day_of_week TINYINT NOT NULL,
  start_time CHAR(5) NOT NULL,
  end_time CHAR(5) NOT NULL,
  slot_minutes INT NOT NULL DEFAULT 30,
  active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  INDEX idx_rule_res (resource_type, resource_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS holidays (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  date DATE NOT NULL,
  name VARCHAR(128) NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'custom',
  closed TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  UNIQUE KEY uq_holiday_date (date)
);

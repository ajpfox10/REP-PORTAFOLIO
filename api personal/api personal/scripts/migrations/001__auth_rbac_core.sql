-- 001__auth_rbac_core.sql
-- Core Auth/RBAC tables + audit + security guard rails (MySQL/InnoDB)
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).

/* =========================
   usuarios
   ========================= */
CREATE TABLE IF NOT EXISTS usuarios (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  nombre VARCHAR(190) NULL,
  password VARCHAR(255) NOT NULL,
  estado ENUM('activo','inactivo','bloqueado') NOT NULL DEFAULT 'activo',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email),
  KEY ix_usuarios_deleted_at (deleted_at)
) ENGINE=InnoDB;

/* =========================
   roles
   ========================= */
CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_nombre (nombre),
  KEY ix_roles_deleted_at (deleted_at)
) ENGINE=InnoDB;

/* =========================
   permisos
   ========================= */
CREATE TABLE IF NOT EXISTS permisos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  clave VARCHAR(190) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permisos_clave (clave),
  KEY ix_permisos_deleted_at (deleted_at)
) ENGINE=InnoDB;

/* =========================
   usuarios_roles (soft delete)
   ========================= */
CREATE TABLE IF NOT EXISTS usuarios_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NOT NULL,
  rol_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_roles (usuario_id, rol_id),
  KEY ix_usuarios_roles_usuario (usuario_id),
  KEY ix_usuarios_roles_rol (rol_id),
  KEY ix_usuarios_roles_deleted_at (deleted_at),
  CONSTRAINT fk_usuarios_roles_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_usuarios_roles_rol
    FOREIGN KEY (rol_id) REFERENCES roles(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

/* =========================
   roles_permisos (soft delete)
   ========================= */
CREATE TABLE IF NOT EXISTS roles_permisos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rol_id BIGINT UNSIGNED NOT NULL,
  permiso_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_permisos (rol_id, permiso_id),
  KEY ix_roles_permisos_rol (rol_id),
  KEY ix_roles_permisos_permiso (permiso_id),
  KEY ix_roles_permisos_deleted_at (deleted_at),
  CONSTRAINT fk_roles_permisos_rol
    FOREIGN KEY (rol_id) REFERENCES roles(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_roles_permisos_permiso
    FOREIGN KEY (permiso_id) REFERENCES permisos(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

/* =========================
   refresh_tokens
   ========================= */
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by BIGINT UNSIGNED NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY ix_refresh_tokens_usuario (usuario_id),
  KEY ix_refresh_tokens_expires (expires_at),
  CONSTRAINT fk_refresh_tokens_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

/* =========================
   auth_login_guard (rate limit de login por IP+identifier)
   ========================= */
CREATE TABLE IF NOT EXISTS auth_login_guard (
  ip VARCHAR(64) NOT NULL,
  identifier VARCHAR(190) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_attempt_at DATETIME NOT NULL,
  PRIMARY KEY (ip, identifier),
  KEY ix_auth_login_guard_locked (locked_until),
  KEY ix_auth_login_guard_last (last_attempt_at)
) ENGINE=InnoDB;

/* =========================
   security_bans (ban temporal)
   ========================= */
CREATE TABLE IF NOT EXISTS security_bans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip VARCHAR(64) NULL,
  usuario_email VARCHAR(190) NULL,
  reason VARCHAR(255) NULL,
  banned_until DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_security_bans_until (banned_until),
  KEY ix_security_bans_ip (ip),
  KEY ix_security_bans_email (usuario_email)
) ENGINE=InnoDB;

/* =========================
   audit_log (auditoría)
   ========================= */
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(80) NULL,
  actor_type VARCHAR(24) NULL,
  actor_id VARCHAR(64) NULL,
  ip VARCHAR(80) NULL,
  method VARCHAR(12) NULL,
  route VARCHAR(255) NULL,
  status_code INT NULL,
  duration_ms INT NULL,
  action VARCHAR(32) NULL,
  entity_table VARCHAR(190) NULL,
  entity_pk VARCHAR(64) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  request_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_log_created (created_at),
  KEY ix_audit_log_reqid (request_id),
  KEY ix_audit_log_actor (actor_type, actor_id),
  KEY ix_audit_log_entity (entity_table, entity_pk)
) ENGINE=InnoDB;

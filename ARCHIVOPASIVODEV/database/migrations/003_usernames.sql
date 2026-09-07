USE `archivo_pasivo`;

-- Agrega nombre de usuario para permitir login por usuario o email.
SET @username_col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'usuarios'
    AND COLUMN_NAME = 'username'
);

SET @add_username_sql = IF(
  @username_col_exists = 0,
  'ALTER TABLE usuarios ADD COLUMN username VARCHAR(80) NULL AFTER id',
  'SELECT 1'
);

PREPARE add_username_stmt FROM @add_username_sql;
EXECUTE add_username_stmt;
DEALLOCATE PREPARE add_username_stmt;

-- Crea indice unico para username cuando todavia no existe.
SET @username_idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'usuarios'
    AND INDEX_NAME = 'uq_usuarios_username'
);

SET @add_username_idx_sql = IF(
  @username_idx_exists = 0,
  'CREATE UNIQUE INDEX uq_usuarios_username ON usuarios (username)',
  'SELECT 1'
);

PREPARE add_username_idx_stmt FROM @add_username_idx_sql;
EXECUTE add_username_idx_stmt;
DEALLOCATE PREPARE add_username_idx_stmt;

const bcrypt = require('bcryptjs');
const { pool, query } = require('./db');
const config = require('./config');

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','operador','lector') NOT NULL DEFAULT 'operador',
      activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS stock_importaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      archivo_nombre VARCHAR(255) NOT NULL,
      hospital VARCHAR(255) NULL,
      sector VARCHAR(255) NULL,
      source_path VARCHAR(500) NULL,
      fecha_emision DATE NULL,
      total_items INT NOT NULL DEFAULT 0,
      items_con_guion INT NOT NULL DEFAULT 0,
      estado ENUM('importada','cerrada') NOT NULL DEFAULT 'importada',
      creado_por INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_stock_importaciones_created_at (created_at),
      CONSTRAINT fk_stock_importaciones_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const stockImportColumns = await query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_importaciones'
      AND COLUMN_NAME = 'source_path'
  `);
  if (!stockImportColumns.length) {
    await query('ALTER TABLE stock_importaciones ADD COLUMN source_path VARCHAR(500) NULL AFTER sector');
  }

  await query(`
    CREATE TABLE IF NOT EXISTS stock_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      importacion_id INT NOT NULL,
      fila_reporte INT NOT NULL,
      codigo_articulo VARCHAR(40) NOT NULL,
      descripcion TEXT NOT NULL,
      stock_minimo_actual INT NULL,
      stock_maximo_actual INT NULL,
      stock_actual INT NULL,
      minimo_con_guion TINYINT(1) NOT NULL DEFAULT 0,
      maximo_con_guion TINYINT(1) NOT NULL DEFAULT 0,
      requiere_carga TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_stock_item_import_codigo (importacion_id, codigo_articulo),
      INDEX idx_stock_items_codigo (codigo_articulo),
      INDEX idx_stock_items_requiere (requiere_carga),
      CONSTRAINT fk_stock_items_importacion FOREIGN KEY (importacion_id) REFERENCES stock_importaciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS stock_valores_carga (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NOT NULL UNIQUE,
      codigo_articulo VARCHAR(40) NOT NULL,
      stock_minimo_nuevo INT NULL,
      stock_maximo_nuevo INT NULL,
      estado ENUM('pendiente','listo','en_proceso','cargado','error') NOT NULL DEFAULT 'pendiente',
      tipo_operacion ENUM('carga_inicial','actualizacion') NOT NULL DEFAULT 'carga_inicial',
      mensaje_error TEXT NULL,
      actualizado_por INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_stock_valores_estado (estado),
      INDEX idx_stock_valores_codigo (codigo_articulo),
      CONSTRAINT fk_stock_valores_item FOREIGN KEY (item_id) REFERENCES stock_items(id) ON DELETE CASCADE,
      CONSTRAINT fk_stock_valores_usuario FOREIGN KEY (actualizado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const valorColumns = await query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_valores_carga'
      AND COLUMN_NAME = 'tipo_operacion'
  `);
  if (!valorColumns.length) {
    await query(`
      ALTER TABLE stock_valores_carga
      ADD COLUMN tipo_operacion ENUM('carga_inicial','actualizacion') NOT NULL DEFAULT 'carga_inicial'
      AFTER estado
    `);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS consumo_importaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      archivo_nombre VARCHAR(255) NOT NULL,
      hospital VARCHAR(255) NULL,
      sector VARCHAR(255) NULL,
      source_path VARCHAR(500) NULL,
      anio INT NULL,
      periodo VARCHAR(40) NOT NULL DEFAULT 'auto',
      total_items INT NOT NULL DEFAULT 0,
      meses_usados JSON NULL,
      creado_por INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_consumo_importaciones_created_at (created_at),
      CONSTRAINT fk_consumo_importaciones_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const consumoColumns = await query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'consumo_importaciones'
      AND COLUMN_NAME IN ('source_path', 'anio', 'periodo')
  `);
  const existingConsumoColumns = new Set(consumoColumns.map((row) => row.COLUMN_NAME));
  if (!existingConsumoColumns.has('source_path')) {
    await query('ALTER TABLE consumo_importaciones ADD COLUMN source_path VARCHAR(500) NULL AFTER sector');
  }
  if (!existingConsumoColumns.has('anio')) {
    await query('ALTER TABLE consumo_importaciones ADD COLUMN anio INT NULL AFTER source_path');
  }
  if (!existingConsumoColumns.has('periodo')) {
    await query("ALTER TABLE consumo_importaciones ADD COLUMN periodo VARCHAR(40) NOT NULL DEFAULT 'auto' AFTER anio");
  }

  await query(`
    CREATE TABLE IF NOT EXISTS consumo_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      consumo_importacion_id INT NOT NULL,
      codigo_articulo VARCHAR(40) NOT NULL,
      nombre_generico TEXT NULL,
      concentracion VARCHAR(255) NULL,
      presentacion VARCHAR(255) NULL,
      forma VARCHAR(255) NULL,
      sector VARCHAR(255) NULL,
      enero DECIMAL(12,2) NOT NULL DEFAULT 0,
      febrero DECIMAL(12,2) NOT NULL DEFAULT 0,
      marzo DECIMAL(12,2) NOT NULL DEFAULT 0,
      abril DECIMAL(12,2) NOT NULL DEFAULT 0,
      mayo DECIMAL(12,2) NOT NULL DEFAULT 0,
      junio DECIMAL(12,2) NOT NULL DEFAULT 0,
      julio DECIMAL(12,2) NOT NULL DEFAULT 0,
      agosto DECIMAL(12,2) NOT NULL DEFAULT 0,
      septiembre DECIMAL(12,2) NOT NULL DEFAULT 0,
      octubre DECIMAL(12,2) NOT NULL DEFAULT 0,
      noviembre DECIMAL(12,2) NOT NULL DEFAULT 0,
      diciembre DECIMAL(12,2) NOT NULL DEFAULT 0,
      suma_6 DECIMAL(12,2) NOT NULL DEFAULT 0,
      promedio_6 DECIMAL(12,2) NOT NULL DEFAULT 0,
      minimo_sugerido INT NOT NULL DEFAULT 0,
      maximo_sugerido INT NOT NULL DEFAULT 0,
      meses_minimos JSON NULL,
      meses_maximos JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_consumo_item_import_codigo (consumo_importacion_id, codigo_articulo),
      INDEX idx_consumo_items_codigo (codigo_articulo),
      CONSTRAINT fk_consumo_items_importacion FOREIGN KEY (consumo_importacion_id) REFERENCES consumo_importaciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS stock_auditoria (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NULL,
      accion VARCHAR(80) NOT NULL,
      entidad VARCHAR(80) NOT NULL,
      entidad_id VARCHAR(80) NULL,
      detalle JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_stock_auditoria_accion (accion),
      INDEX idx_stock_auditoria_created_at (created_at),
      CONSTRAINT fk_stock_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS stock_script_runs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      importacion_id INT NULL,
      estado ENUM('iniciado','finalizado','error') NOT NULL DEFAULT 'iniciado',
      procesados INT NOT NULL DEFAULT 0,
      cargados INT NOT NULL DEFAULT 0,
      errores INT NOT NULL DEFAULT 0,
      mensaje TEXT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL,
      INDEX idx_stock_script_runs_importacion (importacion_id),
      CONSTRAINT fk_stock_script_runs_importacion FOREIGN KEY (importacion_id) REFERENCES stock_importaciones(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const runColumns = await query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_script_runs'
      AND COLUMN_NAME = 'importacion_id'
  `);
  if (!runColumns.length) {
    await query(`
      ALTER TABLE stock_script_runs
      ADD COLUMN importacion_id INT NULL AFTER id,
      ADD INDEX idx_stock_script_runs_importacion (importacion_id),
      ADD CONSTRAINT fk_stock_script_runs_importacion
        FOREIGN KEY (importacion_id) REFERENCES stock_importaciones(id) ON DELETE SET NULL
    `);
  }

  const stockHashColumn = await query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_importaciones'
      AND COLUMN_NAME = 'archivo_hash'
  `);
  if (!stockHashColumn.length) {
    await query('ALTER TABLE stock_importaciones ADD COLUMN archivo_hash CHAR(64) NULL AFTER archivo_nombre, ADD INDEX idx_stock_importaciones_hash (archivo_hash)');
  }

  await query(`
    CREATE TABLE IF NOT EXISTS trimestre_importaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      archivo_nombre VARCHAR(255) NOT NULL,
      archivo_hash CHAR(64) NOT NULL,
      hospital VARCHAR(255) NULL,
      sector VARCHAR(255) NULL,
      source_path VARCHAR(500) NULL,
      periodo_desde DATE NULL,
      periodo_hasta DATE NULL,
      anio INT NULL,
      trimestre TINYINT NULL,
      total_items INT NOT NULL DEFAULT 0,
      creado_por INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_trimestre_hash (archivo_hash),
      UNIQUE KEY uq_trimestre_periodo (sector, anio, trimestre),
      INDEX idx_trimestre_anio (anio, trimestre),
      CONSTRAINT fk_trimestre_importaciones_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trimestre_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trimestre_importacion_id INT NOT NULL,
      codigo_articulo VARCHAR(40) NOT NULL,
      nombre_generico TEXT NULL,
      concentracion VARCHAR(255) NULL,
      forma VARCHAR(255) NULL,
      presentacion VARCHAR(255) NULL,
      cantidad DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_trimestre_item (trimestre_importacion_id, codigo_articulo),
      INDEX idx_trimestre_items_codigo (codigo_articulo),
      CONSTRAINT fk_trimestre_items_importacion FOREIGN KEY (trimestre_importacion_id) REFERENCES trimestre_importaciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS stock_sugeridos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo_articulo VARCHAR(40) NOT NULL UNIQUE,
      nombre_generico TEXT NULL,
      forma VARCHAR(255) NULL,
      concentracion VARCHAR(255) NULL,
      presentacion VARCHAR(255) NULL,
      ultimo_periodo VARCHAR(40) NULL,
      consumo_ultimo DECIMAL(12,2) NULL,
      stock_minimo INT NULL,
      stock_maximo INT NULL,
      detalle_calculo JSON NULL,
      editado_manual TINYINT(1) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_stock_sugeridos_codigo (codigo_articulo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const hash = await bcrypt.hash(config.adminPassword, 12);
  await query(
    `INSERT INTO usuarios (username, password_hash, role, activo)
     VALUES (:username, :hash, 'admin', 1)
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       role = 'admin',
       activo = 1`,
    { username: config.adminUsername, hash }
  );

  console.log(`Migracion OK en ${config.db.database}`);
}

migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

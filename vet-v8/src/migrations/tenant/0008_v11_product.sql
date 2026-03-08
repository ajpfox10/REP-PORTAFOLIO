-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0008 — VetPro v11
-- Tablas nuevas:  stock_lotes, agenda_reglas
-- Alteraciones:   productos (stock_actual, stock_minimo, precio_compra_cents, proveedor)
--                 vacunas (recordatorio_env)
--                 turnos  (recordatorio_env ya existe — no se toca)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── stock_lotes — gestión de lotes con vencimiento (FEFO) ─────────────────────
CREATE TABLE IF NOT EXISTS stock_lotes (
  id                   BIGINT         NOT NULL AUTO_INCREMENT,
  tenant_id            VARCHAR(64)    NOT NULL,
  producto_id          BIGINT         NOT NULL,
  numero_lote          VARCHAR(64)    NOT NULL,
  fecha_vencimiento    DATE           NULL,
  cantidad_inicial     INT            NOT NULL DEFAULT 0,
  cantidad_actual      INT            NOT NULL DEFAULT 0,
  proveedor            VARCHAR(128)   NULL,
  precio_compra_cents  INT            NULL     COMMENT 'Precio unitario de compra en centavos',
  fecha_ingreso        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant          (tenant_id),
  INDEX idx_producto        (producto_id),
  INDEX idx_vencimiento     (fecha_vencimiento),
  INDEX idx_tenant_producto (tenant_id, producto_id),

  CONSTRAINT fk_lote_producto FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Lotes de stock con fecha de vencimiento. Descuento por FEFO.';


-- ── agenda_reglas — horarios de atención por veterinario ─────────────────────
CREATE TABLE IF NOT EXISTS agenda_reglas (
  id               BIGINT      NOT NULL AUTO_INCREMENT,
  tenant_id        VARCHAR(64) NOT NULL,
  veterinario_id   BIGINT      NOT NULL,
  sucursal_id      BIGINT      NULL,
  dia_semana       TINYINT     NOT NULL COMMENT '0=domingo,1=lunes,...,6=sábado',
  hora_inicio      TIME        NOT NULL DEFAULT '09:00:00',
  hora_fin         TIME        NOT NULL DEFAULT '18:00:00',
  duracion_slot_min INT        NOT NULL DEFAULT 30,
  activo           TINYINT(1)  NOT NULL DEFAULT 1,
  created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant     (tenant_id),
  INDEX idx_vet        (veterinario_id),
  INDEX idx_dia        (dia_semana),
  UNIQUE KEY uq_vet_dia_sucursal (veterinario_id, dia_semana, sucursal_id),

  CONSTRAINT fk_regla_vet      FOREIGN KEY (veterinario_id) REFERENCES veterinarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_regla_sucursal FOREIGN KEY (sucursal_id)    REFERENCES sucursales   (id) ON DELETE SET NULL,
  CONSTRAINT chk_horas CHECK (hora_fin > hora_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Reglas de disponibilidad horaria por veterinario y día de semana.';


-- ── Agregar columnas faltantes a productos ────────────────────────────────────

-- stock_actual: alias limpio para el campo stock existente
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS stock_actual      INT          NOT NULL DEFAULT 0    COMMENT 'Stock actual (sincronizado con movimientos)',
  ADD COLUMN IF NOT EXISTS precio_compra_cents INT         NULL                  COMMENT 'Precio de compra en centavos (para orden de compra)',
  ADD COLUMN IF NOT EXISTS proveedor         VARCHAR(128) NULL                  COMMENT 'Proveedor principal';

-- Si stock ya tiene datos, copiarlos a stock_actual
UPDATE productos SET stock_actual = stock WHERE stock_actual = 0 AND stock > 0;


-- ── Agregar recordatorio_env a vacunas si no existe ───────────────────────────
ALTER TABLE vacunas
  ADD COLUMN IF NOT EXISTS recordatorio_env TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = recordatorio de proxima_dosis ya enviado';

ALTER TABLE desparasitaciones
  ADD COLUMN IF NOT EXISTS recordatorio_env TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = recordatorio ya enviado';


-- ── Índices de performance para los nuevos routers ───────────────────────────

-- pacientes: búsqueda por propietario frecuente
CREATE INDEX IF NOT EXISTS idx_pac_propietario_tenant
  ON pacientes (propietario_id, tenant_id, is_active);

-- turnos: recordatorios pendientes
CREATE INDEX IF NOT EXISTS idx_tur_recordatorio
  ON turnos (recordatorio_env, fecha_hora, tenant_id);

-- vacunas: alertas de vencimiento
CREATE INDEX IF NOT EXISTS idx_vac_proxima_dosis
  ON vacunas (proxima_dosis, recordatorio_env, tenant_id);

-- consultas: dashboard KPIs por fecha
CREATE INDEX IF NOT EXISTS idx_con_fecha_tenant
  ON consultas (tenant_id, fecha, is_active);

-- facturas: revenue por período
CREATE INDEX IF NOT EXISTS idx_fac_emitida_tenant
  ON facturas (tenant_id, emitida_at, estado);


-- ── Datos semilla para agenda_reglas (solo si la tabla está vacía) ────────────
-- Los tenants pueden customizar esto desde el panel de administración

-- Comentado: cada tenant debe configurar sus propias reglas de agenda
-- INSERT INTO agenda_reglas (tenant_id, veterinario_id, dia_semana, hora_inicio, hora_fin) ...

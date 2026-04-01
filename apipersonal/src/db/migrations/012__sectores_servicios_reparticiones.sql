-- ============================================================
-- 012: Estructura completa de jerarquía organizacional
-- Dependencias → Reparticiones → Servicios → Sectores
-- ============================================================

-- ── 1. DEPENDENCIAS (Ministerios, Secretarías, etc.) ─────────
-- Corregir tipo de nombre (era int, debe ser varchar)
ALTER TABLE dependencias
  MODIFY COLUMN nombre VARCHAR(200) NOT NULL,
  ADD COLUMN created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER nombre,
  ADD COLUMN updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD COLUMN deleted_at  DATETIME     NULL DEFAULT NULL AFTER updated_at,
  ADD COLUMN created_by  INT          NULL DEFAULT NULL AFTER deleted_at,
  ADD COLUMN updated_by  INT          NULL DEFAULT NULL AFTER created_by;

-- ── 2. REPARTICIONES (Hospitales, UPAs, etc.) ────────────────
-- Agregar created_at / updated_at (ya tiene deleted_at, created_by, updated_by)
-- Agregar FK a dependencias
ALTER TABLE reparticiones
  MODIFY COLUMN reparticion_nombre VARCHAR(200) NOT NULL,
  ADD COLUMN dependencia_id INT NULL DEFAULT NULL AFTER reparticion_nombre,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER dependencia_id,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE reparticiones
  ADD CONSTRAINT fk_reparticiones_dependencia
    FOREIGN KEY (dependencia_id) REFERENCES dependencias(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- ── 3. SERVICIOS (Clínica, Guardia, Farmacia, etc.) ──────────
-- Agregar reparticion_id + auditoría completa
ALTER TABLE servicios
  MODIFY COLUMN nombre VARCHAR(200) NOT NULL,
  ADD COLUMN reparticion_id INT          NULL DEFAULT NULL AFTER nombre,
  ADD COLUMN created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER reparticion_id,
  ADD COLUMN updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD COLUMN deleted_at     DATETIME     NULL DEFAULT NULL AFTER updated_at,
  ADD COLUMN created_by     INT          NULL DEFAULT NULL AFTER deleted_at,
  ADD COLUMN updated_by     INT          NULL DEFAULT NULL AFTER created_by;

ALTER TABLE servicios
  ADD CONSTRAINT fk_servicios_reparticion
    FOREIGN KEY (reparticion_id) REFERENCES reparticiones(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- ── 4. SECTORES (nueva tabla) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS sectores (
  id            INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(200)  NOT NULL,
  servicio_id   INT           NULL DEFAULT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME      NULL DEFAULT NULL,
  created_by    INT           NULL DEFAULT NULL,
  updated_by    INT           NULL DEFAULT NULL,
  CONSTRAINT fk_sectores_servicio
    FOREIGN KEY (servicio_id) REFERENCES servicios(id)
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- ── 5. AGENTES: ajustar FKs de jerarquía ─────────────────────
-- Renombrar servicios_id → servicio_id
ALTER TABLE agentes
  CHANGE COLUMN servicios_id servicio_id INT NULL DEFAULT NULL;

-- Agregar reparticion_id (sector_id ahora apuntará a sectores)
ALTER TABLE agentes
  ADD COLUMN reparticion_id INT NULL DEFAULT NULL AFTER dependencia_id;

ALTER TABLE agentes
  ADD CONSTRAINT fk_agentes_reparticion
    FOREIGN KEY (reparticion_id) REFERENCES reparticiones(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_agentes_servicio
    FOREIGN KEY (servicio_id) REFERENCES servicios(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_agentes_sector
    FOREIGN KEY (sector_id) REFERENCES sectores(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- Limpiar el sector_id=1 que apuntaba mal a reparticiones
UPDATE agentes SET sector_id = NULL WHERE sector_id = 1;

-- ── 6. AGENTES_SERVICIOS: agregar FK real a servicios ─────────
ALTER TABLE agentes_servicios
  ADD CONSTRAINT fk_agentes_servicios_servicio
    FOREIGN KEY (servicio_id) REFERENCES servicios(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

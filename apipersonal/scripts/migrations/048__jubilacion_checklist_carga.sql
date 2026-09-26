-- 048__jubilacion_checklist_carga.sql
--
-- Checklist de carga del trámite jubilatorio (Documentación → IFGRA → SIAPE →
-- Intranet → Resolución → Expediente IPS) y acuses de la alerta de carga.
--
-- Las dos tablas también se crean solas en runtime desde jubilacion.routes.ts
-- (ensureChecklistTables). Esta es la DDL canónica, para tenerla versionada.

CREATE TABLE IF NOT EXISTS posibles_jubilados_checklist (
  id                  bigint unsigned NOT NULL AUTO_INCREMENT,
  posible_jubilado_id bigint unsigned NOT NULL,
  item                enum('DOCUMENTACION','IFGRA','SIAPE','INTRANET','RESOLUCION','EXPEDIENTE_IPS') NOT NULL,
  tildado_por         bigint unsigned NULL,
  tildado_por_nombre  varchar(190)    NULL,
  created_at          timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pj_checklist (posible_jubilado_id, item),
  INDEX idx_pj_checklist_pj (posible_jubilado_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un OK por usuario y período. Sin UNIQUE: se guardan todos los acuses, y el
-- período ('<año de baja>-<MES_CORTE>', ej. '2026-JUNIO') evita que el OK de un
-- trimestre tape la alerta del siguiente.
CREATE TABLE IF NOT EXISTS posibles_jubilados_alerta_ok (
  id                  bigint unsigned NOT NULL AUTO_INCREMENT,
  posible_jubilado_id bigint unsigned NOT NULL,
  periodo             varchar(24)     NOT NULL,
  usuario_id          bigint unsigned NULL,
  usuario_nombre      varchar(190)    NULL,
  created_at          timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pj_ok_pj      (posible_jubilado_id, periodo),
  INDEX idx_pj_ok_usuario (usuario_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 070__ministerio_novedades_anual.sql
-- Anual de "Novedades registradas" del Ministerio (Intranet MS, HOSPITAL + UPA 4 + UPA 18).
-- La llena el robot `intranet_descarga_anual` (scripts/descargar_anual_ministerio.py), cada 30 dias:
-- baja del 01/01 del anio anterior al 31/12 del actual y reemplaza ese rango por dependencia.
-- La usa la DDJJ de Guarderia (fecha de reintegro = fin del RN1-RECIEN NACIDO + 1).
-- Sin FK a personal: el Ministerio trae agentes que no estan en personal.
-- Idempotente. El robot tambien crea la tabla si no existe.

CREATE TABLE IF NOT EXISTS ministerio_novedades_anual (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dependencia VARCHAR(20) NOT NULL,
  dni INT NULL,
  legajo VARCHAR(20) NULL,
  apellido_nombre VARCHAR(200) NULL,
  cargo VARCHAR(200) NULL,
  novedad VARCHAR(200) NULL,
  codigo VARCHAR(20) NULL,
  fecha_desde DATE NULL,
  fecha_hasta DATE NULL,
  tramite VARCHAR(100) NULL,
  expediente VARCHAR(100) NULL,
  run_uid VARCHAR(32) NULL,
  descargado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_mna_dni (dni),
  KEY ix_mna_codigo_dni (codigo, dni),
  KEY ix_mna_dep_desde (dependencia, fecha_desde)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO robots_config
  (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, prog_cada_n_dias,
   prog_hora, destino_dir, destino_nombre, destino_editable, lo_leen, notas, activo)
VALUES
  ('intranet_descarga_anual', 'Bajar anual del Ministerio (3 dependencias)', 'Asistencia 2.0 · Descargas', 20,
   'python descargar_anual_ministerio.py', 1, 1, '', 30, '05:00:00',
   NULL, 'tabla ministerio_novedades_anual', 0, 'DDJJ Guardería (fecha de reintegro = fin RN1 + 1)',
   'Novedades registradas del 01/01 del año anterior al 31/12 del actual, HOSPITAL + UPA 4 + UPA 18. Reemplaza ese rango por dependencia en ministerio_novedades_anual; si una falla no toca lo suyo.',
   1)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), comando = VALUES(comando), notas = VALUES(notas);

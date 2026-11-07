-- 109: Control de cruces SIAPE vs Ministerio vs fichadas (04/11/2026). Pestaña "Control de cruces" del
-- Comparador SIAPE. Lo calcula scripts/control_cruces.py (robot control_cruces, a demanda o desde la pestaña).
CREATE TABLE IF NOT EXISTS control_cruces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mes CHAR(7) NOT NULL,
  categoria VARCHAR(4) NOT NULL,
  dependencia VARCHAR(20) NOT NULL DEFAULT '',
  dni INT NOT NULL,
  nombre VARCHAR(160) NOT NULL DEFAULT '',
  ley VARCHAR(160) NOT NULL DEFAULT '',
  fecha DATE NOT NULL,
  turno VARCHAR(5) NOT NULL DEFAULT '',
  entrada VARCHAR(5) NOT NULL DEFAULT '',
  tarde_min INT NULL,
  siape VARCHAR(500) NOT NULL DEFAULT '',
  ministerio VARCHAR(500) NOT NULL DEFAULT '',
  detalle VARCHAR(500) NOT NULL DEFAULT '',
  calculado_en DATETIME NOT NULL,
  KEY ix_control_cruces_mes_cat (mes, categoria),
  KEY ix_control_cruces_dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO robots_config (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias,
                           destino_nombre, destino_editable, notas, activo)
SELECT 'control_cruces', 'Control de cruces', 'Asistencia 2.0', 28, 'python control_cruces.py', 1, 0, '',
       'tabla control_cruces', 0,
       'Cruza SIAPE.xlsx, Ministerio (tabla anual) y fichadas del reloj del mes anterior y el actual: 28 sin respaldo, ausentes sin cargar o borrados, fichó con ausente/licencia, sin fichada ni novedad, tardanzas. Se ve en Comparador SIAPE → Control de cruces.',
       1
 WHERE NOT EXISTS (SELECT 1 FROM robots_config WHERE script = 'control_cruces');

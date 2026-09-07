/**
 * cerrarVinculacionesEgresados.mjs
 *
 * Cierra las vinculaciones (agentes_servicios) y los pases de sector
 * (agentes_sectores) que quedaron ABIERTOS para agentes que ya egresaron.
 *
 * Son casos anteriores a que la baja cerrara ambas tablas. Se les pone
 * fecha_hasta = fecha de egreso del agente.
 *
 * Criterio para elegir a quién tocar:
 *   - el DNI NO tiene ninguna vinculacion ACTIVA sin fecha de egreso
 *     (si tiene un tramo activo, el pase abierto es correcto: NO se toca);
 *   - se usa la fecha de egreso mas reciente de ese DNI;
 *   - si esa fecha es anterior al fecha_desde del pase, se cierra con
 *     fecha_desde (no se generan rangos invertidos).
 *
 * Uso:
 *   node scripts/cerrarVinculacionesEgresados.mjs            → sólo muestra qué haría
 *   node scripts/cerrarVinculacionesEgresados.mjs --aplicar  → aplica los cambios
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const APLICAR = process.argv.includes('--aplicar');

const SELECT_ABIERTOS = (tabla) => `
  SELECT v.id, v.dni, p.apellido, p.nombre,
         DATE_FORMAT(v.fecha_desde, '%Y-%m-%d') AS fecha_desde,
         DATE_FORMAT(eg.fecha_egreso, '%Y-%m-%d') AS fecha_egreso,
         DATE_FORMAT(GREATEST(eg.fecha_egreso, v.fecha_desde), '%Y-%m-%d') AS cierre,
         eg.estado_empleo,
         (eg.fecha_egreso < v.fecha_desde) AS egreso_previo_al_pase
  FROM ${tabla} v
  JOIN personal p ON p.dni = v.dni AND p.deleted_at IS NULL
  JOIN (
    SELECT a.dni, MAX(a.fecha_egreso) AS fecha_egreso,
           SUBSTRING_INDEX(GROUP_CONCAT(a.estado_empleo ORDER BY a.fecha_egreso DESC), ',', 1) AS estado_empleo
    FROM agentes a
    WHERE a.deleted_at IS NULL AND a.estado_empleo <> 'ACTIVO' AND a.fecha_egreso IS NOT NULL
    GROUP BY a.dni
  ) eg ON eg.dni = v.dni
  WHERE v.fecha_hasta IS NULL AND v.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM agentes a2
      WHERE a2.dni = v.dni AND a2.deleted_at IS NULL
        AND a2.estado_empleo = 'ACTIVO' AND a2.fecha_egreso IS NULL)
  ORDER BY p.apellido, p.nombre`;

const c = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASS ?? process.env.DB_PASSWORD,
  database: process.env.DB_NAME, charset: 'utf8mb4',
});

try {
  for (const tabla of ['agentes_servicios', 'agentes_sectores']) {
    const [filas] = await c.query(SELECT_ABIERTOS(tabla));
    console.log(`\n=== ${tabla}: ${filas.length} fila(s) abiertas de agentes egresados ===`);
    for (const f of filas) {
      const aviso = Number(f.egreso_previo_al_pase) ? '  (egreso anterior al pase → se cierra con fecha_desde)' : '';
      console.log(
        `  id ${String(f.id).padStart(6)} · DNI ${String(f.dni).padEnd(9)} ${(f.apellido + ', ' + f.nombre).padEnd(34).slice(0, 34)}` +
        ` · desde ${f.fecha_desde} · egreso ${f.fecha_egreso} (${f.estado_empleo}) → cierra ${f.cierre}${aviso}`
      );
    }

    if (APLICAR && filas.length) {
      await c.query('START TRANSACTION');
      try {
        for (const f of filas) {
          await c.query(
            `UPDATE ${tabla} SET fecha_hasta = ?, updated_at = NOW() WHERE id = ? AND fecha_hasta IS NULL`,
            [f.cierre, f.id]
          );
        }
        await c.query('COMMIT');
        console.log(`  → ${filas.length} fila(s) cerradas en ${tabla}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  }

  console.log(APLICAR
    ? '\nListo: cambios aplicados.'
    : '\nPrevisualización solamente. Para aplicar: node scripts/cerrarVinculacionesEgresados.mjs --aplicar');
} finally {
  await c.end();
}

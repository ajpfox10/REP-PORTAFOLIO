// src/services/mapeoNovedades.ts
// Mapeo ÚNICO novedad SIAPE ↔ novedad Ministerio, en la tabla `mapeo_novedades`
// (migración 055). Reemplaza a los DEFAULT_MAPEO que estaban escritos en
// comparacionSiape.routes.ts / asistencia.routes.ts y al mapeo.asistencia.json.
// Lo leen también los robots de carga (scripts/mapeo_novedades.py).
//
// Forma que usan los comparadores: { 'NOVEDAD MINISTERIO': ['NOVEDAD SIAPE', ...] }.
// Las filas con codigo_cie solo deciden qué se CARGA (robots); para comparar
// cuentan como una equivalencia más.

import { Sequelize, QueryTypes, Transaction } from 'sequelize';

type Fila = { novedad_siape: string; novedad_ministerio: string };

export async function loadMapeoTabla(sequelize: Sequelize): Promise<Record<string, string[]>> {
  const rows = await sequelize.query<Fila>(
    `SELECT novedad_siape, novedad_ministerio
       FROM mapeo_novedades
      WHERE activo = 1
      ORDER BY novedad_ministerio, id`,
    { type: QueryTypes.SELECT },
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const arr = (out[r.novedad_ministerio] ||= []);
    if (!arr.includes(r.novedad_siape)) arr.push(r.novedad_siape);
  }
  return out;
}

/**
 * Guarda lo que manda el editor de mapeo (Asistencia) sobre las reglas
 * GENERALES (codigo_cie = ''). Las reglas por CIE no se tocan.
 * - par nuevo → se inserta; es de carga solo si esa novedad SIAPE no tenía
 *   ninguna regla de carga activa (igual que el JSON: la primera gana).
 * - par que ya no viene → se desactiva (activo = 0), no se borra.
 */
export async function saveMapeoTabla(sequelize: Sequelize, mapeo: Record<string, string[]>): Promise<void> {
  const pares = new Set<string>();
  const lista: Fila[] = [];
  for (const [min, vals] of Object.entries(mapeo || {})) {
    for (const v of vals || []) {
      const siap = String(v || '').trim();
      const m = String(min || '').trim();
      if (!siap || !m) continue;
      const k = `${siap.toUpperCase()}|${m.toUpperCase()}`;
      if (pares.has(k)) continue;
      pares.add(k);
      lista.push({ novedad_siape: siap, novedad_ministerio: m });
    }
  }

  await sequelize.transaction(async (transaction: Transaction) => {
    const actuales = await sequelize.query<Fila & { id: number; activo: number }>(
      `SELECT id, novedad_siape, novedad_ministerio, activo FROM mapeo_novedades WHERE codigo_cie = ''`,
      { type: QueryTypes.SELECT, transaction },
    );
    const clave = (f: Fila) => `${f.novedad_siape.toUpperCase()}|${f.novedad_ministerio.toUpperCase()}`;
    const porClave = new Map(actuales.map(f => [clave(f), f]));

    // primero se apaga lo que ya no viene y después se prende lo que vuelve:
    // así nunca hay dos reglas de carga activas a la vez (índice uq_carga)
    for (const f of actuales) {
      if (f.activo === 1 && !pares.has(clave(f))) {
        await sequelize.query(`UPDATE mapeo_novedades SET activo = 0 WHERE id = ?`,
          { replacements: [f.id], transaction });
      }
    }
    for (const f of actuales) {
      if (f.activo === 0 && pares.has(clave(f))) {
        // si vuelve una regla de carga y esa novedad ya tiene otra de carga, vuelve solo como equivalencia
        await sequelize.query(
          `UPDATE mapeo_novedades m
              SET m.activo = 1,
                  m.usar_para_cargar = IF(m.usar_para_cargar = 1 AND EXISTS (
                    SELECT 1 FROM (SELECT novedad_siape FROM mapeo_novedades
                                    WHERE codigo_cie = '' AND usar_para_cargar = 1 AND activo = 1) x
                     WHERE x.novedad_siape = m.novedad_siape), 0, m.usar_para_cargar)
            WHERE m.id = ?`,
          { replacements: [f.id], transaction });
      }
    }

    for (const f of lista) {
      if (porClave.has(clave(f))) continue;
      const [conCarga] = await sequelize.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM mapeo_novedades
          WHERE novedad_siape = ? AND codigo_cie = '' AND usar_para_cargar = 1 AND activo = 1`,
        { replacements: [f.novedad_siape], type: QueryTypes.SELECT, transaction },
      );
      await sequelize.query(
        `INSERT INTO mapeo_novedades (novedad_siape, codigo_cie, novedad_ministerio, usar_para_cargar, observacion)
         VALUES (?, '', ?, ?, 'editor asistencia')`,
        { replacements: [f.novedad_siape, f.novedad_ministerio, Number(conCarga?.n) > 0 ? 0 : 1], transaction },
      );
    }
  });
}

/** "Restaurar por defecto" del editor: deja activas solo las reglas generales de la carga inicial. */
export async function restaurarMapeoTabla(sequelize: Sequelize): Promise<void> {
  await sequelize.transaction(async (transaction: Transaction) => {
    // en dos pasos (apagar y después prender) por el índice uq_carga
    await sequelize.query(
      `UPDATE mapeo_novedades SET activo = 0
        WHERE codigo_cie = '' AND (observacion IS NULL OR observacion NOT LIKE 'inicial:%')`,
      { transaction },
    );
    await sequelize.query(
      `UPDATE mapeo_novedades SET activo = 1
        WHERE codigo_cie = '' AND observacion LIKE 'inicial:%'`,
      { transaction },
    );
  });
}

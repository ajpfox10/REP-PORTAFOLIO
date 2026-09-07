/**
 * @file domains/personalv5/services/docuCarpeta.service.ts
 * @description Crea la carpeta del agente en DOCU (D:\G\DOCU\<dni>) y, dentro,
 * una subcarpeta por cada documento activo del orden segun la ley del agente.
 *
 * Espeja lo que hacen /tandas/crear-subcarpetas y scripts/crearSubcarpetasTanda.mjs,
 * pero para UN agente, para usarlo al momento del alta.
 *
 * Nunca lanza: si el disco no esta disponible o falta configuracion, devuelve
 * el motivo. El alta no se puede caer por un problema de archivos.
 */

import fs from 'fs';
import path from 'path';
import { Sequelize, QueryTypes } from 'sequelize';
import { env } from '../../../config/env';

const ORDEN_PROCESO_DEFAULT = 'PASE A TRANSITORIA';

export interface CrearCarpetaDocuResult {
  ok: boolean;
  carpeta?: string;
  creada?: boolean;       // true si la carpeta del DNI no existia
  ley?: string | null;    // ley detectada para las subcarpetas
  subcarpetas?: number;   // subcarpetas creadas
  existentes?: number;    // subcarpetas que ya estaban
  motivo?: string;        // por que no se hizo (o que fallo)
}

/** Limpia un nombre para usarlo como carpeta en Windows. */
function safeSegment(name: string): string {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const clean = base
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\x00-\x1F]/g, '')
    .trim()
    .replace(/\.+$/, '');
  return clean === '.' || clean === '..' ? '' : clean;
}

/**
 * Crea DOCU\<dni> (si no existe) y las subcarpetas del orden de documentos.
 * @param sequelize conexion para resolver la ley y el orden de documentos
 * @param dni       DNI del agente (solo digitos)
 * @param agenteId  id en "agentes" para resolver la ley del tramo recien creado
 */
export async function crearCarpetaDocuAgente(
  sequelize: Sequelize,
  dni: number,
  agenteId?: number
): Promise<CrearCarpetaDocuResult> {
  try {
    const base = String(env.TRAMITES_DOCU_BASE_DIR || '').trim();
    if (!base) return { ok: false, motivo: 'TRAMITES_DOCU_BASE_DIR no esta configurado' };

    const dniStr = String(dni);
    if (!/^\d+$/.test(dniStr)) return { ok: false, motivo: 'DNI invalido' };

    // La carpeta tiene que quedar SI o SI dentro de la base.
    const baseResolved = path.resolve(base);
    const carpeta = path.resolve(baseResolved, dniStr);
    const rel = path.relative(baseResolved, carpeta);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, motivo: 'Carpeta del agente insegura' };
    }

    const yaEstaba = fs.existsSync(carpeta);
    if (!yaEstaba) fs.mkdirSync(carpeta, { recursive: true });

    // Ley del agente: primero la de la ocupacion (como el script de tandas),
    // si no hay, la ley cargada directo en el tramo.
    const filas = await sequelize.query<{ ley: string | null }>(
      `SELECT CASE
                WHEN COALESCE(ocl.nombre, l.nombre) LIKE '%10471%' THEN '10471'
                WHEN COALESCE(ocl.nombre, l.nombre) LIKE '%10430%' THEN '10430'
                ELSE NULL
              END AS ley
         FROM agentes a
         LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
         LEFT JOIN ley ocl        ON ocl.id = oc.ley_id     AND ocl.deleted_at IS NULL
         LEFT JOIN ley l          ON l.id = a.ley_id        AND l.deleted_at IS NULL
        WHERE a.deleted_at IS NULL
          AND ${agenteId ? 'a.id = :agenteId' : 'a.dni = :dni'}
        ORDER BY a.id DESC
        LIMIT 1`,
      { replacements: { agenteId, dni }, type: QueryTypes.SELECT }
    );
    const ley = filas[0]?.ley ?? null;
    if (!ley) {
      return { ok: true, carpeta, creada: !yaEstaba, ley: null, subcarpetas: 0, existentes: 0,
               motivo: 'Sin ley 10430/10471: no se crearon subcarpetas' };
    }

    const docs = await sequelize.query<{ documento: string }>(
      `SELECT documento FROM orden_documentos_expediente
        WHERE proceso = :proceso AND ley = :ley AND activo = 1
        ORDER BY orden`,
      { replacements: { proceso: ORDEN_PROCESO_DEFAULT, ley }, type: QueryTypes.SELECT }
    );

    let subcarpetas = 0;
    let existentes = 0;
    for (const d of docs) {
      const seg = safeSegment(d.documento);
      if (!seg) continue;
      const target = path.join(carpeta, seg);
      if (fs.existsSync(target)) { existentes += 1; continue; }
      fs.mkdirSync(target, { recursive: true });
      subcarpetas += 1;
    }

    return { ok: true, carpeta, creada: !yaEstaba, ley, subcarpetas, existentes };
  } catch (err: any) {
    return { ok: false, motivo: err?.message || String(err) };
  }
}

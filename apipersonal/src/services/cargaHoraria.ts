// src/services/cargaHoraria.ts
// Carga horaria semanal del agente para los certificados (mig 114).
// Se configura por ley en Herramientas → Carga horaria por ley:
//   1) ocupación insalubre (lista carga_horaria_insalubre_ocupaciones, mig 115, o
//      ocupaciones.es_insalubre = 1) o sector vigente insalubre (mig 116)
//      + ley con horas_insalubre                                                  → esas horas
//   2) servicio vigente marcado como agotamiento prematuro + horas_agotamiento    → esas horas
//   3) ley con horas_base                                                          → esas horas
//   4) sin configuración: régimen horario del tramo (regimenes_horarios.nombre)
import { Sequelize, QueryTypes } from 'sequelize';

export type MotivoHoras = 'INSALUBRE' | 'AGOTAMIENTO' | 'LEY' | 'REGIMEN' | 'SIN_DATO';

export interface HorasAgente {
  horas: string;          // '' si no hay dato
  motivo: MotivoHoras;
}

/** Elige las horas según la configuración de la ley (sin acceso a la base). */
export function elegirHoras(f: {
  horas_base: number | null; horas_insalubre: number | null; horas_agotamiento: number | null;
  es_insalubre: number | null; es_agotamiento: number | null; regimen: any;
}): HorasAgente {
  if (f.es_insalubre && f.horas_insalubre) return { horas: String(f.horas_insalubre), motivo: 'INSALUBRE' };
  if (f.es_agotamiento && f.horas_agotamiento) return { horas: String(f.horas_agotamiento), motivo: 'AGOTAMIENTO' };
  if (f.horas_base) return { horas: String(f.horas_base), motivo: 'LEY' };
  const rh = String(f.regimen ?? '').trim();
  return /^\d+$/.test(rh) ? { horas: rh, motivo: 'REGIMEN' } : { horas: '', motivo: 'SIN_DATO' };
}

/** Columnas comunes: se usan con el alias `a` = tramo de agentes. */
export const SQL_FACTORES_HORAS = `
       chl.horas_base, chl.horas_insalubre, chl.horas_agotamiento,
       (COALESCE(oc.es_insalubre, 0) = 1 OR EXISTS (SELECT 1 FROM carga_horaria_insalubre_ocupaciones chio
                                                      WHERE chio.ocupacion_id = a.ocupacion_id)
        OR EXISTS (SELECT 1 FROM agentes_sectores asx
                     JOIN carga_horaria_insalubre_sectores chis ON chis.sector_id = asx.sector_id
                    WHERE asx.dni = a.dni AND asx.deleted_at IS NULL
                      AND (asx.fecha_hasta IS NULL OR asx.fecha_hasta >= CURDATE()))) AS es_insalubre,
       EXISTS (SELECT 1 FROM agentes_servicios ags
                 JOIN carga_horaria_agotamiento_servicios chas ON chas.servicio_id = ags.servicio_id
                WHERE ags.dni = a.dni AND ags.deleted_at IS NULL
                  AND (ags.fecha_hasta IS NULL OR ags.fecha_hasta >= CURDATE())) AS es_agotamiento,
       rh.nombre AS regimen`;

export const SQL_JOINS_HORAS = `
  LEFT JOIN carga_horaria_ley chl ON chl.ley_id = a.ley_id
  LEFT JOIN ocupaciones oc        ON oc.id = a.ocupacion_id
  LEFT JOIN regimenes_horarios rh ON rh.id = a.regimen_horario_id`;

/** Horas semanales del tramo vigente del agente (o el último si no tiene vigente). */
export async function horasSemanalesAgente(sequelize: Sequelize, dni: number): Promise<HorasAgente> {
  const [f] = await sequelize.query<any>(
    `SELECT ${SQL_FACTORES_HORAS}
       FROM agentes a ${SQL_JOINS_HORAS}
      WHERE a.dni = :dni AND a.deleted_at IS NULL
      ORDER BY (a.estado_empleo = 'ACTIVO' AND a.fecha_egreso IS NULL) DESC, a.id DESC
      LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  if (!f) return { horas: '', motivo: 'SIN_DATO' };
  return elegirHoras(f);
}

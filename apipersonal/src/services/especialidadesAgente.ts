/**
 * Especialidad del agente con historial (tabla agentes_especialidades, mig 060).
 *
 * Un periodo por fila; la vigente es la que tiene fecha_hasta NULL (columna generada
 * `abierta` + UNIQUE(dni, abierta) garantiza que haya una sola). Cambiar de
 * especialidad = cerrar la vigente en una fecha y abrir la nueva desde otra (por
 * defecto el dia siguiente al cierre), sin solaparse con otros periodos.
 *
 * Lo usan: el alta del agente (primer periodo), PATCH /personal/:dni (cambio desde
 * el form de carga) y los endpoints /personal/:dni/especialidades (Gestion).
 */
import { QueryTypes, Sequelize, Transaction } from 'sequelize';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Suma dias a 'YYYY-MM-DD' (UTC, sin husos). */
export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const hoyIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export type PeriodoEspecialidad = {
  id: number;
  dni: number;
  especialidad_id: number;
  especialidad: string | null;
  profesion: string | null;
  fecha_desde: string;
  fecha_hasta: string | null;
  observaciones: string | null;
  vigente: 0 | 1;
};

const SELECT_PERIODOS = `
  SELECT ae.id, ae.dni, ae.especialidad_id, esp.especialidad, esp.profesion,
         DATE_FORMAT(ae.fecha_desde, '%Y-%m-%d') AS fecha_desde,
         DATE_FORMAT(ae.fecha_hasta, '%Y-%m-%d') AS fecha_hasta,
         ae.observaciones, IF(ae.fecha_hasta IS NULL, 1, 0) AS vigente
  FROM agentes_especialidades ae
  LEFT JOIN especialidaddesmedicas esp ON esp.id = ae.especialidad_id
  WHERE ae.dni = :dni AND ae.deleted_at IS NULL`;

/** Historial completo, el mas reciente primero. */
export async function listarEspecialidades(sequelize: Sequelize, dni: number, t?: Transaction) {
  return sequelize.query<PeriodoEspecialidad>(
    `${SELECT_PERIODOS} ORDER BY ae.fecha_desde DESC, ae.id DESC`,
    { replacements: { dni }, type: QueryTypes.SELECT, transaction: t }
  );
}

async function periodoAbierto(sequelize: Sequelize, dni: number, t?: Transaction) {
  const rows = await sequelize.query<PeriodoEspecialidad>(
    `${SELECT_PERIODOS} AND ae.fecha_hasta IS NULL LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT, transaction: t }
  );
  return rows[0] ?? null;
}

/** Tira 409 si [desde, hasta] (hasta NULL = abierto) se pisa con otro periodo del agente. */
async function validarSinSolape(
  sequelize: Sequelize, dni: number, desde: string, hasta: string | null, excluirId: number | null, t?: Transaction
) {
  const rows = await sequelize.query<PeriodoEspecialidad>(
    `${SELECT_PERIODOS}
       AND (:excluirId IS NULL OR ae.id <> :excluirId)
       AND ae.fecha_desde <= COALESCE(:hasta, '9999-12-31')
       AND (ae.fecha_hasta IS NULL OR ae.fecha_hasta >= :desde)
     LIMIT 1`,
    { replacements: { dni, desde, hasta, excluirId }, type: QueryTypes.SELECT, transaction: t }
  );
  if (rows[0]) {
    const o = rows[0];
    throw httpError(409,
      `Se superpone con ${o.especialidad ?? 'otra especialidad'} ` +
      `(${o.fecha_desde} → ${o.fecha_hasta ?? 'vigente'}). Revisá las fechas.`);
  }
}

export type CambioEspecialidadInput = {
  dni: number;
  /** Especialidad nueva; null = solo cerrar la vigente. */
  especialidad_id: number | null;
  /** Cierre de la vigente (default: dia anterior al alta, o hoy si no hay alta). */
  fecha_cierre?: string | null;
  /** Alta de la nueva (default: dia siguiente al cierre; sin vigente: hoy). */
  fecha_desde?: string | null;
  observaciones?: string | null;
  actor?: number | null;
};

export type CambioEspecialidadResult = {
  cerrada: { id: number; fecha_hasta: string } | null;
  abierta: { id: number; especialidad_id: number; fecha_desde: string } | null;
  sinCambios?: boolean;
};

/**
 * Cierra la especialidad vigente y abre la nueva, en la transaccion del llamador.
 * Si la nueva es la misma que la vigente no hace nada.
 */
export async function cambiarEspecialidad(
  sequelize: Sequelize, input: CambioEspecialidadInput, t: Transaction
): Promise<CambioEspecialidadResult> {
  const { dni, especialidad_id } = input;
  for (const [k, v] of [['fecha_cierre', input.fecha_cierre], ['fecha_desde', input.fecha_desde]] as const) {
    if (v && !ISO.test(v)) throw httpError(400, `${k} debe ser YYYY-MM-DD`);
  }

  if (especialidad_id != null) {
    const ok = await sequelize.query(
      'SELECT id FROM especialidaddesmedicas WHERE id = :id AND deleted_at IS NULL LIMIT 1',
      { replacements: { id: especialidad_id }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!ok.length) throw httpError(400, `Especialidad ${especialidad_id} inexistente`);
  }

  const vigente = await periodoAbierto(sequelize, dni, t);
  if (vigente && especialidad_id != null && Number(vigente.especialidad_id) === Number(especialidad_id)) {
    return { cerrada: null, abierta: null, sinCambios: true };
  }
  if (!vigente && especialidad_id == null) {
    throw httpError(409, 'El agente no tiene una especialidad vigente para cerrar');
  }

  let cerrada: CambioEspecialidadResult['cerrada'] = null;
  let fechaDesde = input.fecha_desde || null;

  if (vigente) {
    const fechaCierre = input.fecha_cierre
      || (fechaDesde ? addDaysIso(fechaDesde, -1) : hoyIso());
    if (fechaCierre < vigente.fecha_desde) {
      throw httpError(400,
        `La fecha de cierre (${fechaCierre}) es anterior al inicio de ${vigente.especialidad ?? 'la especialidad vigente'} (${vigente.fecha_desde})`);
    }
    fechaDesde = fechaDesde || addDaysIso(fechaCierre, 1);
    if (especialidad_id != null && fechaDesde <= fechaCierre) {
      throw httpError(400, `La fecha de alta (${fechaDesde}) tiene que ser posterior al cierre (${fechaCierre})`);
    }
    await sequelize.query(
      `UPDATE agentes_especialidades SET fecha_hasta = :fechaCierre, updated_by = :actor WHERE id = :id`,
      { replacements: { fechaCierre, id: vigente.id, actor: input.actor ?? null }, transaction: t }
    );
    cerrada = { id: vigente.id, fecha_hasta: fechaCierre };
  }

  if (especialidad_id == null) return { cerrada, abierta: null };

  fechaDesde = fechaDesde || hoyIso();
  await validarSinSolape(sequelize, dni, fechaDesde, null, null, t);
  const [insRes]: any = await sequelize.query(
    `INSERT INTO agentes_especialidades (dni, especialidad_id, fecha_desde, observaciones, created_by)
     VALUES (:dni, :especialidad_id, :fechaDesde, :observaciones, :actor)`,
    {
      replacements: {
        dni, especialidad_id, fechaDesde,
        observaciones: input.observaciones?.trim() || null,
        actor: input.actor ?? null,
      },
      transaction: t,
    }
  );
  // el dialecto mysql devuelve el insertId pelado; por las dudas aceptar el objeto tambien
  const insertId = Number(typeof insRes === 'object' ? insRes?.insertId : insRes);
  return { cerrada, abierta: { id: insertId, especialidad_id, fecha_desde: fechaDesde } };
}

/** Corrige fechas/observaciones de un periodo sin pisar a los demas. */
export async function corregirPeriodo(
  sequelize: Sequelize, dni: number, id: number,
  cambios: { fecha_desde?: string; fecha_hasta?: string | null; observaciones?: string | null; actor?: number | null },
  t: Transaction
) {
  const rows = await sequelize.query<PeriodoEspecialidad>(
    `${SELECT_PERIODOS} AND ae.id = :id LIMIT 1`,
    { replacements: { dni, id }, type: QueryTypes.SELECT, transaction: t }
  );
  const p = rows[0];
  if (!p) throw httpError(404, 'Periodo de especialidad no encontrado');

  const desde = cambios.fecha_desde ?? p.fecha_desde;
  const hasta = cambios.fecha_hasta !== undefined ? cambios.fecha_hasta : p.fecha_hasta;
  for (const v of [desde, hasta]) if (v && !ISO.test(v)) throw httpError(400, 'Fechas en formato YYYY-MM-DD');
  if (hasta && hasta < desde) throw httpError(400, 'La fecha hasta no puede ser anterior a la fecha desde');
  // Reabrir un periodo viejo solo si no hay otra vigente (lo frena el UNIQUE igual).
  await validarSinSolape(sequelize, dni, desde, hasta, id, t);

  await sequelize.query(
    `UPDATE agentes_especialidades
        SET fecha_desde = :desde, fecha_hasta = :hasta,
            observaciones = :observaciones, updated_by = :actor
      WHERE id = :id`,
    {
      replacements: {
        id, desde, hasta,
        observaciones: cambios.observaciones !== undefined ? (cambios.observaciones?.trim() || null) : p.observaciones,
        actor: cambios.actor ?? null,
      },
      transaction: t,
    }
  );
}

/** Anula (borrado logico) un periodo cargado por error. */
export async function anularPeriodo(
  sequelize: Sequelize, dni: number, id: number, actor: number | null, t: Transaction
) {
  const [, meta]: any = await sequelize.query(
    `UPDATE agentes_especialidades SET deleted_at = NOW(), updated_by = :actor
      WHERE id = :id AND dni = :dni AND deleted_at IS NULL`,
    { replacements: { id, dni, actor }, transaction: t }
  );
  const affected = typeof meta === 'number' ? meta : meta?.affectedRows;
  if (!affected) throw httpError(404, 'Periodo de especialidad no encontrado');
}

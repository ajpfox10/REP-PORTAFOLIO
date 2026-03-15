/**
 * @file domains/personalv5/services/agentes.service.ts
 *
 * Lógica de agentes con operaciones atómicas.
 *
 * El punto crítico es el "alta de agente": antes el front hacía 3 llamadas
 * separadas (POST /personal → POST /agentes → POST /agentes_servicios).
 * Si la segunda fallaba, quedaba un registro en "personal" sin agente.
 *
 * Ahora todo va en una sola transacción: o todo entra, o nada entra.
 */

import { QueryTypes, Transaction } from 'sequelize';
import { logger } from '../../../logging/logger';
import { trackAction } from '../../../logging/track';

// ── TIPOS ─────────────────────────────────────────────────────────────────────

export interface AltaAgenteDto {
  // TABLA personal
  dni:                number;
  apellido:           string;
  nombre:             string;
  cuil?:              string;
  fecha_nacimiento?:  string;
  sexo_id?:           number;
  estado_civil?:      string;
  email?:             string;
  telefono?:          string;
  domicilio?:         string;
  localidad_id?:      number;

  // TABLA agentes
  ley_id?:            number;
  planta_id?:         number;
  categoria_id?:      number;
  funcion_id?:        number;
  ocupacion_id?:      number;
  regimen_horario_id?: number;
  jefatura_id?:       number;
  sector_id?:         number;
  dependencia_id?:    number;
  fecha_ingreso?:     string;
  fecha_egreso?:      string;
  estado?:            string;

  // TABLA agentes_servicios (array de servicios)
  servicios?: Array<{
    servicio_id: number;
    fecha_desde?: string;
    fecha_hasta?: string;
    observaciones?: string;
  }>;

  actor?: number | null;
}

export interface AltaAgenteResult {
  dni:       number;
  apellido:  string;
  nombre:    string;
  agenteId:  number | null;
  servicios: number;
}

// ── ALTA ATÓMICA ─────────────────────────────────────────────────────────────

/**
 * Crea un agente completo en una sola transacción.
 *
 * Orden de inserción:
 *   1. personal         (tabla padre)
 *   2. agentes          (depende de personal.dni)
 *   3. agentes_servicios (depende de agentes.id)
 *
 * Si cualquier paso falla, toda la transacción se revierte.
 */
export async function altaAgente(
  sequelize: any,
  dto: AltaAgenteDto
): Promise<AltaAgenteResult> {
  const t: Transaction = await sequelize.transaction();

  try {
    // ── Paso 1: personal ──────────────────────────────────────────────────────
    // Verifico que el DNI no exista ya
    const existing = await sequelize.query(
      `SELECT dni FROM personal WHERE dni = :dni LIMIT 1`,
      { replacements: { dni: dto.dni }, type: QueryTypes.SELECT, transaction: t }
    );

    if ((existing as any[]).length > 0) {
      throw Object.assign(
        new Error(`El DNI ${dto.dni} ya existe en el sistema`),
        { status: 409, code: 'DNI_DUPLICATE' }
      );
    }

    await sequelize.query(
      `INSERT INTO personal
         (dni, apellido, nombre, cuil, fecha_nacimiento, sexo_id,
          estado_civil, email, telefono, domicilio, localidad_id,
          created_at, updated_at)
       VALUES
         (:dni, :apellido, :nombre, :cuil, :fecha_nacimiento, :sexo_id,
          :estado_civil, :email, :telefono, :domicilio, :localidad_id,
          NOW(), NOW())`,
      {
        replacements: {
          dni:              dto.dni,
          apellido:         dto.apellido,
          nombre:           dto.nombre,
          cuil:             dto.cuil             ?? null,
          fecha_nacimiento: dto.fecha_nacimiento ?? null,
          sexo_id:          dto.sexo_id          ?? null,
          estado_civil:     dto.estado_civil     ?? null,
          email:            dto.email            ?? null,
          telefono:         dto.telefono         ?? null,
          domicilio:        dto.domicilio        ?? null,
          localidad_id:     dto.localidad_id     ?? null,
        },
        transaction: t,
      }
    );

    // ── Paso 2: agentes ───────────────────────────────────────────────────────
    let agenteId: number | null = null;

    const hasAgenteData = dto.ley_id || dto.planta_id || dto.categoria_id
      || dto.sector_id || dto.dependencia_id;

    if (hasAgenteData) {
      const [aResult] = await sequelize.query(
        `INSERT INTO agentes
           (dni, ley_id, planta_id, categoria_id, funcion_id, ocupacion_id,
            regimen_horario_id, jefatura_id, sector_id, dependencia_id,
            fecha_ingreso, fecha_egreso, estado, created_at, updated_at)
         VALUES
           (:dni, :ley_id, :planta_id, :categoria_id, :funcion_id, :ocupacion_id,
            :regimen_horario_id, :jefatura_id, :sector_id, :dependencia_id,
            :fecha_ingreso, :fecha_egreso, :estado, NOW(), NOW())`,
        {
          replacements: {
            dni:               dto.dni,
            ley_id:            dto.ley_id             ?? null,
            planta_id:         dto.planta_id          ?? null,
            categoria_id:      dto.categoria_id       ?? null,
            funcion_id:        dto.funcion_id         ?? null,
            ocupacion_id:      dto.ocupacion_id       ?? null,
            regimen_horario_id: dto.regimen_horario_id ?? null,
            jefatura_id:       dto.jefatura_id        ?? null,
            sector_id:         dto.sector_id          ?? null,
            dependencia_id:    dto.dependencia_id     ?? null,
            fecha_ingreso:     dto.fecha_ingreso      ?? null,
            fecha_egreso:      dto.fecha_egreso       ?? null,
            estado:            dto.estado             ?? 'ACTIVO',
          },
          transaction: t,
        }
      );
      agenteId = (aResult as any)?.insertId ?? null;
    }

    // ── Paso 3: agentes_servicios ─────────────────────────────────────────────
    let serviciosInsertados = 0;

    if (agenteId && dto.servicios?.length) {
      for (const srv of dto.servicios) {
        await sequelize.query(
          `INSERT INTO agentes_servicios
             (agente_id, servicio_id, fecha_desde, fecha_hasta, observaciones, created_at)
           VALUES (:agente_id, :servicio_id, :fecha_desde, :fecha_hasta, :observaciones, NOW())`,
          {
            replacements: {
              agente_id:    agenteId,
              servicio_id:  srv.servicio_id,
              fecha_desde:  srv.fecha_desde    ?? null,
              fecha_hasta:  srv.fecha_hasta    ?? null,
              observaciones: srv.observaciones ?? null,
            },
            transaction: t,
          }
        );
        serviciosInsertados++;
      }
    }

    // ── Todo OK: confirmo la transacción ─────────────────────────────────────
    await t.commit();

    logger.info({
      msg:       '[agentes] alta OK',
      dni:       dto.dni,
      agenteId,
      servicios: serviciosInsertados,
      actor:     dto.actor,
    });

    trackAction('agente_alta_ok', { dni: dto.dni, agenteId, actor: dto.actor });

    return {
      dni:      dto.dni,
      apellido: dto.apellido,
      nombre:   dto.nombre,
      agenteId,
      servicios: serviciosInsertados,
    };

  } catch (err) {
    await t.rollback();
    logger.error({ msg: '[agentes] alta falló, rollback ejecutado', err });
    throw err;
  }
}

// ── EDICIÓN ───────────────────────────────────────────────────────────────────

/**
 * Actualiza personal + agentes en una transacción.
 * Solo actualiza los campos que vienen en el dto (partial update).
 */
export async function editarAgente(
  sequelize: any,
  dni: number,
  dto: Partial<AltaAgenteDto>
): Promise<void> {
  const t: Transaction = await sequelize.transaction();

  try {
    // Campos de personal
    const personalFields: Record<string, any> = {};
    const pKeys = ['apellido', 'nombre', 'cuil', 'fecha_nacimiento', 'sexo_id',
                   'estado_civil', 'email', 'telefono', 'domicilio', 'localidad_id'] as const;

    for (const k of pKeys) {
      if (dto[k] !== undefined) personalFields[k] = dto[k];
    }

    if (Object.keys(personalFields).length > 0) {
      const sets = Object.keys(personalFields).map(k => `${k} = :${k}`).join(', ');
      await sequelize.query(
        `UPDATE personal SET ${sets}, updated_at = NOW() WHERE dni = :dni`,
        { replacements: { ...personalFields, dni }, transaction: t }
      );
    }

    // Campos de agentes
    const agenteFields: Record<string, any> = {};
    const aKeys = ['ley_id', 'planta_id', 'categoria_id', 'funcion_id', 'ocupacion_id',
                   'regimen_horario_id', 'jefatura_id', 'sector_id', 'dependencia_id',
                   'fecha_ingreso', 'fecha_egreso', 'estado'] as const;

    for (const k of aKeys) {
      if (dto[k] !== undefined) agenteFields[k] = dto[k];
    }

    if (Object.keys(agenteFields).length > 0) {
      const sets = Object.keys(agenteFields).map(k => `${k} = :${k}`).join(', ');
      await sequelize.query(
        `UPDATE agentes SET ${sets}, updated_at = NOW() WHERE dni = :dni`,
        { replacements: { ...agenteFields, dni }, transaction: t }
      );
    }

    await t.commit();
    logger.info({ msg: '[agentes] edición OK', dni, actor: dto.actor });

  } catch (err) {
    await t.rollback();
    throw err;
  }
}

/**
 * @file domains/personalv5/services/agente.service.ts
 * @description Logica de negocio para gestion de agentes.
 *
 * Resuelve el problema critico de integridad transaccional:
 * crear un agente requiere insertar en 3 tablas (personal, agentes, agentes_servicios).
 * Si se hace en 3 llamadas separadas desde el frontend y la segunda falla,
 * quedaria un registro huerfano en "personal" sin "agentes" correspondiente.
 *
 * Solucion: el metodo "alta()" hace todo en UNA transaccion.
 * Si algo falla, se deshace todo automaticamente (rollback).
 * El frontend hace 1 sola llamada en lugar de 3.
 */

import { Sequelize, QueryTypes } from 'sequelize';
import { invalidate, agenteTags, personalTags } from '../../../infra/invalidateOnWrite';
import { logger } from '../../../logging/logger';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface AltaAgenteDto {
  // Datos personales (tabla: personal)
  dni: number;
  apellido: string;
  nombre: string;
  fecha_nacimiento?: string;
  sexo_id?: number;
  cuil?: string;
  email?: string;
  telefono?: string;
  domicilio?: string;
  localidad_id?: number;

  // Datos laborales (tabla: agentes)
  ley_id?: number;
  planta_id?: number;
  categoria_id?: number;
  funcion_id?: number;
  ocupacion_id?: number;
  regimen_horario_id?: number;
  jefatura_id?: number;
  sector_id?: number;
  dependencia_id?: number;
  fecha_ingreso?: string;
  fecha_alta?: string;

  // Servicios adicionales (tabla: agentes_servicios)
  servicios?: Array<{
    servicio_id: number;
    fecha_desde?: string;
    fecha_hasta?: string;
  }>;

  // Metadata
  actor?: number;
}

export interface AltaAgenteResult {
  dni: number;
  agenteId?: number;
}

// ─── AgenteService ────────────────────────────────────────────────────────────

export class AgenteService {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Alta atomica de agente.
   * Crea personal + agentes + servicios en UNA SOLA transaccion.
   * Si cualquier paso falla, se revierten todos los cambios.
   *
   * @returns Los IDs creados
   */
  async alta(dto: AltaAgenteDto): Promise<AltaAgenteResult> {
    const t = await this.sequelize.transaction();

    try {
      // Paso 1: Verificar que el DNI no exista ya
      const existing = await this.sequelize.query<{ dni: number }>(
        'SELECT dni FROM personal WHERE dni = :dni LIMIT 1',
        { replacements: { dni: dto.dni }, type: QueryTypes.SELECT, transaction: t }
      );
      if (existing.length > 0) {
        throw Object.assign(new Error(`El DNI ${dto.dni} ya existe en el sistema.`), { status: 409 });
      }

      // Paso 2: Insertar en personal
      await this.sequelize.query(
        `INSERT INTO personal
         (dni, apellido, nombre, fecha_nacimiento, sexo_id, cuil, email, telefono, domicilio, localidad_id, created_by, created_at)
         VALUES (:dni, :apellido, :nombre, :fecha_nacimiento, :sexo_id, :cuil, :email, :telefono, :domicilio, :localidad_id, :actor, NOW())`,
        {
          replacements: {
            dni: dto.dni,
            apellido: String(dto.apellido || '').trim().toUpperCase(),
            nombre: String(dto.nombre || '').trim(),
            fecha_nacimiento: dto.fecha_nacimiento || null,
            sexo_id: dto.sexo_id || null,
            cuil: dto.cuil || null,
            email: dto.email || null,
            telefono: dto.telefono || null,
            domicilio: dto.domicilio || null,
            localidad_id: dto.localidad_id || null,
            actor: dto.actor || null,
          },
          transaction: t,
        }
      );

      // Paso 3: Insertar en agentes (datos laborales)
      const [agenteResult]: any = await this.sequelize.query(
        `INSERT INTO agentes
         (dni, ley_id, planta_id, categoria_id, funcion_id, ocupacion_id, regimen_horario_id,
          jefatura_id, sector_id, dependencia_id, fecha_ingreso, fecha_alta, created_by, created_at)
         VALUES (:dni, :ley_id, :planta_id, :categoria_id, :funcion_id, :ocupacion_id, :regimen_horario_id,
                 :jefatura_id, :sector_id, :dependencia_id, :fecha_ingreso, :fecha_alta, :actor, NOW())`,
        {
          replacements: {
            dni: dto.dni,
            ley_id: dto.ley_id || null,
            planta_id: dto.planta_id || null,
            categoria_id: dto.categoria_id || null,
            funcion_id: dto.funcion_id || null,
            ocupacion_id: dto.ocupacion_id || null,
            regimen_horario_id: dto.regimen_horario_id || null,
            jefatura_id: dto.jefatura_id || null,
            sector_id: dto.sector_id || null,
            dependencia_id: dto.dependencia_id || null,
            fecha_ingreso: dto.fecha_ingreso || null,
            fecha_alta: dto.fecha_alta || null,
            actor: dto.actor || null,
          },
          transaction: t,
        }
      );
      const agenteId = agenteResult?.insertId;

      // Paso 4: Insertar servicios si los hay
      if (dto.servicios && dto.servicios.length > 0) {
        for (const srv of dto.servicios) {
          await this.sequelize.query(
            `INSERT INTO agentes_servicios (dni, servicio_id, fecha_desde, fecha_hasta, created_at)
             VALUES (:dni, :servicio_id, :fecha_desde, :fecha_hasta, NOW())`,
            {
              replacements: {
                dni: dto.dni,
                servicio_id: srv.servicio_id,
                fecha_desde: srv.fecha_desde || null,
                fecha_hasta: srv.fecha_hasta || null,
              },
              transaction: t,
            }
          );
        }
      }

      // Todo OK: confirmar la transaccion
      await t.commit();

      // Invalida el cache del listado de personal
      await invalidate([...personalTags.all(dto.dni), ...agenteTags.all(dto.dni)], 'agente.alta');

      logger.info({ msg: 'Alta de agente exitosa', dni: dto.dni, agenteId, actor: dto.actor });

      return { dni: dto.dni, agenteId };

    } catch (err) {
      // Algo fallo: revertir TODO (ningun dato queda a medias en la BD)
      await t.rollback();
      throw err;
    }
  }

  /**
   * Actualiza datos de un agente (personal + agentes en una transaccion).
   */
  async update(dni: number, dto: Partial<AltaAgenteDto>): Promise<void> {
    const t = await this.sequelize.transaction();
    try {
      // Actualizar personal si hay campos de personal
      const personalFields = ['apellido', 'nombre', 'fecha_nacimiento', 'sexo_id', 'cuil', 'email', 'telefono', 'domicilio', 'localidad_id'];
      const personalUpdate = Object.fromEntries(
        Object.entries(dto).filter(([k]) => personalFields.includes(k))
      );
      if (Object.keys(personalUpdate).length > 0) {
        const setClauses = Object.keys(personalUpdate).map(k => `${k} = :${k}`).join(', ');
        await this.sequelize.query(
          `UPDATE personal SET ${setClauses}, updated_at = NOW() WHERE dni = :dni`,
          { replacements: { ...personalUpdate, dni }, transaction: t }
        );
      }

      // Actualizar agentes si hay campos laborales
      const agenteFields = ['ley_id', 'planta_id', 'categoria_id', 'funcion_id', 'ocupacion_id', 'regimen_horario_id', 'jefatura_id', 'sector_id', 'dependencia_id', 'fecha_ingreso', 'fecha_alta'];
      const agenteUpdate = Object.fromEntries(
        Object.entries(dto).filter(([k]) => agenteFields.includes(k))
      );
      if (Object.keys(agenteUpdate).length > 0) {
        const setClauses = Object.keys(agenteUpdate).map(k => `${k} = :${k}`).join(', ');
        await this.sequelize.query(
          `UPDATE agentes SET ${setClauses}, updated_at = NOW() WHERE dni = :dni`,
          { replacements: { ...agenteUpdate, dni }, transaction: t }
        );
      }

      await t.commit();
      await invalidate([...personalTags.all(dni), ...agenteTags.all(dni)], 'agente.update');
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  /**
   * Busca un agente completo por DNI (personal + datos laborales).
   */
  async findByDni(dni: number): Promise<any> {
    const rows = await this.sequelize.query(
      `SELECT p.*, a.ley_id, a.planta_id, a.categoria_id, a.funcion_id,
              a.ocupacion_id, a.regimen_horario_id, a.jefatura_id,
              a.sector_id, a.dependencia_id, a.fecha_ingreso, a.fecha_alta
       FROM personal p
       LEFT JOIN agentes a ON a.dni = p.dni
       WHERE p.dni = :dni AND p.deleted_at IS NULL LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT }
    );
    return rows[0] || null;
  }

  /** Alias for update() - for backward compatibility with PATCH routes */
  async patch(dni: number, dto: Partial<AltaAgenteDto>): Promise<void> {
    return this.update(dni, dto);
  }

}

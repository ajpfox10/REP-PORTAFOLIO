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
import { crearCarpetaDocuAgente } from './docuCarpeta.service';

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
  numerodomicilio?: number;
  piso?: number;
  depto?: string;
  cp?: string;
  observacionesdireccion?: string;
  localidad_id?: number;
  provincia_id?: string;
  nacionalidad?: string;
  mp?: string;
  observaciones?: string;

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
  reparticion_id?: number;
  fecha_ingreso?: string;
  fecha_egreso?: string;
  estado_empleo?: string;
  legajo?: number;
  salario_mensual?: number;
  decreto_designacion?: string;

  // Servicios adicionales (tabla: agentes_servicios)
  servicios?: Array<{
    servicio_id: number;
    sector_id?: number;
    fecha_desde?: string;
    fecha_hasta?: string;
  }>;

  // Metadata
  actor?: number;
}

export interface AltaAgenteResult {
  dni: number;
  agenteId?: number;
  /** Qué pasó con el destino (servicio/sector) al dar el alta. */
  continuidad?: {
    heredado: boolean;
    servicio_id?: number | null;
    sector_id?: number | null;
    /** Por qué no se heredó: hueco entre tramos o sin tramo previo. */
    motivo?: 'cargo_nuevo' | 'sin_tramo_previo';
    dias_hueco?: number | null;
    desde?: string;
  };
  /** Mensaje para mostrarle al operador cuando el agente quedó sin destino. */
  aviso?: string;
  /** Resultado de crear la carpeta del agente en DOCU (no bloquea el alta). */
  carpetaDocu?: {
    ok: boolean;
    carpeta?: string;
    creada?: boolean;
    subcarpetas?: number;
    motivo?: string;
  };
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
    // Continuidad de destino entre tramos (ver Paso 5)
    let continuidad: AltaAgenteResult['continuidad'] = undefined;
    let avisoCargoNuevo: string | null = null;

    try {
      if (dto.fecha_egreso && (dto.estado_empleo || 'ACTIVO') === 'ACTIVO') {
        throw Object.assign(
          new Error('Una vinculacion con fecha de egreso no puede permanecer ACTIVO. Seleccione INACTIVO, BAJA, COMISION o TRAMITE.'),
          { status: 400 }
        );
      }

      // Una nueva vinculacion solo es valida si no existe otra activa.
      const agenteVigente = await this.sequelize.query<{ id: number; estado_empleo: string }>(
        `SELECT id, estado_empleo FROM agentes
         WHERE dni = :dni AND deleted_at IS NULL
           AND estado_empleo = 'ACTIVO' AND fecha_egreso IS NULL
         ORDER BY id DESC LIMIT 1`,
        { replacements: { dni: dto.dni }, type: QueryTypes.SELECT, transaction: t }
      );
      if (agenteVigente.length > 0) {
        throw Object.assign(
          new Error(
            `El agente con DNI ${dto.dni} ya tiene una vinculacion activa. ` +
            `Debe editarla o registrar la baja antes de crear un reingreso.`
          ),
          { status: 409 }
        );
      }

      // Paso 2: Insertar en personal solo si no existe aún
      const personalExistente = await this.sequelize.query<{ dni: number }>(
        'SELECT dni FROM personal WHERE dni = :dni LIMIT 1',
        { replacements: { dni: dto.dni }, type: QueryTypes.SELECT, transaction: t }
      );
      if (personalExistente.length === 0) {
        await this.sequelize.query(
          `INSERT INTO personal
           (dni, apellido, nombre, fecha_nacimiento, sexo_id, cuil, email, telefono, domicilio,
            numerodomicilio, piso, depto, cp, observacionesdireccion, localidad_id, provincia_id,
            nacionalidad, mp, observaciones, created_by, created_at, updated_at)
           VALUES (:dni, :apellido, :nombre, :fecha_nacimiento, :sexo_id, :cuil, :email, :telefono, :domicilio,
                   :numerodomicilio, :piso, :depto, :cp, :observacionesdireccion, :localidad_id, :provincia_id,
                   :nacionalidad, :mp, :observaciones, :actor, NOW(), NOW())`,
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
              numerodomicilio: dto.numerodomicilio ?? null,
              piso: dto.piso ?? null,
              depto: dto.depto || null,
              cp: dto.cp || null,
              observacionesdireccion: dto.observacionesdireccion || null,
              localidad_id: dto.localidad_id || null,
              provincia_id: dto.provincia_id || null,
              nacionalidad: dto.nacionalidad || null,
              mp: dto.mp || null,
              observaciones: dto.observaciones || null,
              actor: dto.actor || null,
            },
            transaction: t,
          }
        );
      } else {
        await this.sequelize.query(
          `UPDATE personal SET apellido = :apellido, nombre = :nombre, fecha_nacimiento = :fecha_nacimiento,
             sexo_id = :sexo_id, cuil = :cuil, email = :email, telefono = :telefono,
             domicilio = :domicilio, numerodomicilio = :numerodomicilio, piso = :piso, depto = :depto,
             cp = :cp, observacionesdireccion = :observacionesdireccion,
             localidad_id = :localidad_id, provincia_id = :provincia_id, nacionalidad = :nacionalidad,
             mp = :mp, observaciones = :observaciones, updated_by = :actor, updated_at = NOW()
           WHERE dni = :dni AND deleted_at IS NULL`,
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
              numerodomicilio: dto.numerodomicilio ?? null,
              piso: dto.piso ?? null,
              depto: dto.depto || null,
              cp: dto.cp || null,
              observacionesdireccion: dto.observacionesdireccion || null,
              localidad_id: dto.localidad_id || null,
              provincia_id: dto.provincia_id || null,
              nacionalidad: dto.nacionalidad || null,
              mp: dto.mp || null,
              observaciones: dto.observaciones || null,
              actor: dto.actor || null,
            },
            transaction: t,
          }
        );
      }

      // Paso 3: Insertar en agentes (datos laborales)
      const [agenteResult]: any = await this.sequelize.query(
        `INSERT INTO agentes
         (dni, ley_id, planta_id, categoria_id, funcion_id, ocupacion_id, regimen_horario_id,
          jefatura_id, fecha_ingreso, fecha_egreso,
          estado_empleo, legajo, salario_mensual, decreto_designacion, created_by, created_at, updated_at)
         VALUES (:dni, :ley_id, :planta_id, :categoria_id, :funcion_id, :ocupacion_id, :regimen_horario_id,
                 :jefatura_id, :fecha_ingreso, :fecha_egreso,
                 :estado_empleo, :legajo, :salario_mensual, :decreto_designacion, :actor, NOW(), NOW())`,
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
            fecha_ingreso: dto.fecha_ingreso || null,
            fecha_egreso: dto.fecha_egreso || null,
            estado_empleo: dto.estado_empleo || 'ACTIVO',
            legajo: dto.legajo || null,
            salario_mensual: dto.salario_mensual ?? null,
            decreto_designacion: dto.decreto_designacion || null,
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
            `INSERT INTO agentes_servicios
             (dni, servicio_id, fecha_desde, fecha_hasta, created_by, created_at, updated_at)
             VALUES (:dni, :servicio_id, :fecha_desde, :fecha_hasta, :actor, NOW(), NOW())`,
            {
              replacements: {
                dni: dto.dni,
                servicio_id: srv.servicio_id,
                fecha_desde: srv.fecha_desde || dto.fecha_ingreso || null,
                fecha_hasta: srv.fecha_hasta || null,
                actor: dto.actor || null,
              },
              transaction: t,
            }
          );
          // El sector no vive en agentes_servicios: su unica fuente es agentes_sectores.
          if (srv.sector_id) {
            await this.sequelize.query(
              `INSERT INTO agentes_sectores
               (dni, sector_id, servicio_id, fecha_desde, fecha_hasta, created_by, created_at, updated_at)
               VALUES (:dni, :sector_id, :servicio_id, :fecha_desde, :fecha_hasta, :actor, NOW(), NOW())`,
              {
                replacements: {
                  dni: dto.dni,
                  sector_id: srv.sector_id,
                  servicio_id: srv.servicio_id,
                  fecha_desde: srv.fecha_desde || dto.fecha_ingreso || null,
                  fecha_hasta: srv.fecha_hasta || null,
                  actor: dto.actor || null,
                },
                transaction: t,
              }
            );
          }
        }
      }

      // ── Paso 5: continuidad de destino ───────────────────────────────────
      // Si el alta no trae servicio y el agente ya tenia un tramo cerrado, el
      // destino se hereda SOLO si el alta arranca el dia siguiente al cierre
      // (tramos consecutivos, sin hueco). Cualquier hueco se considera un cargo
      // nuevo: no se hereda nada y se deja un aviso en alertas_agente.
      const traeServicio = !!dto.servicios?.some(s => s.servicio_id);
      if (!traeServicio && dto.fecha_ingreso) {
        const previo = (await this.sequelize.query(
          `SELECT ags.servicio_id, ags.jefe_nombre, ags.fecha_hasta,
                  DATEDIFF(:fecha_ingreso, ags.fecha_hasta) AS dias_hueco,
                  (SELECT asec.sector_id FROM agentes_sectores asec
                    WHERE asec.dni = ags.dni AND asec.deleted_at IS NULL
                    ORDER BY asec.fecha_hasta IS NULL DESC, asec.fecha_hasta DESC, asec.id DESC
                    LIMIT 1) AS sector_id
             FROM agentes_servicios ags
            WHERE ags.dni = :dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NOT NULL
              AND ags.servicio_id IS NOT NULL
            ORDER BY ags.fecha_hasta DESC, ags.id DESC LIMIT 1`,
          { replacements: { dni: dto.dni, fecha_ingreso: dto.fecha_ingreso },
            type: QueryTypes.SELECT, transaction: t }
        )) as any[];

        const prev = previo[0];
        const dias = prev ? Number(prev.dias_hueco) : null;

        if (prev && dias === 1) {
          // Consecutivo exacto: continua el mismo destino.
          await this.sequelize.query(
            `INSERT INTO agentes_servicios
             (dni, servicio_id, jefe_nombre, fecha_desde, fecha_hasta, motivo, observaciones, created_by, created_at, updated_at)
             VALUES (:dni, :servicio_id, :jefe_nombre, :fecha_desde, NULL,
                     'Continuidad de destino',
                     'Servicio y sector heredados del tramo anterior (cierre el dia previo al alta)',
                     :actor, NOW(), NOW())`,
            { replacements: {
                dni: dto.dni, servicio_id: prev.servicio_id,
                jefe_nombre: prev.jefe_nombre ?? null, fecha_desde: dto.fecha_ingreso, actor: dto.actor || null },
              transaction: t }
          );
          // El sector tambien vive en agentes_sectores, que es lo que usan el
          // organigrama, el fichero y los filtros: hay que reabrirlo ahi tambien.
          if (prev.sector_id) {
            await this.sequelize.query(
              `INSERT INTO agentes_sectores (dni, sector_id, fecha_desde, fecha_hasta, created_by, created_at, updated_at)
               SELECT :dni, :sector_id, :fecha_desde, NULL, :actor, NOW(), NOW()
                 WHERE NOT EXISTS (SELECT 1 FROM agentes_sectores
                                    WHERE dni = :dni AND fecha_hasta IS NULL AND deleted_at IS NULL)`,
              { replacements: { dni: dto.dni, sector_id: prev.sector_id, fecha_desde: dto.fecha_ingreso, actor: dto.actor || null },
                transaction: t }
            );
          }
          continuidad = { heredado: true, servicio_id: prev.servicio_id, sector_id: prev.sector_id ?? null };
        } else if (prev) {
          // Hay tramo anterior pero con hueco: es un cargo nuevo.
          continuidad = { heredado: false, motivo: 'cargo_nuevo', dias_hueco: dias, desde: String(prev.fecha_hasta).slice(0, 10) };
          avisoCargoNuevo = `El alta no es consecutiva al tramo anterior (cerro el ${String(prev.fecha_hasta).slice(0, 10)}, hueco de ${dias} dia(s)). Se tomo como cargo nuevo: hay que asignarle servicio y sector.`;
        } else {
          continuidad = { heredado: false, motivo: 'sin_tramo_previo' };
          avisoCargoNuevo = 'El alta no tiene servicio asignado y el agente no registra un tramo anterior. Hay que asignarle servicio y sector.';
        }
      }

      // Todo OK: confirmar la transaccion
      await t.commit();

      // El aviso va fuera de la transaccion: si falla, no debe voltear el alta.
      if (avisoCargoNuevo) {
        await this.sequelize.query(
          `INSERT INTO alertas_agente (dni, titulo, mensaje, urgente, activa, creado_por, created_at, updated_at)
           SELECT :dni, 'Falta destino', :mensaje, 0, 1, NULL, NOW(), NOW()
             WHERE NOT EXISTS (SELECT 1 FROM alertas_agente
                                WHERE dni = :dni AND titulo = 'Falta destino' AND activa = 1)`,
          { replacements: { dni: dto.dni, mensaje: avisoCargoNuevo } }
        ).catch(err => logger.warn({ msg: 'No se pudo crear la alerta de destino', dni: dto.dni, err: String(err) }));
        logger.warn({ msg: 'Alta sin destino asignado', dni: dto.dni, aviso: avisoCargoNuevo });
      }

      // Carpeta del agente en DOCU (D:\G\DOCU\<dni>) + subcarpetas por ley.
      // Va fuera de la transaccion y nunca lanza: si el disco no esta, el alta
      // igual queda hecha y solo se loguea el motivo.
      const carpetaDocu = await crearCarpetaDocuAgente(this.sequelize, dto.dni, agenteId);
      if (!carpetaDocu.ok) {
        logger.warn({ msg: 'No se pudo crear la carpeta DOCU del agente', dni: dto.dni, motivo: carpetaDocu.motivo });
      } else {
        logger.info({
          msg: 'Carpeta DOCU del agente lista',
          dni: dto.dni, carpeta: carpetaDocu.carpeta, creada: carpetaDocu.creada,
          ley: carpetaDocu.ley, subcarpetas: carpetaDocu.subcarpetas,
        });
      }

      // Invalida el cache del listado de personal
      await invalidate([...personalTags.all(dto.dni), ...agenteTags.all(dto.dni)], 'agente.alta');

      logger.info({ msg: 'Alta de agente exitosa', dni: dto.dni, agenteId, actor: dto.actor });

      return {
        dni: dto.dni,
        agenteId,
        continuidad,
        aviso: avisoCargoNuevo ?? undefined,
        carpetaDocu: {
          ok: carpetaDocu.ok,
          carpeta: carpetaDocu.carpeta,
          creada: carpetaDocu.creada,
          subcarpetas: carpetaDocu.subcarpetas,
          motivo: carpetaDocu.motivo,
        },
      };

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
      const agenteFields = ['ley_id', 'planta_id', 'categoria_id', 'funcion_id', 'ocupacion_id', 'regimen_horario_id', 'jefatura_id', 'fecha_ingreso'];
      const agenteUpdate = Object.fromEntries(
        Object.entries(dto).filter(([k]) => agenteFields.includes(k))
      );
      if (Object.keys(agenteUpdate).length > 0) {
        const vigente = await this.sequelize.query<{ id: number }>(
          `SELECT id FROM agentes
           WHERE dni = :dni AND deleted_at IS NULL
             AND estado_empleo = 'ACTIVO' AND fecha_egreso IS NULL
           ORDER BY id DESC LIMIT 1`,
          { replacements: { dni }, type: QueryTypes.SELECT, transaction: t }
        );
        if (!vigente[0]?.id) {
          throw Object.assign(
            new Error(`El DNI ${dni} no tiene una vinculacion activa. Registre un reingreso para preservar el historial.`),
            { status: 409 }
          );
        }
        const setClauses = Object.keys(agenteUpdate).map(k => `${k} = :${k}`).join(', ');
        await this.sequelize.query(
          `UPDATE agentes SET ${setClauses}, updated_at = NOW() WHERE id = :agenteId`,
          { replacements: { ...agenteUpdate, agenteId: vigente[0].id }, transaction: t }
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
              (SELECT r_dep.dependencia_id
                 FROM agentes_servicios ags_dep
                 LEFT JOIN servicios s_dep ON s_dep.id = ags_dep.servicio_id AND s_dep.deleted_at IS NULL
                 LEFT JOIN reparticiones r_dep ON r_dep.id = s_dep.reparticion_id AND r_dep.deleted_at IS NULL
                WHERE ags_dep.dni = p.dni AND ags_dep.deleted_at IS NULL AND ags_dep.fecha_hasta IS NULL
                ORDER BY ags_dep.id DESC LIMIT 1) AS dependencia_id,
              a.fecha_ingreso
       FROM personal p
       LEFT JOIN agentes a ON a.id = (
         SELECT ax.id FROM agentes ax
         WHERE ax.dni = p.dni AND ax.deleted_at IS NULL
         ORDER BY (ax.estado_empleo = 'ACTIVO' AND ax.fecha_egreso IS NULL) DESC, ax.id DESC
         LIMIT 1
       )
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

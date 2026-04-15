// src/routes/legajo.routes.ts
// Legajo Personal — formulario oficial Provincia de Buenos Aires / Ministerio de Salud
// Provee todos los datos de las 16 páginas del legajo, combinando tablas existentes
// con las nuevas tablas legajo_*.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDMY(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

function userInfo(req: Request) {
  return (req as any).user?.id ?? null;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function buildLegajoRouter(sequelize: Sequelize): Router {
  const router = Router();
  const read  = requirePermission('crud:*:read');
  const write = requirePermission('crud:*:*');

  // ══════════════════════════════════════════════════════════════════
  //  GET /legajo/:dni  — carga completa del legajo (todas las páginas)
  // ══════════════════════════════════════════════════════════════════
  router.get('/:dni', read, async (req: Request, res: Response) => {
    const dni = Number(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });

    try {
      const [
        personales, personal, agente, servicios,
        bonificaciones, funcion_destino, licencias,
        concepto_menciones, penas, domicilios,
        incompatibilidad, embargos, bienes,
        familia, familia_exp,
      ] = await Promise.all([
        // Pág 01+02 — datos personales (personal es la fuente de nombre/apellido/cuil)
        sequelize.query(
          `SELECT pd.*,
                  p.apellido, p.nombre, p.cuil, p.telefono, p.email,
                  p.domicilio, p.nacionalidad, p.fecha_nacimiento as p_fecha_nacimiento,
                  p.numerodomicilio, p.depto, p.piso, p.cp, p.foto_path,
                  s.nombre  AS sexo_nombre,
                  l.localidad_nombre AS localidad_nombre,
                  cat.nombre AS categoria_nombre,
                  pla.nombre AS planta_nombre,
                  oc.nombre  AS ocupacion_nombre,
                  rh.nombre  AS regimen_horario_nombre
           FROM personaldetalle pd
           LEFT JOIN personal p         ON p.dni  = pd.dni
           LEFT JOIN sexos s            ON s.id   = p.sexo_id
           LEFT JOIN localidades l      ON l.id   = p.localidad_id
           LEFT JOIN categorias cat     ON cat.ID = pd.categoria_id
           LEFT JOIN plantas pla        ON pla.id = pd.planta_id
           LEFT JOIN ocupaciones oc     ON oc.id  = pd.categoria_id
           LEFT JOIN regimenes_horarios rh
             ON rh.id = (SELECT regimen_horario_id FROM agentes WHERE dni = pd.dni LIMIT 1)
           WHERE pd.dni = :dni LIMIT 1`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // personal base
        sequelize.query(
          `SELECT * FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 06 — agente (foja de servicios base)
        sequelize.query(
          `SELECT a.*,
                  f.nombre   AS funcion_nombre,
                  se.nombre  AS servicio_nombre,
                  cat.nombre AS categoria_nombre,
                  pla.nombre AS planta_nombre,
                  rh.nombre  AS regimen_horario_nombre,
                  dep.nombre AS dependencia_nombre,
                  rep.reparticion_nombre AS reparticion_nombre
           FROM agentes a
           LEFT JOIN funciones        f   ON f.id    = a.funcion_id
           LEFT JOIN servicios        se  ON se.id   = a.servicio_id
           LEFT JOIN categorias       cat ON cat.ID  = a.categoria_id
           LEFT JOIN plantas          pla ON pla.id  = a.planta_id
           LEFT JOIN regimenes_horarios rh ON rh.id  = a.regimen_horario_id
           LEFT JOIN dependencias     dep ON dep.id  = a.dependencia_id
           LEFT JOIN reparticiones    rep ON rep.id  = a.reparticion_id
           WHERE a.dni = :dni AND a.deleted_at IS NULL
           ORDER BY a.fecha_ingreso DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 06 — historial de servicios
        sequelize.query(
          `SELECT as2.*, dep.nombre as dependencia_nombre, se.nombre as servicio_nombre
           FROM agentes_servicios as2
           LEFT JOIN dependencias dep ON dep.id = as2.dependencia_id
           LEFT JOIN servicios se ON se.id = as2.servicio_id
           WHERE as2.dni = :dni AND as2.deleted_at IS NULL
           ORDER BY as2.fecha_desde DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 07 — bonificaciones
        sequelize.query(
          `SELECT * FROM bonificaciones WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 08 — función y destino
        sequelize.query(
          `SELECT * FROM legajo_funcion_destino WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha_ingreso DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 09 — licencias
        sequelize.query(
          `SELECT * FROM legajo_licencias WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 11 — concepto y menciones
        sequelize.query(
          `SELECT * FROM legajo_concepto_menciones WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 12 — penas disciplinarias
        sequelize.query(
          `SELECT * FROM legajo_penas_disciplinarias WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 13 — domicilios (historial desde expedientes)
        sequelize.query(
          `SELECT * FROM expedientes WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 14 — incompatibilidad
        sequelize.query(
          `SELECT * FROM legajo_incompatibilidad WHERE dni = :dni AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 15 — embargos
        sequelize.query(
          `SELECT * FROM legajo_embargos WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 16 — declaración de bienes
        sequelize.query(
          `SELECT * FROM legajo_declaracion_bienes WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 04 — familia
        sequelize.query(
          `SELECT * FROM legajo_familia WHERE dni = :dni AND deleted_at IS NULL ORDER BY parentesco`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
        // Pág 05 — expedientes familia
        sequelize.query(
          `SELECT * FROM legajo_familia_expedientes WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha_informe DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        ),
      ]);

      const pd = (personales as any[])[0] ?? null;
      if (!pd) return res.status(404).json({ ok: false, error: 'Agente no encontrado' });

      return res.json({
        ok: true,
        data: {
          // Pág 01+02 — portada + datos personales
          datosPersonales: pd,
          // Pág 04+05 — familia
          familia:            familia as any[],
          familiaExpedientes: familia_exp as any[],
          // Pág 06 — foja de servicios
          agente:    (agente as any[])[0] ?? null,
          servicios: servicios as any[],
          // Pág 07 — bonificaciones
          bonificaciones: bonificaciones as any[],
          // Pág 08 — función y destino
          funcionDestino: funcion_destino as any[],
          // Pág 09 — licencias
          licencias: licencias as any[],
          // Pág 11 — concepto y menciones
          conceptoMenciones: concepto_menciones as any[],
          // Pág 12 — penas disciplinarias
          penas: penas as any[],
          // Pág 13 — domicilios
          domicilios: domicilios as any[],
          // Pág 14 — incompatibilidad
          incompatibilidad: (incompatibilidad as any[])[0] ?? null,
          // Pág 15 — embargos
          embargos: embargos as any[],
          // Pág 16 — declaración de bienes
          declaracionBienes: bienes as any[],
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  CRUD genérico para cada sección
  // ══════════════════════════════════════════════════════════════════

  // Helper: CRUD para tabla legajo_*
  function crudSection(
    table: string,
    fields: string[],
    orderBy = 'id DESC'
  ) {
    // GET lista
    router.get(`/seccion/${table}/:dni`, read, async (req: Request, res: Response) => {
      const dni = Number(req.params.dni);
      const [rows] = await sequelize.query(
        `SELECT * FROM \`${table}\` WHERE dni = :dni AND deleted_at IS NULL ORDER BY ${orderBy}`,
        { replacements: { dni } }
      );
      return res.json({ ok: true, data: rows });
    });

    // POST crear
    router.post(`/seccion/${table}`, write, async (req: Request, res: Response) => {
      const body = req.body as Record<string, any>;
      const cols = fields.filter(f => body[f] !== undefined);
      if (!cols.length || !body.dni) return res.status(400).json({ ok: false, error: 'Datos insuficientes' });
      const allCols = ['dni', ...cols, 'created_by'];
      const vals    = [body.dni, ...cols.map(c => body[c] ?? null), userInfo(req)];
      const placeholders = allCols.map(() => '?').join(', ');
      await sequelize.query(
        `INSERT INTO \`${table}\` (${allCols.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
        { replacements: vals }
      );
      return res.json({ ok: true });
    });

    // PUT actualizar
    router.put(`/seccion/${table}/:id`, write, async (req: Request, res: Response) => {
      const id   = Number(req.params.id);
      const body = req.body as Record<string, any>;
      const cols = fields.filter(f => body[f] !== undefined);
      if (!cols.length) return res.status(400).json({ ok: false, error: 'Sin campos' });
      const set  = [...cols.map(c => `\`${c}\` = ?`), '`updated_by` = ?'].join(', ');
      const vals = [...cols.map(c => body[c] ?? null), userInfo(req), id];
      await sequelize.query(
        `UPDATE \`${table}\` SET ${set} WHERE id = ?`,
        { replacements: vals }
      );
      return res.json({ ok: true });
    });

    // DELETE soft
    router.delete(`/seccion/${table}/:id`, write, async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      await sequelize.query(
        `UPDATE \`${table}\` SET deleted_at = NOW(), updated_by = ? WHERE id = ?`,
        { replacements: [userInfo(req), id] }
      );
      return res.json({ ok: true });
    });
  }

  crudSection('legajo_familia', [
    'parentesco','codigo','apellido_nombres','sexo','vive',
    'fecha_nacimiento','es_empleado','es_jubilado','observaciones'
  ], 'parentesco');

  crudSection('legajo_familia_expedientes', [
    'expediente','fecha_informe','motivo','observacion'
  ], 'fecha_informe DESC');

  crudSection('legajo_funcion_destino', [
    'funcion','destino','resolucion','fecha_ingreso','fecha_egreso','observaciones'
  ], 'fecha_ingreso DESC');

  crudSection('legajo_licencias', [
    'resolucion','fecha','motivo','termino',
    'a_partir_dia','a_partir_mes','a_partir_anio',
    'con_sueldo','con_50pct','sin_sueldo','observaciones'
  ], 'fecha DESC');

  crudSection('legajo_concepto_menciones', [
    'fecha','referencias'
  ], 'fecha DESC');

  crudSection('legajo_penas_disciplinarias', [
    'expediente_letra','expediente_nro','expediente_anio',
    'decreto_resolucion','fecha','calidad_pena','motivo','observaciones'
  ], 'fecha DESC');

  crudSection('legajo_incompatibilidad', [
    'tiene_jubilacion','jubilacion_ley','jubilacion_caja','jubilacion_monto','jubilacion_fecha',
    'otro_cargo','otro_cargo_nivel','otro_cargo_lugar','otro_cargo_monto','otro_cargo_fecha_ingreso',
    'otras_actividades','otras_actividades_lugar','otras_actividades_monto','otras_actividades_fecha',
    'observaciones','fecha_declaracion'
  ], 'created_at DESC');

  crudSection('legajo_embargos', [
    'expediente','fecha','suma_embargada','autoridad','ejecutante','fecha_levantamiento','observaciones'
  ], 'fecha DESC');

  crudSection('legajo_declaracion_bienes', [
    'descripcion','fecha'
  ], 'fecha DESC');

  return router;
}

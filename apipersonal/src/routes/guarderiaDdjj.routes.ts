// src/routes/guarderiaDdjj.routes.ts
// DDJJ para Reintegro de Guardería y/o Jardín Maternal (página Guardería y Salario).
// Lo cargado en el modal se guarda (1 DDJJ por DNI + sus menores) y se imprime sobre el
// PDF original del Ministerio (services/guarderiaDdjjPdf.ts).
//   GET  /guarderia-ddjj/:dni      → DDJJ guardada, o precarga desde personal/agentes/legajo
//   PUT  /guarderia-ddjj/:dni      → alta o edición (reemplaza los menores)
//   GET  /guarderia-ddjj/:dni/pdf  → PDF de lo guardado
//   POST /guarderia-ddjj/importar-formulario/{preview,confirmar} → respuestas del Google Form

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes, Transaction } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { generarGuarderiaDdjjPdf } from '../services/guarderiaDdjjPdf';
import { registrarImportFormularioDdjj } from './guarderiaDdjjImportForm';

// ─── Tablas (mig 069) ─────────────────────────────────────────────────────────
// Se crean solas al levantar la API; espejo en scripts/migrations/069__guarderia_ddjj.sql

const TABLAS: [string, string][] = [
  ['guarderia_ddjj', `
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    dni INT NOT NULL,
    reparticion VARCHAR(200) NULL,
    apellido_nombre VARCHAR(200) NULL,
    documento VARCHAR(20) NULL,
    fecha_nacimiento DATE NULL,
    estado_civil VARCHAR(40) NULL,
    nacionalidad VARCHAR(80) NULL,
    cargo VARCHAR(150) NULL,
    horario VARCHAR(100) NULL,
    legajo VARCHAR(30) NULL,
    domicilio VARCHAR(250) NULL,
    fecha_reintegro DATE NULL,
    ninos_a_cargo VARCHAR(150) NULL,
    condicion_tutela VARCHAR(250) NULL,
    motivo_no_ingresa VARCHAR(300) NULL,
    otro_apellido_nombre VARCHAR(200) NULL,
    otro_domicilio VARCHAR(250) NULL,
    otro_documento VARCHAR(20) NULL,
    otro_fecha_nacimiento DATE NULL,
    otro_estado_civil VARCHAR(40) NULL,
    otro_nacionalidad VARCHAR(80) NULL,
    otro_lugar_trabajo VARCHAR(200) NULL,
    firma_aclaracion VARCHAR(150) NULL,
    lugar VARCHAR(100) NULL,
    fecha DATE NULL,
    certifica_pertenece VARCHAR(150) NULL,
    certifica_aclaracion VARCHAR(150) NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT NULL, updated_by INT NULL,
    UNIQUE KEY ux_guarderia_ddjj_dni (dni),
    CONSTRAINT fk_guarderia_ddjj_dni FOREIGN KEY (dni) REFERENCES personal(dni)
      ON DELETE RESTRICT ON UPDATE CASCADE`],
  ['guarderia_ddjj_menores', `
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ddjj_id INT NOT NULL,
    dni INT NOT NULL,
    orden TINYINT NOT NULL DEFAULT 1,
    apellido_nombre VARCHAR(200) NULL,
    documento VARCHAR(20) NULL,
    fecha_nacimiento DATE NULL,
    patologia TINYINT(1) NULL,
    atencion_temporaria VARCHAR(150) NULL,
    atencion_permanente VARCHAR(150) NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_guarderia_ddjj_menores_ddjj (ddjj_id),
    KEY ix_guarderia_ddjj_menores_dni (dni),
    CONSTRAINT fk_guarderia_ddjj_menores_ddjj FOREIGN KEY (ddjj_id) REFERENCES guarderia_ddjj(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_guarderia_ddjj_menores_dni FOREIGN KEY (dni) REFERENCES personal(dni)
      ON DELETE RESTRICT ON UPDATE CASCADE`],
];

async function ensureTablas(sequelize: Sequelize): Promise<void> {
  for (const [tabla, cols] of TABLAS) {
    try {
      await sequelize.query(
        `CREATE TABLE IF NOT EXISTS \`${tabla}\` (${cols}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
      );
    } catch (e: any) {
      logger.error({ msg: `guarderia-ddjj: error creando ${tabla}`, error: e?.message });
    }
  }
}

const CAMPOS = [
  'reparticion', 'apellido_nombre', 'documento', 'fecha_nacimiento', 'estado_civil', 'nacionalidad',
  'cargo', 'horario', 'legajo', 'domicilio', 'fecha_reintegro', 'ninos_a_cargo', 'condicion_tutela',
  'motivo_no_ingresa',
  'otro_apellido_nombre', 'otro_domicilio', 'otro_documento', 'otro_fecha_nacimiento',
  'otro_estado_civil', 'otro_nacionalidad', 'otro_lugar_trabajo',
  'firma_aclaracion', 'lugar', 'fecha', 'certifica_pertenece', 'certifica_aclaracion',
];
const CAMPOS_MENOR = [
  'apellido_nombre', 'documento', 'fecha_nacimiento', 'patologia', 'atencion_temporaria', 'atencion_permanente',
];
const FECHAS = new Set(['fecha_nacimiento', 'fecha_reintegro', 'otro_fecha_nacimiento', 'fecha']);

// '' → NULL, fechas → YYYY-MM-DD, booleanos → 0/1
function limpiar(col: string, v: any): any {
  if (v === '' || v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (FECHAS.has(col)) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
    return m ? m[1] : null;
  }
  return typeof v === 'string' ? v.trim() : v;
}

const ymd = (v: any): string | null => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
};

export function buildGuarderiaDdjjRouter(sequelize: Sequelize): Router {
  const router = Router();
  const read  = requirePermission('crud:*:read');
  const write = requirePermission('crud:*:*');
  const ready = ensureTablas(sequelize);

  async function guardada(dni: number): Promise<{ ddjj: any; menores: any[] } | null> {
    await ready;
    const [ddjj] = await sequelize.query<any>(
      `SELECT * FROM guarderia_ddjj WHERE dni = :dni LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT });
    if (!ddjj) return null;
    const menores = await sequelize.query<any>(
      `SELECT * FROM guarderia_ddjj_menores WHERE ddjj_id = :id ORDER BY orden, id`,
      { replacements: { id: ddjj.id }, type: QueryTypes.SELECT });
    for (const k of FECHAS) if (k in ddjj) ddjj[k] = ymd(ddjj[k]);
    menores.forEach(m => { m.fecha_nacimiento = ymd(m.fecha_nacimiento); });
    return { ddjj, menores };
  }

  // Fecha de reintegro según el anual del Ministerio (robot intranet_descarga_anual):
  // fin del RN1-RECIEN NACIDO (cuidado extendido) + 1; sin RN1, fin de 06-POR MATERNIDAD + 1.
  // El RN1 va pegado después de la maternidad: el último por fecha_hasta es el del episodio actual
  // (así un RN1 de un hijo anterior no le gana a una maternidad nueva todavía sin RN1).
  async function reintegroMinisterio(dni: number): Promise<{ fecha: string; novedad: string; hasta: string } | null> {
    const [r] = await sequelize.query<any>(
      `SELECT novedad, fecha_hasta, DATE_ADD(fecha_hasta, INTERVAL 1 DAY) AS reintegro
       FROM ministerio_novedades_anual
       WHERE dni = :dni AND codigo IN ('RN1', '06') AND fecha_hasta IS NOT NULL
       ORDER BY fecha_hasta DESC, (codigo = 'RN1') DESC LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT }).catch(() => [] as any[]);  // tabla aún no creada
    if (!r) return null;
    return { fecha: ymd(r.reintegro)!, novedad: r.novedad, hasta: ymd(r.fecha_hasta)! };
  }

  // Precarga desde lo que ya tiene el sistema (todo editable en el modal)
  async function precarga(dni: number): Promise<{ ddjj: any; menores: any[] } | null> {
    const [p] = await sequelize.query<any>(
      `SELECT p.dni, p.apellido, p.nombre, p.fecha_nacimiento, p.nacionalidad,
              p.domicilio, p.numerodomicilio, p.piso, p.depto,
              loc.localidad_nombre,
              ldp.estado_civil, ldp.nro_legajo, ldp.reparticion AS ldp_reparticion,
              av.legajo, oc.nombre AS ocupacion, rh.nombre AS regimen_horario,
              rep.reparticion_nombre
       FROM personal p
       LEFT JOIN localidades loc ON loc.id = p.localidad_id
       LEFT JOIN legajo_datos_personales ldp ON ldp.dni = p.dni
       LEFT JOIN agentes av ON av.id = (
         SELECT ax.id FROM agentes ax
         WHERE ax.dni = p.dni AND ax.deleted_at IS NULL
         ORDER BY (ax.estado_empleo = 'ACTIVO' AND ax.fecha_egreso IS NULL) DESC, ax.id DESC
         LIMIT 1)
       LEFT JOIN ocupaciones oc ON oc.id = av.ocupacion_id
       LEFT JOIN regimenes_horarios rh ON rh.id = av.regimen_horario_id
       LEFT JOIN agentes_servicios ags ON ags.id = (
         SELECT id FROM agentes_servicios WHERE dni = p.dni AND deleted_at IS NULL AND fecha_hasta IS NULL
         ORDER BY id DESC LIMIT 1)
       LEFT JOIN servicios se ON se.id = ags.servicio_id
       LEFT JOIN reparticiones rep ON rep.id = se.reparticion_id AND rep.deleted_at IS NULL
       WHERE p.dni = :dni AND p.deleted_at IS NULL LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT });
    if (!p) return null;

    const calle = [p.domicilio, p.numerodomicilio].filter(Boolean).join(' ');
    const pisoDepto = [p.piso && `piso ${p.piso}`, p.depto && `dto ${p.depto}`].filter(Boolean).join(' ');
    const domicilio = [calle, pisoDepto, p.localidad_nombre].filter(Boolean).join(', ');
    const apellidoNombre = [p.apellido, p.nombre].filter(Boolean).join(', ');

    // Menores de hasta 4 años: hijos del legajo; si no hay, los nacimientos de guardería
    const hijos = await sequelize.query<any>(
      `SELECT apellido_nombres AS apellido_nombre, dni_familiar AS documento, fecha_nacimiento
       FROM legajo_familia
       WHERE dni = :dni AND deleted_at IS NULL AND parentesco LIKE 'HIJ%'
         AND (fecha_nacimiento IS NULL OR fecha_nacimiento >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR))
       ORDER BY fecha_nacimiento DESC`,
      { replacements: { dni }, type: QueryTypes.SELECT }).catch(() => [] as any[]);
    let menores = hijos.map(h => ({ ...h, fecha_nacimiento: ymd(h.fecha_nacimiento) }));
    if (!menores.length) {
      const nac = await sequelize.query<any>(
        `SELECT fecha_nacimiento FROM guarderia WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha_nacimiento DESC`,
        { replacements: { dni }, type: QueryTypes.SELECT });
      menores = nac.map(n => ({ apellido_nombre: null, documento: null, fecha_nacimiento: ymd(n.fecha_nacimiento) }));
    }

    return {
      ddjj: {
        dni: p.dni,
        reparticion: p.ldp_reparticion || p.reparticion_nombre || null,
        apellido_nombre: apellidoNombre || null,
        documento: String(p.dni),
        fecha_nacimiento: ymd(p.fecha_nacimiento),
        estado_civil: p.estado_civil || null,
        nacionalidad: p.nacionalidad || null,
        cargo: p.ocupacion || null,
        // el régimen viene como "48" → "48 HS SEMANALES"
        horario: /^\d+$/.test(String(p.regimen_horario ?? '')) ? `${p.regimen_horario} HS SEMANALES` : (p.regimen_horario || null),
        legajo: p.nro_legajo || p.legajo || null,
        domicilio: domicilio || null,
        firma_aclaracion: apellidoNombre || null,
        fecha: new Date().toISOString().slice(0, 10),
      },
      menores,
    };
  }

  // GET /guarderia-ddjj/:dni
  router.get('/:dni', read, async (req: Request, res: Response) => {
    const dni = Number(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });
    try {
      const reintegro = await reintegroMinisterio(dni);
      const g = await guardada(dni);
      if (g) return res.json({ ok: true, guardada: true, data: g, reintegro });
      const pre = await precarga(dni);
      if (!pre) return res.status(404).json({ ok: false, error: 'Agente no encontrado' });
      if (reintegro) pre.ddjj.fecha_reintegro = reintegro.fecha;
      return res.json({ ok: true, guardada: false, data: pre, reintegro });
    } catch (err: any) {
      logger.error({ msg: 'guarderia-ddjj: error leyendo', dni, error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // Alta o edición de la DDJJ completa (reemplaza los menores). La usan el PUT y el importador.
  async function grabar(dni: number, body: Record<string, any>, uid: number | null): Promise<void> {
    await ready;
    const menores: any[] = Array.isArray(body.menores) ? body.menores : [];
    const vals = CAMPOS.map(c => limpiar(c, body[c]));
    await sequelize.transaction(async (t: Transaction) => {
      await sequelize.query(
        `INSERT INTO guarderia_ddjj (dni, ${CAMPOS.join(', ')}, created_by, updated_by)
         VALUES (?, ${CAMPOS.map(() => '?').join(', ')}, ?, ?)
         ON DUPLICATE KEY UPDATE ${CAMPOS.map(c => `${c} = VALUES(${c})`).join(', ')}, updated_by = VALUES(updated_by)`,
        { replacements: [dni, ...vals, uid, uid], transaction: t });
      const [row] = await sequelize.query<any>(
        `SELECT id FROM guarderia_ddjj WHERE dni = ?`,
        { replacements: [dni], type: QueryTypes.SELECT, transaction: t });
      await sequelize.query(`DELETE FROM guarderia_ddjj_menores WHERE ddjj_id = ?`,
        { replacements: [row.id], transaction: t });
      let orden = 0;
      for (const m of menores) {
        const mv = CAMPOS_MENOR.map(c => limpiar(c, m?.[c]));
        if (mv.every(v => v === null)) continue;
        orden++;
        await sequelize.query(
          `INSERT INTO guarderia_ddjj_menores (ddjj_id, dni, orden, ${CAMPOS_MENOR.join(', ')})
           VALUES (?, ?, ?, ${CAMPOS_MENOR.map(() => '?').join(', ')})`,
          { replacements: [row.id, dni, orden, ...mv], transaction: t });
      }
    });
  }

  // Importador del formulario de Google (POST /importar-formulario/preview|confirmar)
  registrarImportFormularioDdjj(router, sequelize, write, { guardada, precarga, reintegroMinisterio, grabar });

  // PUT /guarderia-ddjj/:dni  body: { ...campos, menores: [...] }
  router.put('/:dni', write, async (req: Request, res: Response) => {
    const dni = Number(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });
    const uid = (req as any).user?.id ?? null;
    try {
      await grabar(dni, (req.body ?? {}) as Record<string, any>, uid);
      return res.json({ ok: true, data: await guardada(dni) });
    } catch (err: any) {
      logger.error({ msg: 'guarderia-ddjj: error guardando', dni, error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // GET /guarderia-ddjj/:dni/pdf
  router.get('/:dni/pdf', read, async (req: Request, res: Response) => {
    const dni = Number(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });
    try {
      const g = await guardada(dni);
      if (!g) return res.status(404).json({ ok: false, error: 'La DDJJ no está guardada' });
      const pdf = await generarGuarderiaDdjjPdf(g.ddjj, g.menores);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="ddjj_guarderia_${dni}.pdf"`);
      return res.send(Buffer.from(pdf));
    } catch (err: any) {
      logger.error({ msg: 'guarderia-ddjj: error generando PDF', dni, error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}

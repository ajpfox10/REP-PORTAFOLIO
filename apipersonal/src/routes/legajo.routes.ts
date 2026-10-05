// src/routes/legajo.routes.ts
// Legajo Personal — formulario oficial Provincia de Buenos Aires / Ministerio de Salud
// Provee todos los datos de las 16 páginas del legajo, combinando tablas existentes
// con las nuevas tablas legajo_*.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { registrarImportFormulario } from './legajoImportForm';
import { generarLegajoPdf } from '../services/legajoPdf';

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

// ─── Tablas (mig 062) ─────────────────────────────────────────────────────────
// Se crean solas al levantar la API; espejo en scripts/migrations/062__legajo_formulario_completo.sql

const STD_COLS = `
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL`;

const TABLAS_NUEVAS: Record<string, string> = {
  legajo_datos_personales: `
    dni INT NOT NULL PRIMARY KEY,
    nro_legajo VARCHAR(30) NULL, reparticion VARCHAR(200) NULL,
    nac_pais VARCHAR(100) NULL, nac_provincia VARCHAR(100) NULL, nac_partido VARCHAR(150) NULL,
    estado_civil VARCHAR(20) NULL,
    clase VARCHAR(10) NULL, dist_militar VARCHAR(60) NULL,
    cedula_nro VARCHAR(30) NULL, cedula_expedida_por VARCHAR(150) NULL,
    carta_ciudadania VARCHAR(60) NULL, carta_otorgada_en VARCHAR(150) NULL,
    carta_fecha DATE NULL, carta_juez_federal VARCHAR(150) NULL,
    estudios_nivel VARCHAR(30) NULL, estudios_detalle VARCHAR(250) NULL,
    titulo_secundario VARCHAR(200) NULL, titulo_secundario_otorgado VARCHAR(200) NULL,
    titulo_universitario VARCHAR(200) NULL, titulo_universitario_otorgado VARCHAR(200) NULL,
    aptitud_especial VARCHAR(250) NULL,
    mil_presto TINYINT(1) NULL, mil_arma VARCHAR(100) NULL, mil_especialidad VARCHAR(100) NULL,
    mil_grado VARCHAR(100) NULL, mil_destino VARCHAR(150) NULL, mil_motivo_excepcion VARCHAR(200) NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT NULL, updated_by INT NULL`,
  legajo_rectificaciones: `
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, dni INT NOT NULL,
    seccion ENUM('FILIACION','IDENTIDAD','APTITUD') NOT NULL,
    fecha DATE NULL, norma_legal VARCHAR(150) NULL, texto TEXT NULL,${STD_COLS},
    KEY ix_legajo_rectificaciones_dni (dni)`,
  legajo_foja_servicios: `
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, dni INT NOT NULL,
    resolucion VARCHAR(120) NULL, fecha_ingreso DATE NULL, ministerio VARCHAR(150) NULL,
    dependencia VARCHAR(200) NULL, cargo VARCHAR(200) NULL, grupo_ocupacional VARCHAR(20) NULL,
    categoria VARCHAR(30) NULL, regimen_horario VARCHAR(60) NULL,
    fecha_baja DATE NULL, motivo VARCHAR(300) NULL,${STD_COLS},
    KEY ix_legajo_foja_servicios_dni (dni)`,
  legajo_licencias_06: `
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, dni INT NOT NULL,
    codigo_trabajo VARCHAR(2) NULL, concepto VARCHAR(2) NULL DEFAULT '06', subconcepto VARCHAR(2) NULL,
    inciso VARCHAR(1) NULL, legajo_contaduria VARCHAR(7) NULL,
    norma_codigo VARCHAR(1) NULL, norma_numero VARCHAR(5) NULL, norma_anio VARCHAR(4) NULL,
    fecha_desde DATE NULL, fecha_hasta DATE NULL,
    dias_con_sueldo SMALLINT NULL, dias_50 SMALLINT NULL, dias_sin_sueldo SMALLINT NULL,
    acum_con_sueldo SMALLINT NULL, acum_50 SMALLINT NULL, acum_sin_sueldo SMALLINT NULL,
    observaciones TEXT NULL,${STD_COLS},
    KEY ix_legajo_licencias_06_dni (dni)`,
  legajo_domicilios: `
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, dni INT NOT NULL,
    expediente VARCHAR(100) NULL, fecha DATE NULL, calle_numero VARCHAR(250) NULL,
    telefono VARCHAR(60) NULL, partido VARCHAR(150) NULL, localidad VARCHAR(150) NULL,
    codigo_partido VARCHAR(20) NULL, codigo_localidad VARCHAR(20) NULL,${STD_COLS},
    KEY ix_legajo_domicilios_dni (dni)`,
};

const COLUMNAS_NUEVAS: [string, string, string][] = [
  ['legajo_incompatibilidad', 'jubilacion_tipo',    'VARCHAR(20) NULL'],
  ['legajo_incompatibilidad', 'cargo_nacional',     'VARCHAR(250) NULL'],
  ['legajo_incompatibilidad', 'cargo_provincial',   'VARCHAR(250) NULL'],
  ['legajo_incompatibilidad', 'cargo_municipal',    'VARCHAR(250) NULL'],
  ['legajo_incompatibilidad', 'otro_cargo_horario', 'VARCHAR(200) NULL'],
  ['legajo_familia',          'dni_familiar',       'VARCHAR(15) NULL'],
];

// Todas las legajo_* cuelgan de personal(dni)
const TABLAS_CON_FK = [
  ...Object.keys(TABLAS_NUEVAS),
  'legajo_familia', 'legajo_familia_expedientes', 'legajo_funcion_destino', 'legajo_licencias',
  'legajo_concepto_menciones', 'legajo_penas_disciplinarias', 'legajo_incompatibilidad',
  'legajo_embargos', 'legajo_declaracion_bienes',
];

async function ensureLegajoTables(sequelize: Sequelize): Promise<void> {
  for (const [tabla, cols] of Object.entries(TABLAS_NUEVAS)) {
    try {
      await sequelize.query(
        `CREATE TABLE IF NOT EXISTS \`${tabla}\` (${cols}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
      );
    } catch (e: any) {
      logger.error({ msg: `legajo: error creando ${tabla}`, error: e?.message });
    }
  }
  for (const [tabla, col, def] of COLUMNAS_NUEVAS) {
    try {
      const r = await sequelize.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        { replacements: [tabla, col], type: QueryTypes.SELECT }
      );
      if (!r.length) await sequelize.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${col}\` ${def}`);
    } catch (e: any) {
      logger.error({ msg: `legajo: error agregando ${tabla}.${col}`, error: e?.message });
    }
  }
  for (const tabla of TABLAS_CON_FK) {
    try {
      const r = await sequelize.query(
        `SELECT 1 FROM information_schema.key_column_usage
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'dni'
           AND referenced_table_name = 'personal'`,
        { replacements: [tabla], type: QueryTypes.SELECT }
      );
      if (!r.length) {
        await sequelize.query(
          `ALTER TABLE \`${tabla}\` ADD CONSTRAINT \`fk_${tabla}_dni\` FOREIGN KEY (dni) REFERENCES personal(dni)`
        );
      }
    } catch (e: any) {
      // típico: filas huérfanas (dni que no está en personal) → queda sin FK y se avisa
      logger.error({ msg: `legajo: no se pudo agregar FK dni en ${tabla}`, error: e?.message });
    }
  }
}

// Campos editables de legajo_datos_personales (PUT /legajo/datos-personales/:dni)
const CAMPOS_DATOS_PERSONALES = [
  'nro_legajo','reparticion',
  'nac_pais','nac_provincia','nac_partido','estado_civil',
  'clase','dist_militar','cedula_nro','cedula_expedida_por',
  'carta_ciudadania','carta_otorgada_en','carta_fecha','carta_juez_federal',
  'estudios_nivel','estudios_detalle','titulo_secundario','titulo_secundario_otorgado',
  'titulo_universitario','titulo_universitario_otorgado','aptitud_especial',
  'mil_presto','mil_arma','mil_especialidad','mil_grado','mil_destino','mil_motivo_excepcion',
];

// '' → NULL, booleanos → 0/1 y fechas ISO completas → YYYY-MM-DD
function limpiar(v: any): any {
  if (v === '' || v === undefined) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function buildLegajoRouter(sequelize: Sequelize): Router {
  const router = Router();
  const read  = requirePermission('crud:*:read');
  const write = requirePermission('crud:*:*');
  const ready = ensureLegajoTables(sequelize);

  // ══════════════════════════════════════════════════════════════════
  //  Carga completa del legajo (todas las hojas) — la usan GET /:dni y GET /:dni/pdf
  // ══════════════════════════════════════════════════════════════════
  async function cargarLegajo(dni: number): Promise<any | null> {
    await ready;
    const [
      personales, personal, agente, servicios,
      bonificaciones, funcion_destino, licencias,
      concepto_menciones, penas, domicilios,
      incompatibilidad, embargos, bienes,
      familia, familia_exp,
      datos_legajo, rectificaciones, foja_manual, licencias_06,
    ] = await Promise.all([
      // Pág 01+02 — datos personales (personal es la fuente de nombre/apellido/cuil)
      sequelize.query(
        `SELECT pd.*,
                p.apellido, p.nombre, p.cuil, p.telefono, p.email,
                p.domicilio, p.nacionalidad, p.fecha_nacimiento as p_fecha_nacimiento,
                p.numerodomicilio, p.depto, p.piso, p.cp, p.foto_path,
                esp.especialidad AS especialidad_nombre,
                s.nombre  AS sexo_nombre,
                l.localidad_nombre AS localidad_nombre,
                l.municipio_nombre AS municipio_nombre,
                l.municipio_id     AS municipio_codigo,
                l.localidad_codigo AS localidad_codigo,
                cat.nombre AS categoria_nombre,
                pla.nombre AS planta_nombre,
                oc.nombre  AS ocupacion_nombre,
                rh.nombre  AS regimen_horario_nombre
         FROM personaldetalle pd
         LEFT JOIN personal p         ON p.dni  = pd.dni
         LEFT JOIN sexos s            ON s.id   = p.sexo_id
         LEFT JOIN agentes_especialidades ae  ON ae.dni = p.dni AND ae.abierta = 1
         LEFT JOIN especialidaddesmedicas esp ON esp.id = ae.especialidad_id
         LEFT JOIN localidades l      ON l.id   = p.localidad_id
         LEFT JOIN categorias cat     ON cat.ID = pd.categoria_id
         LEFT JOIN plantas pla        ON pla.id = pd.planta_id
         -- ocupacion y regimen salen del tramo vigente (mismo criterio que GET /personal/:dni):
         -- dni no es unico en agentes (carrera en tramos) y antes se cruzaba ocupaciones
         -- contra categoria_id.
         LEFT JOIN agentes av ON av.id = (
           SELECT ax.id FROM agentes ax
           WHERE ax.dni = pd.dni AND ax.deleted_at IS NULL
           ORDER BY (ax.estado_empleo = 'ACTIVO' AND ax.fecha_egreso IS NULL) DESC, ax.id DESC
           LIMIT 1
         )
         LEFT JOIN ocupaciones oc     ON oc.id  = av.ocupacion_id
         LEFT JOIN regimenes_horarios rh ON rh.id = av.regimen_horario_id
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
         LEFT JOIN agentes_servicios ags_leg ON ags_leg.id = (SELECT id FROM agentes_servicios WHERE dni = a.dni AND deleted_at IS NULL AND fecha_hasta IS NULL ORDER BY id DESC LIMIT 1)
         LEFT JOIN servicios        se  ON se.id   = ags_leg.servicio_id
         LEFT JOIN categorias       cat ON cat.ID  = a.categoria_id
         LEFT JOIN plantas          pla ON pla.id  = a.planta_id
         LEFT JOIN regimenes_horarios rh ON rh.id  = a.regimen_horario_id
         LEFT JOIN reparticiones    rep ON rep.id  = se.reparticion_id AND rep.deleted_at IS NULL
         LEFT JOIN dependencias     dep ON dep.id  = rep.dependencia_id AND dep.deleted_at IS NULL
         WHERE a.dni = :dni AND a.deleted_at IS NULL
         ORDER BY a.fecha_ingreso DESC`,
        { replacements: { dni }, type: QueryTypes.SELECT }
      ),
      // Pág 06 — historial de servicios
      sequelize.query(
        `SELECT as2.*, dep.nombre as dependencia_nombre, rep2.reparticion_nombre as reparticion_nombre, se.nombre as servicio_nombre
         FROM agentes_servicios as2
         LEFT JOIN servicios se ON se.id = as2.servicio_id
         LEFT JOIN reparticiones rep2 ON rep2.id = se.reparticion_id AND rep2.deleted_at IS NULL
         LEFT JOIN dependencias dep ON dep.id = rep2.dependencia_id AND dep.deleted_at IS NULL
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
      // Pág 13 — domicilios (historial)
      sequelize.query(
        `SELECT * FROM legajo_domicilios WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha DESC, id DESC`,
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
      // Pág 02 — datos del formulario que no están en personal
      sequelize.query(
        `SELECT * FROM legajo_datos_personales WHERE dni = :dni LIMIT 1`,
        { replacements: { dni }, type: QueryTypes.SELECT }
      ),
      // Pág 03 — rectificaciones
      sequelize.query(
        `SELECT * FROM legajo_rectificaciones WHERE dni = :dni AND deleted_at IS NULL ORDER BY seccion, fecha, id`,
        { replacements: { dni }, type: QueryTypes.SELECT }
      ),
      // Pág 06 — foja de servicios (carga manual)
      sequelize.query(
        `SELECT * FROM legajo_foja_servicios WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha_ingreso, id`,
        { replacements: { dni }, type: QueryTypes.SELECT }
      ),
      // Pág 10 — licencias concepto 06
      sequelize.query(
        `SELECT * FROM legajo_licencias_06 WHERE dni = :dni AND deleted_at IS NULL ORDER BY fecha_desde, id`,
        { replacements: { dni }, type: QueryTypes.SELECT }
      ),
    ]);

    const pd = (personales as any[])[0] ?? null;
    if (!pd) return null;

    return {
      // Pág 01+02 — portada + datos personales
      datosPersonales: pd,
      datosLegajo:     (datos_legajo as any[])[0] ?? null,
      rectificaciones: rectificaciones as any[],
      // Pág 04+05 — familia
      familia:            familia as any[],
      familiaExpedientes: familia_exp as any[],
      // Pág 06 — foja de servicios
      agente:    (agente as any[])[0] ?? null,
      tramos:    agente as any[],
      servicios: servicios as any[],
      fojaServicios: foja_manual as any[],
      // Pág 07 — bonificaciones
      bonificaciones: bonificaciones as any[],
      // Pág 08 — función y destino
      funcionDestino: funcion_destino as any[],
      // Pág 09 — licencias
      licencias: licencias as any[],
      // Pág 10 — licencias concepto 06
      licencias06: licencias_06 as any[],
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
    };
  }

  // GET /legajo/:dni/pdf?hojas=1,2 — legajo impreso sobre el PDF original del Ministerio
  router.get('/:dni/pdf', read, async (req: Request, res: Response) => {
    const dni = Number(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });
    try {
      const data = await cargarLegajo(dni);
      if (!data) return res.status(404).json({ ok: false, error: 'Agente no encontrado' });
      const hojas = String(req.query.hojas ?? '').split(',').map(Number).filter(n => n >= 1 && n <= 16);
      const pdf = await generarLegajoPdf(data, hojas);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="legajo_${dni}.pdf"`);
      return res.send(Buffer.from(pdf));
    } catch (err: any) {
      logger.error({ msg: 'legajo: error generando PDF', dni, error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // GET /legajo/:dni — carga completa del legajo (todas las páginas)
  router.get('/:dni', read, async (req: Request, res: Response) => {
    const dni = Number(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });
    try {
      const data = await cargarLegajo(dni);
      if (!data) return res.status(404).json({ ok: false, error: 'Agente no encontrado' });
      return res.json({ ok: true, data });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  PUT /legajo/datos-personales/:dni — alta o edición (1 fila por DNI)
  // ══════════════════════════════════════════════════════════════════
  router.put('/datos-personales/:dni', write, async (req: Request, res: Response) => {
    const dni = Number(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'dni requerido' });
    try {
      await ready;
      const body = req.body as Record<string, any>;
      const cols = CAMPOS_DATOS_PERSONALES.filter(c => body[c] !== undefined);
      if (!cols.length) return res.status(400).json({ ok: false, error: 'Sin campos' });
      const vals = cols.map(c => limpiar(body[c]));
      const uid  = userInfo(req);
      await sequelize.query(
        `INSERT INTO legajo_datos_personales (dni, ${cols.map(c => `\`${c}\``).join(', ')}, created_by, updated_by)
         VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)
         ON DUPLICATE KEY UPDATE ${cols.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')}, updated_by = VALUES(updated_by)`,
        { replacements: [dni, ...vals, uid, uid] }
      );
      return res.json({ ok: true });
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
    // Envuelve cada handler: espera las tablas y devuelve el error en JSON (antes un fallo colgaba el request)
    const safe = (fn: (req: Request, res: Response) => Promise<any>) =>
      async (req: Request, res: Response) => {
        try {
          await ready;
          await fn(req, res);
        } catch (err: any) {
          logger.error({ msg: `legajo: error en ${table}`, error: err?.message });
          res.status(500).json({ ok: false, error: err?.message });
        }
      };

    // GET lista
    router.get(`/seccion/${table}/:dni`, read, safe(async (req, res) => {
      const dni = Number(req.params.dni);
      const [rows] = await sequelize.query(
        `SELECT * FROM \`${table}\` WHERE dni = :dni AND deleted_at IS NULL ORDER BY ${orderBy}`,
        { replacements: { dni } }
      );
      return res.json({ ok: true, data: rows });
    }));

    // POST crear
    router.post(`/seccion/${table}`, write, safe(async (req, res) => {
      const body = req.body as Record<string, any>;
      const cols = fields.filter(f => body[f] !== undefined);
      if (!cols.length || !body.dni) return res.status(400).json({ ok: false, error: 'Datos insuficientes' });
      const allCols = ['dni', ...cols, 'created_by'];
      const vals    = [body.dni, ...cols.map(c => limpiar(body[c])), userInfo(req)];
      const placeholders = allCols.map(() => '?').join(', ');
      await sequelize.query(
        `INSERT INTO \`${table}\` (${allCols.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
        { replacements: vals }
      );
      return res.json({ ok: true });
    }));

    // PUT actualizar
    router.put(`/seccion/${table}/:id`, write, safe(async (req, res) => {
      const id   = Number(req.params.id);
      const body = req.body as Record<string, any>;
      const cols = fields.filter(f => body[f] !== undefined);
      if (!cols.length) return res.status(400).json({ ok: false, error: 'Sin campos' });
      const set  = [...cols.map(c => `\`${c}\` = ?`), '`updated_by` = ?'].join(', ');
      const vals = [...cols.map(c => limpiar(body[c])), userInfo(req), id];
      await sequelize.query(
        `UPDATE \`${table}\` SET ${set} WHERE id = ?`,
        { replacements: vals }
      );
      return res.json({ ok: true });
    }));

    // DELETE soft
    router.delete(`/seccion/${table}/:id`, write, safe(async (req, res) => {
      const id = Number(req.params.id);
      await sequelize.query(
        `UPDATE \`${table}\` SET deleted_at = NOW(), updated_by = ? WHERE id = ?`,
        { replacements: [userInfo(req), id] }
      );
      return res.json({ ok: true });
    }));
  }

  crudSection('legajo_familia', [
    'parentesco','codigo','apellido_nombres','dni_familiar','sexo','vive',
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
    'jubilacion_tipo',
    'otro_cargo','otro_cargo_nivel','otro_cargo_lugar','otro_cargo_monto','otro_cargo_fecha_ingreso',
    'cargo_nacional','cargo_provincial','cargo_municipal','otro_cargo_horario',
    'otras_actividades','otras_actividades_lugar','otras_actividades_monto','otras_actividades_fecha',
    'observaciones','fecha_declaracion'
  ], 'created_at DESC');

  crudSection('legajo_embargos', [
    'expediente','fecha','suma_embargada','autoridad','ejecutante','fecha_levantamiento','observaciones'
  ], 'fecha DESC');

  crudSection('legajo_declaracion_bienes', [
    'descripcion','fecha'
  ], 'fecha DESC');

  // Respuestas del formulario de Google → legajo
  registrarImportFormulario(router, sequelize, ready, write, userInfo);

  crudSection('legajo_rectificaciones', [
    'seccion','fecha','norma_legal','texto'
  ], 'seccion, fecha, id');

  crudSection('legajo_foja_servicios', [
    'resolucion','fecha_ingreso','ministerio','dependencia','cargo','grupo_ocupacional',
    'categoria','regimen_horario','fecha_baja','motivo'
  ], 'fecha_ingreso, id');

  crudSection('bonificaciones', [
    'norma_legal','fecha','a_partir','fecha_baja','motivo','expediente','anio','observaciones'
  ], 'fecha DESC');

  crudSection('legajo_licencias_06', [
    'codigo_trabajo','concepto','subconcepto','inciso','legajo_contaduria',
    'norma_codigo','norma_numero','norma_anio','fecha_desde','fecha_hasta',
    'dias_con_sueldo','dias_50','dias_sin_sueldo','acum_con_sueldo','acum_50','acum_sin_sueldo',
    'observaciones'
  ], 'fecha_desde, id');

  crudSection('legajo_domicilios', [
    'expediente','fecha','calle_numero','telefono','partido','localidad',
    'codigo_partido','codigo_localidad'
  ], 'fecha DESC, id DESC');

  return router;
}

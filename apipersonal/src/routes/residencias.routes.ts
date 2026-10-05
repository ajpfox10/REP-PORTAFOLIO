// src/routes/residencias.routes.ts
// Duracion de residencias: catalogo (residencia + cantidad de anios), asignacion
// por agente y control del corte anual (31/08 por defecto, configurable por .env).
//
// El anio de residencia se calcula por ANTIGUEDAD: se toma la fecha de inicio
// (o agentes.fecha_ingreso) y se cuentan los ciclos cerrados al corte.
// Si los anios cumplidos alcanzan la duracion de la residencia, corresponde la baja:
// queda una pendiente en residencias_bajas y el banner del dashboard insiste
// hasta que el agente esta efectivamente dado de baja.
//
// Config por .env:
//   RESIDENCIAS_CORTE_MMDD   fecha de corte anual (default 08-31)
//   RESIDENCIAS_AVISO_DIAS   dias antes del corte en que empieza a avisar (default 0)

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { invalidate, agenteTags, personalTags } from '../infra/invalidateOnWrite';

const CENTINELA_ANIO = '1111';

// Catalogo inicial (listado de residentes del hospital). Editable desde la pagina.
const RESIDENCIAS_SEED: Array<{ nombre: string; anios: number; observaciones?: string }> = [
  { nombre: 'TERAPIA INTENSIVA', anios: 4 },
  { nombre: 'CIRUGIA GENERAL', anios: 4 },
  { nombre: 'TRAUMATOLOGIA', anios: 4 },
  { nombre: 'CLINICA MEDICA', anios: 4 },
  { nombre: 'TOCOGINECOLOGIA', anios: 4 },
  { nombre: 'ANESTESIOLOGIA', anios: 4 },
  { nombre: 'TRABAJO SOCIAL', anios: 3 },
  { nombre: 'FONOAUDIOLOGIA', anios: 3 },
  { nombre: 'DERECHO Y SALUD', anios: 3, observaciones: 'Duracion a confirmar' },
  { nombre: 'PRE RESIDENTES', anios: 1, observaciones: 'Duracion a confirmar' },
  { nombre: 'NEONATOLOGIA', anios: 4 },
  { nombre: 'OBSTETRICIA', anios: 4 },
  { nombre: 'BIOQUIMICA', anios: 3 },
  { nombre: 'ENFERMERIA', anios: 3 },
  { nombre: 'ENFERMERIA ESPECIALIZADA', anios: 3 },
];

// Residencias que se agregaron despues del catalogo inicial (existian como
// ocupaciones "RESIDENTE X n" pero no en el catalogo). Se insertan una sola vez,
// cuando se agrega la columna ocupacion_jefe_id.
const RESIDENCIAS_AGREGADAS = ['NEONATOLOGIA', 'OBSTETRICIA', 'BIOQUIMICA', 'ENFERMERIA', 'ENFERMERIA ESPECIALIZADA'];

// Vinculo inicial residencia -> ocupacion "JEFE DE RESIDENTE(S) ..." (tabla ocupaciones).
// Editable desde la pagina. TOCOGINECOLOGIA, DERECHO Y SALUD y PRE RESIDENTES no tienen cargo de jefe.
const JEFE_OCUPACION_SEED: Record<string, number> = {
  'TERAPIA INTENSIVA': 1197,
  'CIRUGIA GENERAL': 1195,
  'TRAUMATOLOGIA': 1188,
  'CLINICA MEDICA': 1196,
  'ANESTESIOLOGIA': 1204,
  'TRABAJO SOCIAL': 1199,
  'FONOAUDIOLOGIA': 1212,
  'NEONATOLOGIA': 1170,
  'OBSTETRICIA': 1175,
  'BIOQUIMICA': 1198,
  'ENFERMERIA': 1208,
  'ENFERMERIA ESPECIALIZADA': 1216,
};

/** La jefatura de residentes dura 1 ciclo; al corte siguiente corresponde la baja. */
const JEFATURA_ANIOS = 1;

function normalizarResidencia(nombre: string): string {
  return String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

// ── Corte anual ──────────────────────────────────────────────────────────────
function corteMMDD(): { mes: number; dia: number } {
  const raw = String((env as any).RESIDENCIAS_CORTE_MMDD || '08-31').trim();
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  const mes = m ? Number(m[1]) : 8;
  const dia = m ? Number(m[2]) : 31;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return { mes: 8, dia: 31 };
  return { mes, dia };
}

function avisoDias(): number {
  const n = Number((env as any).RESIDENCIAS_AVISO_DIAS ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function fechaLocal(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Hora local: nunca toISOString(), que corre el dia.
function hoyLocal(): string {
  const d = new Date();
  return fechaLocal(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function restarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(y, m - 1, d - dias);
  return fechaLocal(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Ciclo vigente: el ultimo corte que ya paso (o que entra en la ventana de aviso). */
function resolverCiclo(cicloForzado?: number | null) {
  const { mes, dia } = corteMMDD();
  const hoy = hoyLocal();
  const anioHoy = Number(hoy.slice(0, 4));

  if (cicloForzado && Number.isFinite(cicloForzado)) {
    return { ciclo: cicloForzado, fechaCorte: fechaLocal(cicloForzado, mes, dia), hoy, avisoDias: avisoDias() };
  }

  const corteEste = fechaLocal(anioHoy, mes, dia);
  const desdeAviso = restarDias(corteEste, avisoDias());
  const ciclo = hoy >= desdeAviso ? anioHoy : anioHoy - 1;
  return { ciclo, fechaCorte: fechaLocal(ciclo, mes, dia), hoy, avisoDias: avisoDias() };
}

/** Ciclo lectivo de ingreso: si entro despues del corte de su anio, ese anio; si no, el anterior. */
function cicloDeIngreso(fechaIngreso: string): number {
  const { mes, dia } = corteMMDD();
  const anio = Number(fechaIngreso.slice(0, 4));
  return fechaIngreso >= fechaLocal(anio, mes, dia) ? anio : anio - 1;
}

function fechaValida(f: unknown): string | null {
  const s = String(f || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (s.startsWith(CENTINELA_ANIO)) return null; // centinela 01/11/1111
  return s;
}

function getUser(req: Request) {
  const auth = (req as any).auth ?? {};
  const perms: string[] = auth.permissions ?? [];
  return {
    id: auth.principalId ?? null,
    nombre: auth.nombre ?? auth.email ?? null,
    isAdmin: perms.some((p: string) => p === 'crud:*:*'),
  };
}

export type EstadoResidente =
  | 'CONTINUA' | 'DAR_DE_BAJA' | 'SIN_RESIDENCIA' | 'SIN_FECHA'
  | 'JEFE' | 'FIN_JEFATURA';

export function buildResidenciasRouter(sequelize: Sequelize) {
  const router = Router();
  let listo: Promise<void> | null = null;

  // ── Tablas (se crean solas, como el resto del sistema) ─────────────────────
  async function ensureTablas() {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS residencias (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        nombre        VARCHAR(120) NOT NULL,
        anios         INT NOT NULL DEFAULT 4,
        activa        TINYINT(1) NOT NULL DEFAULT 1,
        observaciones VARCHAR(500) NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_residencias_nombre (nombre)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS residentes_residencia (
        dni           INT NOT NULL PRIMARY KEY,
        residencia_id INT NOT NULL,
        fecha_inicio  DATE NULL,
        observaciones VARCHAR(500) NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_residentes_residencia_res (residencia_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS residencias_bajas (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        dni                 INT NOT NULL,
        ciclo               INT NOT NULL,
        residencia_id       INT NULL,
        residencia_nombre   VARCHAR(120) NULL,
        anios_cumplidos     INT NULL,
        anios_residencia    INT NULL,
        fecha_corte         DATE NOT NULL,
        estado              ENUM('PENDIENTE','BAJA','NO_CORRESPONDE') NOT NULL DEFAULT 'PENDIENTE',
        fecha_baja          DATE NULL,
        observaciones       VARCHAR(500) NULL,
        resuelto_por        INT NULL,
        resuelto_por_nombre VARCHAR(200) NULL,
        resuelto_at         DATETIME NULL,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_residencias_bajas (dni, ciclo),
        KEY idx_residencias_bajas_estado (estado)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [{ n }] = await sequelize.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM residencias`, { type: QueryTypes.SELECT },
    );
    if (Number(n) === 0) {
      for (const r of RESIDENCIAS_SEED) {
        await sequelize.query(
          `INSERT IGNORE INTO residencias (nombre, anios, observaciones) VALUES (:nombre, :anios, :obs)`,
          { replacements: { nombre: r.nombre, anios: r.anios, obs: r.observaciones ?? null } },
        );
      }
      logger.info({ msg: '[residencias] catalogo inicial cargado', residencias: RESIDENCIAS_SEED.length });
    }

    await ensureJefatura();
  }

  async function columnaExiste(tabla: string, columna: string): Promise<boolean> {
    const r = await sequelize.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tabla AND COLUMN_NAME = :columna`,
      { replacements: { tabla, columna }, type: QueryTypes.SELECT },
    );
    return Number(r[0]?.n) > 0;
  }

  // Jefatura de residentes: columnas y estado nuevos (idempotente, ver mig 057).
  async function ensureJefatura() {
    if (!(await columnaExiste('residencias', 'ocupacion_jefe_id'))) {
      await sequelize.query(`ALTER TABLE residencias ADD COLUMN ocupacion_jefe_id INT NULL AFTER anios`);
      // Primera vez: residencias que faltaban + vinculo con el cargo de jefe.
      const catalogo = RESIDENCIAS_SEED.filter((r) => RESIDENCIAS_AGREGADAS.includes(r.nombre));
      for (const r of catalogo) {
        await sequelize.query(
          `INSERT IGNORE INTO residencias (nombre, anios) VALUES (:nombre, :anios)`,
          { replacements: { nombre: r.nombre, anios: r.anios } },
        );
      }
      for (const [nombre, ocupacionId] of Object.entries(JEFE_OCUPACION_SEED)) {
        await sequelize.query(
          `UPDATE residencias SET ocupacion_jefe_id = :oid WHERE nombre = :nombre AND ocupacion_jefe_id IS NULL`,
          { replacements: { nombre, oid: ocupacionId } },
        );
      }
      logger.info({ msg: '[residencias] jefaturas vinculadas', residencias: Object.keys(JEFE_OCUPACION_SEED).length });
    }
    if (!(await columnaExiste('residentes_residencia', 'jefatura_desde'))) {
      await sequelize.query(
        `ALTER TABLE residentes_residencia
           ADD COLUMN jefatura_desde DATE NULL AFTER fecha_inicio,
           ADD COLUMN jefatura_ocupacion_id INT NULL AFTER jefatura_desde`,
      );
    }
    const tipo = await sequelize.query<{ t: string }>(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'residencias_bajas' AND COLUMN_NAME = 'estado'`,
      { type: QueryTypes.SELECT },
    );
    if (tipo[0]?.t && !tipo[0].t.includes("'JEFATURA'")) {
      await sequelize.query(
        `ALTER TABLE residencias_bajas
           MODIFY estado ENUM('PENDIENTE','BAJA','NO_CORRESPONDE','JEFATURA') NOT NULL DEFAULT 'PENDIENTE'`,
      );
    }
  }

  function init() {
    if (!listo) {
      listo = ensureTablas().catch((err) => {
        listo = null;
        logger.error({ msg: '[residencias] no se pudieron crear las tablas', error: (err as any)?.message });
        throw err;
      });
    }
    return listo;
  }

  // ── Calculo central ────────────────────────────────────────────────────────
  type FilaResidente = {
    dni: number;
    apellido: string;
    nombre: string;
    agente_id: number;
    ocupacion_nombre: string | null;
    servicio_nombre: string | null;
    fecha_ingreso: string | null;
    fecha_inicio: string | null;
    residencia_id: number | null;
    residencia_nombre: string | null;
    anios_residencia: number | null;
    anios_cumplidos: number | null;
    anio_en_curso: number | null;
    ocupacion_jefe_id: number | null;
    ocupacion_jefe_nombre: string | null;
    jefatura_desde: string | null;
    estado: EstadoResidente;
    baja_estado: 'PENDIENTE' | 'BAJA' | 'NO_CORRESPONDE' | 'JEFATURA' | null;
    baja_fecha: string | null;
    baja_observaciones: string | null;
    baja_resuelto_por: string | null;
  };

  async function calcular(cicloForzado?: number | null) {
    const { ciclo, fechaCorte, hoy, avisoDias: dias } = resolverCiclo(cicloForzado);

    const rows = await sequelize.query<any>(
      `
        SELECT
          p.dni, p.apellido, p.nombre,
          a.id AS agente_id, a.fecha_ingreso,
          oc.nombre AS ocupacion_nombre,
          COALESCE(srv.nombre, ags.nombre) AS servicio_nombre,
          rr.residencia_id, rr.fecha_inicio, rr.jefatura_desde,
          r.nombre AS residencia_nombre, r.anios AS anios_residencia,
          r.ocupacion_jefe_id, ocj.nombre AS ocupacion_jefe_nombre,
          rb.estado AS baja_estado, rb.fecha_baja AS baja_fecha,
          rb.observaciones AS baja_observaciones, rb.resuelto_por_nombre AS baja_resuelto_por
        FROM personal p
        JOIN agentes a ON a.id = (
          SELECT ax.id FROM agentes ax
          WHERE ax.dni = p.dni AND ax.deleted_at IS NULL
          ORDER BY (ax.estado_empleo = 'ACTIVO' AND ax.fecha_egreso IS NULL) DESC, ax.id DESC
          LIMIT 1
        )
        LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
        LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
        LEFT JOIN agentes_servicios ags ON ags.id = (
          SELECT ags1.id FROM agentes_servicios ags1
          WHERE ags1.dni = p.dni AND ags1.deleted_at IS NULL
            AND (ags1.fecha_hasta IS NULL OR ags1.fecha_hasta >= CURDATE())
          ORDER BY ags1.fecha_desde DESC, ags1.id DESC LIMIT 1
        )
        LEFT JOIN servicios srv ON srv.id = ags.servicio_id AND srv.deleted_at IS NULL
        LEFT JOIN residentes_residencia rr ON rr.dni = p.dni
        LEFT JOIN residencias r ON r.id = rr.residencia_id
        LEFT JOIN ocupaciones ocj ON ocj.id = r.ocupacion_jefe_id
        LEFT JOIN residencias_bajas rb ON rb.dni = p.dni AND rb.ciclo = :ciclo
        WHERE p.deleted_at IS NULL
          AND a.estado_empleo = 'ACTIVO'
          AND (
            rr.dni IS NOT NULL
            OR a.ley_id = 11
            OR a.ocupacion_id = 132
            OR LOWER(COALESCE(l.nombre, '')) LIKE '%residente%'
            OR LOWER(COALESCE(oc.nombre, '')) LIKE '%residente%'
          )
        ORDER BY p.apellido ASC, p.nombre ASC
      `,
      { type: QueryTypes.SELECT, replacements: { ciclo } },
    );

    const residentes: FilaResidente[] = rows.map((r: any) => {
      const fechaIngreso = fechaValida(r.fecha_ingreso);
      const fechaInicio = fechaValida(r.fecha_inicio);
      const inicio = fechaInicio || fechaIngreso;
      const aniosResidencia = r.anios_residencia == null ? null : Number(r.anios_residencia);

      // Antiguedad: ciclos cerrados al corte.
      const aniosCumplidos = inicio ? ciclo - cicloDeIngreso(inicio) : null;

      // Jefatura: dura JEFATURA_ANIOS ciclos contados desde que asumio.
      const jefaturaDesde = fechaValida(r.jefatura_desde);
      const aniosJefatura = jefaturaDesde ? ciclo - cicloDeIngreso(jefaturaDesde) : null;

      let estado: EstadoResidente;
      if (jefaturaDesde) estado = (aniosJefatura as number) >= JEFATURA_ANIOS ? 'FIN_JEFATURA' : 'JEFE';
      else if (!r.residencia_id || aniosResidencia == null) estado = 'SIN_RESIDENCIA';
      else if (aniosCumplidos == null) estado = 'SIN_FECHA';
      else if (aniosCumplidos >= aniosResidencia) estado = 'DAR_DE_BAJA';
      else estado = 'CONTINUA';

      return {
        dni: Number(r.dni),
        apellido: r.apellido,
        nombre: r.nombre,
        agente_id: Number(r.agente_id),
        ocupacion_nombre: r.ocupacion_nombre ?? null,
        servicio_nombre: r.servicio_nombre ?? null,
        fecha_ingreso: fechaIngreso,
        fecha_inicio: fechaInicio,
        residencia_id: r.residencia_id == null ? null : Number(r.residencia_id),
        residencia_nombre: r.residencia_nombre ?? null,
        anios_residencia: aniosResidencia,
        anios_cumplidos: aniosCumplidos,
        anio_en_curso: aniosCumplidos == null ? null : Math.max(1, aniosCumplidos + 1),
        ocupacion_jefe_id: r.ocupacion_jefe_id == null ? null : Number(r.ocupacion_jefe_id),
        ocupacion_jefe_nombre: r.ocupacion_jefe_nombre ? String(r.ocupacion_jefe_nombre).trim() : null,
        jefatura_desde: jefaturaDesde,
        estado,
        baja_estado: r.baja_estado ?? null,
        baja_fecha: r.baja_fecha ? String(r.baja_fecha).slice(0, 10) : null,
        baja_observaciones: r.baja_observaciones ?? null,
        baja_resuelto_por: r.baja_resuelto_por ?? null,
      };
    });

    return { ciclo, fechaCorte, hoy, avisoDias: dias, residentes };
  }

  /** Termino la residencia (o la jefatura) y hay que resolverlo en este ciclo. */
  function correspondeBaja(r: FilaResidente) {
    return r.estado === 'DAR_DE_BAJA' || r.estado === 'FIN_JEFATURA';
  }

  /** Deja como PENDIENTE a los que cumplieron la residencia en este ciclo. */
  async function sembrarPendientes(ciclo: number, fechaCorte: string, residentes: FilaResidente[]) {
    for (const r of residentes) {
      if (!correspondeBaja(r) || r.baja_estado) continue;
      await sequelize.query(
        `INSERT INTO residencias_bajas
           (dni, ciclo, residencia_id, residencia_nombre, anios_cumplidos, anios_residencia, fecha_corte, estado)
         VALUES (:dni, :ciclo, :rid, :rnombre, :cumplidos, :anios, :corte, 'PENDIENTE')
         ON DUPLICATE KEY UPDATE residencia_id = VALUES(residencia_id),
                                 residencia_nombre = VALUES(residencia_nombre),
                                 anios_cumplidos = VALUES(anios_cumplidos),
                                 anios_residencia = VALUES(anios_residencia)`,
        {
          replacements: {
            dni: r.dni, ciclo, rid: r.residencia_id, rnombre: r.residencia_nombre,
            cumplidos: r.anios_cumplidos, anios: r.anios_residencia, corte: fechaCorte,
          },
        },
      );
      r.baja_estado = 'PENDIENTE';
    }
  }

  // ── Catalogo de residencias ────────────────────────────────────────────────
  router.get('/', async (_req: Request, res: Response) => {
    try {
      await init();
      const rows = await sequelize.query<any>(
        `SELECT r.id, r.nombre, r.anios, r.activa, r.observaciones,
                r.ocupacion_jefe_id, TRIM(ocj.nombre) AS ocupacion_jefe_nombre,
                (SELECT COUNT(*) FROM residentes_residencia rr WHERE rr.residencia_id = r.id) AS residentes
         FROM residencias r
         LEFT JOIN ocupaciones ocj ON ocj.id = r.ocupacion_jefe_id
         ORDER BY r.activa DESC, r.nombre ASC`,
        { type: QueryTypes.SELECT },
      );
      const { ciclo, fechaCorte, hoy, avisoDias: dias } = resolverCiclo();
      return res.json({ ok: true, data: rows, corte: { ciclo, fechaCorte, hoy, avisoDias: dias } });
    } catch (err: any) {
      logger.error({ msg: '[residencias] listar error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error listando residencias' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      await init();
      const nombre = normalizarResidencia(String(req.body?.nombre || ''));
      const anios = Number(req.body?.anios);
      if (!nombre) return res.status(400).json({ ok: false, error: 'Falta el nombre de la residencia' });
      if (!Number.isFinite(anios) || anios < 1 || anios > 10) {
        return res.status(400).json({ ok: false, error: 'La cantidad de anios debe estar entre 1 y 10' });
      }
      await sequelize.query(
        `INSERT INTO residencias (nombre, anios, observaciones) VALUES (:nombre, :anios, :obs)`,
        { replacements: { nombre, anios, obs: req.body?.observaciones ? String(req.body.observaciones).slice(0, 500) : null } },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      if (String(err?.parent?.code) === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, error: 'Ya existe una residencia con ese nombre' });
      }
      logger.error({ msg: '[residencias] crear error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error creando residencia' });
    }
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      await init();
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Id invalido' });

      const sets: string[] = [];
      const rep: any = { id };
      if (req.body?.nombre !== undefined) {
        const nombre = normalizarResidencia(String(req.body.nombre || ''));
        if (!nombre) return res.status(400).json({ ok: false, error: 'Nombre invalido' });
        sets.push('nombre = :nombre'); rep.nombre = nombre;
      }
      if (req.body?.anios !== undefined) {
        const anios = Number(req.body.anios);
        if (!Number.isFinite(anios) || anios < 1 || anios > 10) {
          return res.status(400).json({ ok: false, error: 'La cantidad de anios debe estar entre 1 y 10' });
        }
        sets.push('anios = :anios'); rep.anios = anios;
      }
      if (req.body?.activa !== undefined) { sets.push('activa = :activa'); rep.activa = req.body.activa ? 1 : 0; }
      if (req.body?.ocupacion_jefe_id !== undefined) {
        const oid = req.body.ocupacion_jefe_id == null || req.body.ocupacion_jefe_id === ''
          ? null : Number(req.body.ocupacion_jefe_id);
        if (oid != null && !Number.isFinite(oid)) return res.status(400).json({ ok: false, error: 'Cargo de jefe invalido' });
        sets.push('ocupacion_jefe_id = :oid'); rep.oid = oid;
      }
      if (req.body?.observaciones !== undefined) {
        sets.push('observaciones = :obs');
        rep.obs = req.body.observaciones ? String(req.body.observaciones).slice(0, 500) : null;
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: 'Nada para actualizar' });

      await sequelize.query(`UPDATE residencias SET ${sets.join(', ')} WHERE id = :id`, { replacements: rep });
      return res.json({ ok: true });
    } catch (err: any) {
      if (String(err?.parent?.code) === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, error: 'Ya existe una residencia con ese nombre' });
      }
      logger.error({ msg: '[residencias] editar error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error editando residencia' });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await init();
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Id invalido' });
      await sequelize.query(`UPDATE residencias SET activa = 0 WHERE id = :id`, { replacements: { id } });
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: '[residencias] desactivar error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error desactivando la residencia' });
    }
  });

  // ── Cargos de jefe de residentes (ocupaciones) ─────────────────────────────
  router.get('/ocupaciones-jefe', async (_req: Request, res: Response) => {
    try {
      const rows = await sequelize.query<any>(
        `SELECT id, TRIM(nombre) AS nombre FROM ocupaciones
         WHERE deleted_at IS NULL AND nombre LIKE '%JEF%RESID%'
         ORDER BY nombre ASC`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ ok: true, data: rows });
    } catch (err: any) {
      logger.error({ msg: '[residencias] ocupaciones-jefe error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error listando cargos de jefe' });
    }
  });

  // ── Asignacion residencia <-> agente ───────────────────────────────────────
  router.put('/asignacion/:dni', async (req: Request, res: Response) => {
    try {
      await init();
      const dni = Number(req.params.dni);
      if (!Number.isFinite(dni)) return res.status(400).json({ ok: false, error: 'DNI invalido' });

      const residenciaId = req.body?.residencia_id == null || req.body.residencia_id === ''
        ? null : Number(req.body.residencia_id);
      if (residenciaId == null) {
        await sequelize.query(`DELETE FROM residentes_residencia WHERE dni = :dni`, { replacements: { dni } });
        return res.json({ ok: true });
      }
      const fechaInicio = fechaValida(req.body?.fecha_inicio);
      await sequelize.query(
        `INSERT INTO residentes_residencia (dni, residencia_id, fecha_inicio, observaciones)
         VALUES (:dni, :rid, :fecha, :obs)
         ON DUPLICATE KEY UPDATE residencia_id = VALUES(residencia_id),
                                 fecha_inicio = VALUES(fecha_inicio),
                                 observaciones = VALUES(observaciones)`,
        {
          replacements: {
            dni, rid: residenciaId, fecha: fechaInicio,
            obs: req.body?.observaciones ? String(req.body.observaciones).slice(0, 500) : null,
          },
        },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: '[residencias] asignacion error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error asignando la residencia' });
    }
  });

  // ── Residentes con anios cumplidos y estado al corte ───────────────────────
  router.get('/residentes', async (req: Request, res: Response) => {
    try {
      await init();
      const ciclo = req.query.ciclo ? Number(req.query.ciclo) : null;
      const calc = await calcular(ciclo);
      await sembrarPendientes(calc.ciclo, calc.fechaCorte, calc.residentes);

      const totales = {
        residentes: calc.residentes.length,
        continuan: calc.residentes.filter((r) => r.estado === 'CONTINUA').length,
        darDeBaja: calc.residentes.filter((r) => correspondeBaja(r) && !r.baja_estado?.match(/^(BAJA|JEFATURA)$/)).length,
        dadosDeBaja: calc.residentes.filter((r) => r.baja_estado === 'BAJA').length,
        jefes: calc.residentes.filter((r) => r.estado === 'JEFE' || r.estado === 'FIN_JEFATURA').length,
        sinResidencia: calc.residentes.filter((r) => r.estado === 'SIN_RESIDENCIA').length,
        sinFecha: calc.residentes.filter((r) => r.estado === 'SIN_FECHA').length,
      };

      const porResidencia = new Map<string, { residencia: string; anios: number | null; total: number; darDeBaja: number }>();
      for (const r of calc.residentes) {
        const key = r.residencia_nombre || 'SIN RESIDENCIA';
        const cur = porResidencia.get(key) || { residencia: key, anios: r.anios_residencia, total: 0, darDeBaja: 0 };
        cur.total += 1;
        if (correspondeBaja(r) && !r.baja_estado?.match(/^(BAJA|JEFATURA)$/)) cur.darDeBaja += 1;
        porResidencia.set(key, cur);
      }

      return res.json({
        ok: true,
        data: calc.residentes,
        corte: { ciclo: calc.ciclo, fechaCorte: calc.fechaCorte, hoy: calc.hoy, avisoDias: calc.avisoDias },
        totales,
        porResidencia: Array.from(porResidencia.values()).sort((a, b) => a.residencia.localeCompare(b.residencia, 'es')),
      });
    } catch (err: any) {
      logger.error({ msg: '[residencias] residentes error', error: err?.message, sql: err?.sql });
      return res.status(500).json({ ok: false, error: err?.message || 'Error calculando residentes' });
    }
  });

  // ── Pendientes para el banner (insiste hasta la baja) ──────────────────────
  router.get('/pendientes', async (_req: Request, res: Response) => {
    try {
      await init();
      const calc = await calcular(null);
      await sembrarPendientes(calc.ciclo, calc.fechaCorte, calc.residentes);
      const pendientes = calc.residentes.filter(
        (r) => correspondeBaja(r) && (!r.baja_estado || r.baja_estado === 'PENDIENTE'),
      );
      return res.json({
        ok: true,
        data: pendientes,
        corte: { ciclo: calc.ciclo, fechaCorte: calc.fechaCorte, hoy: calc.hoy, avisoDias: calc.avisoDias },
      });
    } catch (err: any) {
      logger.error({ msg: '[residencias] pendientes error', error: err?.message });
      return res.json({ ok: true, data: [], corte: null, error: err?.message || null });
    }
  });

  // ── Dar de baja: cierra el tramo vigente y resuelve la pendiente ───────────
  router.post('/baja/:dni', async (req: Request, res: Response) => {
    const user = getUser(req);
    const t = await sequelize.transaction();
    try {
      await init();
      const dni = Number(req.params.dni);
      if (!Number.isFinite(dni)) { await t.rollback(); return res.status(400).json({ ok: false, error: 'DNI invalido' }); }

      const { ciclo, fechaCorte } = resolverCiclo(req.body?.ciclo ? Number(req.body.ciclo) : null);
      const fechaBaja = fechaValida(req.body?.fecha_baja) || fechaCorte;

      const vigente = await sequelize.query<{ id: number }>(
        `SELECT id FROM agentes
         WHERE dni = :dni AND deleted_at IS NULL AND estado_empleo = 'ACTIVO' AND fecha_egreso IS NULL
         ORDER BY id DESC LIMIT 1`,
        { replacements: { dni }, type: QueryTypes.SELECT, transaction: t },
      );
      if (!vigente[0]?.id) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: `El DNI ${dni} no tiene un tramo activo para dar de baja.` });
      }

      await sequelize.query(
        `UPDATE agentes SET estado_empleo = 'BAJA', fecha_egreso = :fecha, updated_at = NOW() WHERE id = :id`,
        { replacements: { fecha: fechaBaja, id: vigente[0].id }, transaction: t },
      );

      await sequelize.query(
        `INSERT INTO residencias_bajas
           (dni, ciclo, fecha_corte, estado, fecha_baja, observaciones, resuelto_por, resuelto_por_nombre, resuelto_at)
         VALUES (:dni, :ciclo, :corte, 'BAJA', :fecha, :obs, :uid, :unombre, NOW())
         ON DUPLICATE KEY UPDATE estado = 'BAJA', fecha_baja = VALUES(fecha_baja),
                                 observaciones = VALUES(observaciones), resuelto_por = VALUES(resuelto_por),
                                 resuelto_por_nombre = VALUES(resuelto_por_nombre), resuelto_at = NOW()`,
        {
          replacements: {
            dni, ciclo, corte: fechaCorte, fecha: fechaBaja,
            obs: req.body?.observaciones ? String(req.body.observaciones).slice(0, 500) : null,
            uid: user.id, unombre: user.nombre,
          },
          transaction: t,
        },
      );

      await t.commit();
      logger.info({ msg: '[residencias] baja de residente', dni, ciclo, fechaBaja, actor: user.id });
      return res.json({ ok: true, data: { dni, ciclo, fecha_baja: fechaBaja } });
    } catch (err: any) {
      await t.rollback();
      logger.error({ msg: '[residencias] baja error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error dando de baja al residente' });
    }
  });

  // ── Pasar a jefatura de residentes ─────────────────────────────────────────
  // Hito de carrera (igual que el cambio de ocupacion): cierra el tramo vigente
  // con estado CAMBIO DE OCUPACION y abre uno nuevo ACTIVO al dia siguiente con
  // los mismos datos laborales y la ocupacion "JEFE DE RESIDENTE(S) ...".
  // No usa AgenteService.alta() porque reescribe la tabla personal con el DTO.
  // El servicio/sector no se tocan: siguen abiertos por DNI.
  router.post('/jefatura/:dni', async (req: Request, res: Response) => {
    const user = getUser(req);
    const t = await sequelize.transaction();
    try {
      await init();
      const dni = Number(req.params.dni);
      if (!Number.isFinite(dni)) { await t.rollback(); return res.status(400).json({ ok: false, error: 'DNI invalido' }); }

      const { ciclo, fechaCorte } = resolverCiclo(req.body?.ciclo ? Number(req.body.ciclo) : null);
      const fechaCierre = fechaValida(req.body?.fecha_cierre) || fechaCorte;
      const [y, m, d] = fechaCierre.split('-').map(Number);
      const sig = new Date(y, m - 1, d + 1);
      const fechaJefatura = fechaLocal(sig.getFullYear(), sig.getMonth() + 1, sig.getDate());

      const asignacion = await sequelize.query<any>(
        `SELECT rr.residencia_id, rr.jefatura_desde, r.nombre, r.ocupacion_jefe_id
         FROM residentes_residencia rr JOIN residencias r ON r.id = rr.residencia_id
         WHERE rr.dni = :dni`,
        { replacements: { dni }, type: QueryTypes.SELECT, transaction: t },
      );
      if (!asignacion[0]) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: 'El agente no tiene una residencia asignada.' });
      }
      if (asignacion[0].jefatura_desde) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: 'El agente ya es jefe de residentes.' });
      }

      const ocupacionId = req.body?.ocupacion_id ? Number(req.body.ocupacion_id) : Number(asignacion[0].ocupacion_jefe_id);
      if (!Number.isFinite(ocupacionId) || ocupacionId <= 0) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          error: `La residencia ${asignacion[0].nombre} no tiene cargo de jefe vinculado: elegilo en el modal o en el catalogo.`,
        });
      }
      const ocup = await sequelize.query<{ id: number }>(
        `SELECT id FROM ocupaciones WHERE id = :id AND deleted_at IS NULL`,
        { replacements: { id: ocupacionId }, type: QueryTypes.SELECT, transaction: t },
      );
      if (!ocup[0]) { await t.rollback(); return res.status(400).json({ ok: false, error: 'El cargo de jefe no existe.' }); }

      const vigente = await sequelize.query<{ id: number; fecha_ingreso: string | null }>(
        `SELECT id, fecha_ingreso FROM agentes
         WHERE dni = :dni AND deleted_at IS NULL AND estado_empleo = 'ACTIVO' AND fecha_egreso IS NULL
         ORDER BY id DESC LIMIT 1`,
        { replacements: { dni }, type: QueryTypes.SELECT, transaction: t },
      );
      if (!vigente[0]?.id) {
        await t.rollback();
        return res.status(409).json({ ok: false, error: `El DNI ${dni} no tiene un tramo activo.` });
      }
      const ingresoVigente = fechaValida(vigente[0].fecha_ingreso);
      if (ingresoVigente && fechaCierre < ingresoVigente) {
        await t.rollback();
        return res.status(400).json({ ok: false, error: `La fecha de cierre es anterior al ingreso del tramo (${ingresoVigente}).` });
      }

      // 1. Cierra la residencia.
      await sequelize.query(
        `UPDATE agentes SET estado_empleo = 'CAMBIO DE OCUPACION', fecha_egreso = :cierre,
                updated_by = :uid, updated_at = NOW()
         WHERE id = :id`,
        { replacements: { cierre: fechaCierre, id: vigente[0].id, uid: user.id }, transaction: t },
      );

      // 2. Abre la jefatura copiando los datos laborales del tramo cerrado.
      const [ins]: any = await sequelize.query(
        `INSERT INTO agentes
           (dni, planta_id, categoria_id, ocupacion_id, regimen_horario_id, ley_id, jefatura_id,
            fecha_ingreso, fecha_egreso, fecha_de_nombramiento, fecha_de_tituralizacion, estado_empleo,
            salario_mensual, legajo, estado, funcion_id, decreto_designacion, created_by, created_at, updated_at)
         SELECT dni, planta_id, categoria_id, :ocup, regimen_horario_id, ley_id, jefatura_id,
                :ingreso, NULL, fecha_de_nombramiento, fecha_de_tituralizacion, 'ACTIVO',
                salario_mensual, legajo, estado, funcion_id, decreto_designacion, :uid, NOW(), NOW()
         FROM agentes WHERE id = :id`,
        { replacements: { ocup: ocupacionId, ingreso: fechaJefatura, id: vigente[0].id, uid: user.id }, transaction: t },
      );

      // 3. Marca la jefatura en la asignacion. Si la residencia no tenia fecha de
      //    inicio propia se fija la del tramo cerrado, para no perder la antiguedad.
      await sequelize.query(
        `UPDATE residentes_residencia
            SET jefatura_desde = :desde, jefatura_ocupacion_id = :ocup,
                fecha_inicio = COALESCE(fecha_inicio, :inicio)
          WHERE dni = :dni`,
        { replacements: { dni, desde: fechaJefatura, ocup: ocupacionId, inicio: ingresoVigente }, transaction: t },
      );

      // 4. Resuelve la pendiente del ciclo (el banner deja de mostrarlo).
      await sequelize.query(
        `INSERT INTO residencias_bajas
           (dni, ciclo, fecha_corte, estado, fecha_baja, observaciones, resuelto_por, resuelto_por_nombre, resuelto_at)
         VALUES (:dni, :ciclo, :corte, 'JEFATURA', :cierre, :obs, :uid, :unombre, NOW())
         ON DUPLICATE KEY UPDATE estado = 'JEFATURA', fecha_baja = VALUES(fecha_baja),
                                 observaciones = VALUES(observaciones), resuelto_por = VALUES(resuelto_por),
                                 resuelto_por_nombre = VALUES(resuelto_por_nombre), resuelto_at = NOW()`,
        {
          replacements: {
            dni, ciclo, corte: fechaCorte, cierre: fechaCierre,
            obs: req.body?.observaciones ? String(req.body.observaciones).slice(0, 500) : null,
            uid: user.id, unombre: user.nombre,
          },
          transaction: t,
        },
      );

      await t.commit();
      await invalidate([...personalTags.all(dni), ...agenteTags.all(dni)], 'residencias.jefatura');
      logger.info({ msg: '[residencias] pase a jefatura', dni, ciclo, cierre: fechaCierre, desde: fechaJefatura, ocupacionId, actor: user.id });
      return res.json({
        ok: true,
        data: { dni, ciclo, fecha_cierre: fechaCierre, jefatura_desde: fechaJefatura, ocupacion_id: ocupacionId, agente_id: ins ?? null },
      });
    } catch (err: any) {
      await t.rollback();
      logger.error({ msg: '[residencias] jefatura error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error pasando a jefatura' });
    }
  });

  // ── Excepcion: no corresponde la baja (exige justificacion) ────────────────
  router.post('/no-corresponde/:dni', async (req: Request, res: Response) => {
    const user = getUser(req);
    try {
      await init();
      const dni = Number(req.params.dni);
      if (!Number.isFinite(dni)) return res.status(400).json({ ok: false, error: 'DNI invalido' });
      const obs = String(req.body?.observaciones || '').trim();
      if (obs.length < 5) return res.status(400).json({ ok: false, error: 'Hay que justificar por que no corresponde la baja' });

      const { ciclo, fechaCorte } = resolverCiclo(req.body?.ciclo ? Number(req.body.ciclo) : null);
      await sequelize.query(
        `INSERT INTO residencias_bajas
           (dni, ciclo, fecha_corte, estado, observaciones, resuelto_por, resuelto_por_nombre, resuelto_at)
         VALUES (:dni, :ciclo, :corte, 'NO_CORRESPONDE', :obs, :uid, :unombre, NOW())
         ON DUPLICATE KEY UPDATE estado = 'NO_CORRESPONDE', observaciones = VALUES(observaciones),
                                 resuelto_por = VALUES(resuelto_por), resuelto_por_nombre = VALUES(resuelto_por_nombre),
                                 resuelto_at = NOW()`,
        { replacements: { dni, ciclo, corte: fechaCorte, obs: obs.slice(0, 500), uid: user.id, unombre: user.nombre } },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: '[residencias] no-corresponde error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error registrando la excepcion' });
    }
  });

  // ── Reabrir una pendiente cerrada por error ────────────────────────────────
  router.post('/reabrir/:dni', async (req: Request, res: Response) => {
    try {
      await init();
      const dni = Number(req.params.dni);
      if (!Number.isFinite(dni)) return res.status(400).json({ ok: false, error: 'DNI invalido' });
      const { ciclo } = resolverCiclo(req.body?.ciclo ? Number(req.body.ciclo) : null);
      await sequelize.query(
        `UPDATE residencias_bajas SET estado = 'PENDIENTE', fecha_baja = NULL, resuelto_at = NULL
         WHERE dni = :dni AND ciclo = :ciclo AND estado = 'NO_CORRESPONDE'`,
        { replacements: { dni, ciclo } },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: '[residencias] reabrir error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error reabriendo la pendiente' });
    }
  });

  return router;
}

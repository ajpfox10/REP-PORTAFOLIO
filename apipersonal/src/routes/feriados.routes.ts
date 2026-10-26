// src/routes/feriados.routes.ts
// GET    /api/v1/feriados/estado                  → ¿el año en curso está confirmado? corte (4.º día hábil de enero), bloqueo y aviso
// GET    /api/v1/feriados?anio=AAAA                → feriados del año + si está confirmado + años cargados
// POST   /api/v1/feriados                          → alta {fecha, nombre, tipo}            (crud:*:*)
// PUT    /api/v1/feriados/:id                      → editar                                (crud:*:*)
// DELETE /api/v1/feriados/:id                      → borrar                                (crud:*:*)
// POST   /api/v1/feriados/anio/:anio/fijos         → agrega los de fecha fija que falten   (crud:*:*)
// POST   /api/v1/feriados/anio/:anio/confirmar     → marca el año completo (queda quién)   (crud:*:*)
// DELETE /api/v1/feriados/anio/:anio/confirmar     → lo vuelve a dejar sin confirmar       (crud:*:*)
//
// Tablas feriados + feriados_anios (mig 091). Un año cuenta como cargado recién cuando se confirma.
// Si al 4.º día hábil de enero no está confirmado, el front bloquea la app a los administradores
// (AlertasJubilacionBloqueo) y el robot de ausentes de la Intranet no carga ese año. Desde el 1/12 avisa.

import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { requireAny, requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';

const TIPOS = ['nacional', 'provincial', 'puente', 'trasladable', 'no_laborable'];

// Los de fecha fija (los trasladables, Carnaval, Semana Santa y puentes se cargan a mano cada año)
const FIJOS: [string, string][] = [
  ['01-01', 'Año Nuevo'],
  ['03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'],
  ['04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas'],
  ['05-01', 'Día Internacional del Trabajador'],
  ['05-25', 'Día de la Revolución de Mayo'],
  ['06-20', 'Paso a la Inmortalidad del Gral. Manuel Belgrano'],
  ['07-09', 'Día de la Independencia'],
  ['12-08', 'Inmaculada Concepción de María'],
  ['12-25', 'Navidad'],
];

const tablasReady = new WeakSet<Sequelize>();
async function ensureTablas(sequelize: Sequelize) {
  if (tablasReady.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS feriados (
      id INT NOT NULL AUTO_INCREMENT,
      fecha DATE NOT NULL,
      nombre VARCHAR(200) NOT NULL,
      tipo ENUM('nacional','provincial','puente','trasladable','no_laborable') NOT NULL DEFAULT 'nacional',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_feriados_fecha (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS feriados_anios (
      anio SMALLINT UNSIGNED NOT NULL,
      confirmado_por INT NULL,
      confirmado_por_nombre VARCHAR(150) NULL,
      confirmado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (anio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  tablasReady.add(sequelize);
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// la sesión de Sequelize está en UTC: la hora de confirmación se arma acá, en hora local
const ahoraLocal = () => { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const esDuplicado = (e: any) =>
  e?.name === 'SequelizeUniqueConstraintError' || e?.original?.code === 'ER_DUP_ENTRY' || /Duplicate/i.test(e?.message ?? '');

/** 4.º día hábil de enero: lunes a viernes, sin el 1/1 ni los feriados de enero que ya estén cargados. */
export function cuartoHabilEnero(anio: number, feriadosEnero: Set<string>): string {
  let n = 0;
  for (let d = 1; d <= 31; d++) {
    const f = new Date(anio, 0, d);
    const s = ymd(f);
    if (f.getDay() === 0 || f.getDay() === 6 || d === 1 || feriadosEnero.has(s)) continue;
    if (++n === 4) return s;
  }
  return `${anio}-01-31`;
}

async function anioConfirmado(sequelize: Sequelize, anio: number) {
  const [r] = await sequelize.query<any>(
    `SELECT anio, confirmado_por_nombre, DATE_FORMAT(confirmado_at, '%Y-%m-%d %H:%i') AS confirmado_at
       FROM feriados_anios WHERE anio = ?`,
    { replacements: [anio], type: QueryTypes.SELECT },
  );
  return r ?? null;
}

async function feriadosEnero(sequelize: Sequelize, anio: number) {
  const rows = await sequelize.query<any>(
    `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS f FROM feriados WHERE fecha BETWEEN ? AND ?`,
    { replacements: [`${anio}-01-01`, `${anio}-01-31`], type: QueryTypes.SELECT },
  );
  return new Set<string>(rows.map((r: any) => r.f));
}

async function nombreUsuario(sequelize: Sequelize, id: number | null) {
  if (!id) return null;
  const [u] = await sequelize.query<any>(
    `SELECT COALESCE(NULLIF(nombre, ''), email) AS n FROM usuarios WHERE id = ? LIMIT 1`,
    { replacements: [id], type: QueryTypes.SELECT },
  );
  return u?.n ?? null;
}

export function buildFeriadosRouter(sequelize: Sequelize) {
  const router = Router();
  const soloAdmin = requireAny(['crud:*:*']);

  router.use(async (_req, res, next) => {
    try { await ensureTablas(sequelize); next(); }
    catch (e: any) {
      logger.error({ msg: 'feriados: no se pudieron crear las tablas', err: e?.message });
      res.status(500).json({ ok: false, error: 'No se pudieron preparar las tablas de feriados' });
    }
  });

  router.get('/estado', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const hoy = typeof req.query.hoy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.hoy)
        ? new Date(`${req.query.hoy}T12:00:00`) : new Date();   // ?hoy= solo para probar el corte
      const anio = hoy.getFullYear();
      const conf = await anioConfirmado(sequelize, anio);
      const corte = cuartoHabilEnero(anio, await feriadosEnero(sequelize, anio));
      const bloquea = !conf && ymd(hoy) >= corte;

      let aviso: string | null = null;
      if (!conf && !bloquea) {
        aviso = `Faltan cargar y confirmar los feriados de ${anio}. Desde el ${corte.split('-').reverse().join('/')} el sistema se bloquea para los administradores.`;
      } else if (hoy.getMonth() === 11 && !(await anioConfirmado(sequelize, anio + 1))) {
        const corteSig = cuartoHabilEnero(anio + 1, await feriadosEnero(sequelize, anio + 1));
        aviso = `Faltan cargar y confirmar los feriados de ${anio + 1}. Desde el ${corteSig.split('-').reverse().join('/')} el sistema se bloquea para los administradores.`;
      }
      res.json({ ok: true, anio, confirmado: !!conf, corte, bloquea, aviso });
    } catch (e: any) {
      logger.error({ msg: 'feriados/estado', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const anio = Number(req.query.anio) || new Date().getFullYear();
      const data = await sequelize.query<any>(
        `SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, nombre, tipo
           FROM feriados WHERE YEAR(fecha) = ? ORDER BY fecha`,
        { replacements: [anio], type: QueryTypes.SELECT },
      );
      const anios = await sequelize.query<any>(
        `SELECT a.anio, COUNT(f.id) AS cantidad, (c.anio IS NOT NULL) AS confirmado
           FROM (SELECT DISTINCT YEAR(fecha) AS anio FROM feriados
                 UNION SELECT anio FROM feriados_anios) a
           LEFT JOIN feriados f ON YEAR(f.fecha) = a.anio
           LEFT JOIN feriados_anios c ON c.anio = a.anio
          GROUP BY a.anio, c.anio ORDER BY a.anio DESC`,
        { type: QueryTypes.SELECT },
      );
      const corte = cuartoHabilEnero(anio, await feriadosEnero(sequelize, anio));
      res.json({ ok: true, anio, data, confirmacion: await anioConfirmado(sequelize, anio), corte, anios });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  const validar = (b: any) => {
    const fecha = String(b?.fecha ?? '').slice(0, 10);
    const nombre = String(b?.nombre ?? '').trim();
    const tipo = String(b?.tipo ?? 'nacional');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(Date.parse(fecha))) return { error: 'Fecha inválida' };
    if (!nombre) return { error: 'Falta el nombre' };
    if (!TIPOS.includes(tipo)) return { error: 'Tipo inválido' };
    return { fecha, nombre: nombre.slice(0, 200), tipo };
  };

  router.post('/', soloAdmin, async (req: Request, res: Response) => {
    const v: any = validar(req.body);
    if (v.error) return res.status(400).json({ ok: false, error: v.error });
    try {
      await sequelize.query(`INSERT INTO feriados (fecha, nombre, tipo) VALUES (?, ?, ?)`,
        { replacements: [v.fecha, v.nombre, v.tipo] });
      res.json({ ok: true });
    } catch (e: any) {
      const dup = esDuplicado(e);
      res.status(dup ? 409 : 500).json({ ok: false, error: dup ? 'Ya hay un feriado en esa fecha' : e?.message });
    }
  });

  router.put('/:id', soloAdmin, async (req: Request, res: Response) => {
    const v: any = validar(req.body);
    if (v.error) return res.status(400).json({ ok: false, error: v.error });
    try {
      await sequelize.query(`UPDATE feriados SET fecha = ?, nombre = ?, tipo = ? WHERE id = ?`,
        { replacements: [v.fecha, v.nombre, v.tipo, Number(req.params.id)] });
      res.json({ ok: true });
    } catch (e: any) {
      const dup = esDuplicado(e);
      res.status(dup ? 409 : 500).json({ ok: false, error: dup ? 'Ya hay un feriado en esa fecha' : e?.message });
    }
  });

  router.delete('/:id', soloAdmin, async (req: Request, res: Response) => {
    try {
      await sequelize.query(`DELETE FROM feriados WHERE id = ?`, { replacements: [Number(req.params.id)] });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post('/anio/:anio/fijos', soloAdmin, async (req: Request, res: Response) => {
    const anio = Number(req.params.anio);
    if (!(anio >= 2000 && anio <= 2100)) return res.status(400).json({ ok: false, error: 'Año inválido' });
    try {
      let agregados = 0;
      for (const [md, nombre] of FIJOS) {
        const [, meta]: any = await sequelize.query(
          `INSERT IGNORE INTO feriados (fecha, nombre, tipo) VALUES (?, ?, 'nacional')`,
          { replacements: [`${anio}-${md}`, nombre] },
        );
        agregados += Number(meta?.affectedRows ?? meta ?? 0) > 0 ? 1 : 0;
      }
      res.json({ ok: true, agregados });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.post('/anio/:anio/confirmar', soloAdmin, async (req: Request, res: Response) => {
    const anio = Number(req.params.anio);
    if (!(anio >= 2000 && anio <= 2100)) return res.status(400).json({ ok: false, error: 'Año inválido' });
    try {
      const auth = (req as any).auth;
      const userId = auth?.principalType === 'user' || auth?.principalType === 'dev' ? Number(auth.principalId) || null : null;
      await sequelize.query(
        `INSERT INTO feriados_anios (anio, confirmado_por, confirmado_por_nombre, confirmado_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE confirmado_por = VALUES(confirmado_por),
           confirmado_por_nombre = VALUES(confirmado_por_nombre), confirmado_at = VALUES(confirmado_at)`,
        { replacements: [anio, userId, await nombreUsuario(sequelize, userId), ahoraLocal()] },
      );
      res.json({ ok: true, confirmacion: await anioConfirmado(sequelize, anio) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  router.delete('/anio/:anio/confirmar', soloAdmin, async (req: Request, res: Response) => {
    try {
      await sequelize.query(`DELETE FROM feriados_anios WHERE anio = ?`, { replacements: [Number(req.params.anio)] });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}

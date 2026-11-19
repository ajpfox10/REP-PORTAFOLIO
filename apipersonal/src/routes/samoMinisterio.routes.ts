// src/routes/samoMinisterio.routes.ts
// SAMO → pestaña "Licencias Ministerio": licencias cargadas en la Intranet del Ministerio
// (tabla ministerio_novedades_anual, robot intranet_descarga_anual) por dependencia,
// una línea por agente con código + fechas del mes. Menos los códigos que el admin ocultó (samo_codigos_ocultos).
// Cada mes se ve solo si un admin lo habilitó cargando la clave fija SAMO_CLAVE_HABILITACION (.env).
//   GET    /samo-ministerio/meses                  → meses habilitados
//   GET    /samo-ministerio/licencias?anio&mes&dep → filas (403 si el mes no está habilitado)
//   GET    /samo-ministerio/clave                  → clave del .env (solo admin)
//   POST   /samo-ministerio/meses {anio,mes,clave} → habilitar (solo admin) + lanza el robot intranet_descarga_anual
//   DELETE /samo-ministerio/meses/:anio/:mes       → deshabilitar (solo admin)
//   GET    /samo-ministerio/ocultos                → códigos del Ministerio + si SAMO los ve (solo admin)
//   PUT    /samo-ministerio/ocultos {codigos[]}    → códigos que SAMO no ve (solo admin; SAMO no los recibe)

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import crypto from 'crypto';
import { requireAny, hasAnyPermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { ejecutarAhora } from '../services/robotsTareasWindows';

const ROBOT_ANUAL = 'intranet_descarga_anual';

// ─── Tabla (mig 071) ──────────────────────────────────────────────────────────
// Se crea sola al levantar la API; espejo en scripts/migrations/071__samo_meses_habilitados.sql
const DDL = `CREATE TABLE IF NOT EXISTS samo_meses_habilitados (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  anio SMALLINT NOT NULL,
  mes TINYINT NOT NULL,
  habilitado_por INT NULL,
  habilitado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_samo_meses_anio_mes (anio, mes)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

// Códigos que SAMO no ve: los elige el admin (tilde en la pestaña). Se arranca con 34-FRANCO COMPENSATORIO.
const DDL_OCULTOS = `CREATE TABLE IF NOT EXISTS samo_codigos_ocultos (
  codigo VARCHAR(20) NOT NULL PRIMARY KEY,
  ocultado_por INT NULL,
  ocultado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

const DEPENDENCIAS = ['HOSPITAL', 'UPA 4', 'UPA 18'];
const ADMIN_PERMS = ['usuarios:write', 'crud:*:*'];

const pad = (n: number) => String(n).padStart(2, '0');

function anioMes(a: any, m: any): { anio: number; mes: number } | null {
  const anio = Number(a), mes = Number(m);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return null;
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { anio, mes };
}

function claveOk(ingresada: string): boolean {
  const real = String(env.SAMO_CLAVE_HABILITACION || '');
  if (!real) return false;
  const a = crypto.createHash('sha256').update(String(ingresada ?? '').trim()).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

export function buildSamoMinisterioRouter(sequelize: Sequelize): Router {
  const router = Router();
  const read  = requireAny(['app:samo:access', 'crud:*:*']);
  const admin = requireAny(ADMIN_PERMS);
  const ready = (async () => {
    await sequelize.query(DDL);
    // solo al crear la tabla arranca con el 34 (lo que antes estaba fijo en el código);
    // si después el admin destilda todo, no se vuelve a cargar
    const [{ n }] = await sequelize.query<any>(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'samo_codigos_ocultos'`,
      { type: QueryTypes.SELECT });
    await sequelize.query(DDL_OCULTOS);
    if (!Number(n)) await sequelize.query(`INSERT IGNORE INTO samo_codigos_ocultos (codigo) VALUES ('34')`);
  })().catch((e: any) =>
    logger.error({ msg: 'samo-ministerio: error creando tablas', error: e?.message }));

  async function codigosOcultos(): Promise<string[]> {
    await ready;
    const rows = await sequelize.query<any>(`SELECT codigo FROM samo_codigos_ocultos`, { type: QueryTypes.SELECT });
    return rows.map(r => String(r.codigo));
  }

  async function habilitado(anio: number, mes: number): Promise<boolean> {
    await ready;
    const rows = await sequelize.query<any>(
      `SELECT 1 FROM samo_meses_habilitados WHERE anio = :anio AND mes = :mes LIMIT 1`,
      { replacements: { anio, mes }, type: QueryTypes.SELECT });
    return rows.length > 0;
  }

  router.get('/meses', read, async (_req: Request, res: Response) => {
    try {
      await ready;
      const data = await sequelize.query<any>(
        `SELECT anio, mes, habilitado_en FROM samo_meses_habilitados ORDER BY anio DESC, mes DESC`,
        { type: QueryTypes.SELECT });
      return res.json({ ok: true, data });
    } catch (e: any) {
      logger.error({ msg: 'samo-ministerio: error listando meses', error: e?.message });
      return res.status(500).json({ ok: false, error: 'Error listando meses habilitados' });
    }
  });

  router.get('/licencias', read, async (req: Request, res: Response) => {
    const am = anioMes(req.query.anio, req.query.mes);
    const dep = String(req.query.dep ?? '').trim().toUpperCase();
    if (!am) return res.status(400).json({ ok: false, error: 'Año/mes inválido' });
    if (!DEPENDENCIAS.includes(dep)) return res.status(400).json({ ok: false, error: 'Dependencia inválida' });
    try {
      if (!(await habilitado(am.anio, am.mes))) {
        return res.status(403).json({ ok: false, error: 'Mes no habilitado' });
      }
      const ini = `${am.anio}-${pad(am.mes)}-01`;
      const fin = new Date(Date.UTC(am.anio, am.mes, 0)).toISOString().slice(0, 10);
      // SAMO no recibe los códigos ocultos; el admin los recibe marcados (oculto: true)
      const esAdmin = hasAnyPermission(req, ADMIN_PERMS);
      const ocultos = new Set(await codigosOcultos());
      const rowsTodas = await sequelize.query<any>(
        `SELECT dni, apellido_nombre, legajo, cargo, codigo, novedad,
                DATE_FORMAT(GREATEST(fecha_desde, :ini), '%Y-%m-%d') AS desde,
                DATE_FORMAT(LEAST(fecha_hasta, :fin), '%Y-%m-%d')    AS hasta,
                DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS desde_real,
                DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS hasta_real
           FROM ministerio_novedades_anual
          WHERE dependencia = :dep
            AND fecha_desde <= :fin AND fecha_hasta >= :ini
          ORDER BY apellido_nombre, dni, fecha_desde, codigo`,
        { replacements: { dep, ini, fin }, type: QueryTypes.SELECT });
      const codDe = (r: any) => String(r.codigo || String(r.novedad || '').split('-')[0] || '?').trim();
      const rows = esAdmin ? rowsTodas : rowsTodas.filter(r => !ocultos.has(codDe(r)));

      // Una línea por agente; descarta duplicados exactos (el Ministerio a veces repite la carga)
      const porDni = new Map<string, any>();
      for (const r of rows) {
        const key = String(r.dni);
        let ag = porDni.get(key);
        if (!ag) {
          ag = { dni: r.dni, apellido_nombre: r.apellido_nombre, legajo: r.legajo, cargo: r.cargo, licencias: [], dias: 0 };
          porDni.set(key, ag);
        }
        const codigo = codDe(r);
        if (ag.licencias.some((l: any) => l.codigo === codigo && l.desde === r.desde && l.hasta === r.hasta)) continue;
        const oculto = ocultos.has(codigo);
        ag.licencias.push({
          codigo, novedad: r.novedad, desde: r.desde, hasta: r.hasta,
          desde_real: r.desde_real, hasta_real: r.hasta_real, oculto,
        });
        // días = lo que ve SAMO (las ocultas no suman, tampoco para el admin)
        if (!oculto) ag.dias += Math.round((Date.parse(r.hasta) - Date.parse(r.desde)) / 86400000) + 1;
      }
      // Cargo (ocupación) y legajo de nuestra base: el Ministerio no manda cargo.
      // Por DNI se toma el tramo ACTIVO; si no hay, el más reciente.
      const dnis = [...porDni.values()].map(a => Number(a.dni)).filter(n => Number.isFinite(n));
      if (dnis.length) {
        const nuestros = await sequelize.query<any>(
          `SELECT a.dni, a.legajo, o.nombre AS ocupacion
             FROM agentes a
             LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id
            WHERE a.deleted_at IS NULL AND a.dni IN (:dnis)
            ORDER BY a.dni, (a.estado_empleo = 'ACTIVO') DESC, a.fecha_ingreso DESC, a.id DESC`,
          { replacements: { dnis }, type: QueryTypes.SELECT });
        const vistos = new Set<string>();
        for (const n of nuestros) {
          const k = String(n.dni);
          if (vistos.has(k)) continue;
          vistos.add(k);
          const ag = porDni.get(k);
          if (!ag) continue;
          if (!ag.cargo && n.ocupacion) ag.cargo = String(n.ocupacion).trim();
          if (!ag.legajo && n.legajo) ag.legajo = String(n.legajo);
        }
      }
      const ult = await sequelize.query<any>(
        `SELECT MAX(descargado_en) AS d FROM ministerio_novedades_anual WHERE dependencia = :dep`,
        { replacements: { dep }, type: QueryTypes.SELECT });
      return res.json({ ok: true, data: [...porDni.values()], meta: { dep, ...am, descargado_en: ult[0]?.d ?? null } });
    } catch (e: any) {
      logger.error({ msg: 'samo-ministerio: error consultando licencias', error: e?.message });
      return res.status(500).json({ ok: false, error: 'Error consultando licencias del Ministerio' });
    }
  });

  // Catálogo de códigos que existen en los datos del Ministerio + si SAMO los ve o no (solo admin)
  router.get('/ocultos', admin, async (_req: Request, res: Response) => {
    try {
      const ocultos = new Set(await codigosOcultos());
      const rows = await sequelize.query<any>(
        `SELECT codigo, MAX(novedad) AS novedad, COUNT(*) AS cantidad
           FROM ministerio_novedades_anual
          WHERE codigo IS NOT NULL AND codigo <> ''
          GROUP BY codigo`,
        { type: QueryTypes.SELECT });
      const data = rows.map(r => ({
        codigo: String(r.codigo), novedad: r.novedad, cantidad: Number(r.cantidad), oculto: ocultos.has(String(r.codigo)),
      }));
      // ocultos que no están en los datos (por si acaso) también se listan, para poder destildarlos
      for (const c of ocultos) if (!data.some(d => d.codigo === c)) data.push({ codigo: c, novedad: null, cantidad: 0, oculto: true });
      data.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
      return res.json({ ok: true, data });
    } catch (e: any) {
      logger.error({ msg: 'samo-ministerio: error listando códigos', error: e?.message });
      return res.status(500).json({ ok: false, error: 'Error listando códigos' });
    }
  });

  // Reemplaza la lista de códigos ocultos para SAMO (solo admin)
  router.put('/ocultos', admin, async (req: Request, res: Response) => {
    const lista = req.body?.codigos;
    if (!Array.isArray(lista)) return res.status(400).json({ ok: false, error: 'Falta la lista de códigos' });
    const codigos = [...new Set(lista.map((c: any) => String(c ?? '').trim()).filter((c: string) => c && c.length <= 20))];
    try {
      await ready;
      const userId = (req as any).auth?.principalId ?? null;
      await sequelize.transaction(async (t) => {
        if (codigos.length) {
          await sequelize.query(`DELETE FROM samo_codigos_ocultos WHERE codigo NOT IN (:codigos)`, { replacements: { codigos }, transaction: t });
          for (const codigo of codigos) {
            await sequelize.query(`INSERT IGNORE INTO samo_codigos_ocultos (codigo, ocultado_por) VALUES (:codigo, :userId)`,
              { replacements: { codigo, userId }, transaction: t });
          }
        } else {
          await sequelize.query(`DELETE FROM samo_codigos_ocultos`, { transaction: t });
        }
      });
      return res.json({ ok: true, codigos });
    } catch (e: any) {
      logger.error({ msg: 'samo-ministerio: error guardando códigos ocultos', error: e?.message });
      return res.status(500).json({ ok: false, error: 'Error guardando los códigos ocultos' });
    }
  });

  router.get('/clave', admin, (_req: Request, res: Response) => {
    const clave = String(env.SAMO_CLAVE_HABILITACION || '');
    if (!clave) return res.status(404).json({ ok: false, error: 'Falta SAMO_CLAVE_HABILITACION en el .env' });
    return res.json({ ok: true, clave });
  });

  router.post('/meses', admin, async (req: Request, res: Response) => {
    const am = anioMes(req.body?.anio, req.body?.mes);
    if (!am) return res.status(400).json({ ok: false, error: 'Año/mes inválido' });
    if (!env.SAMO_CLAVE_HABILITACION) return res.status(500).json({ ok: false, error: 'Falta SAMO_CLAVE_HABILITACION en el .env' });
    if (!claveOk(req.body?.clave)) return res.status(403).json({ ok: false, error: 'Clave incorrecta' });
    try {
      await ready;
      const userId = (req as any).auth?.principalId ?? null;
      await sequelize.query(
        `INSERT INTO samo_meses_habilitados (anio, mes, habilitado_por) VALUES (:anio, :mes, :userId)
         ON DUPLICATE KEY UPDATE habilitado_por = VALUES(habilitado_por), habilitado_en = CURRENT_TIMESTAMP`,
        { replacements: { ...am, userId } });
      // Al habilitar se baja del Ministerio lo más nuevo (robot anual: período completo, no solo el mes,
      // para refrescar también licencias que arrancaron antes). Si no se puede lanzar, el mes queda habilitado igual.
      let robot: 'lanzado' | 'no_lanzado' = 'no_lanzado';
      let robotError: string | undefined;
      try {
        const [cfg] = await sequelize.query<any>(
          `SELECT script, comando FROM robots_config WHERE script = :s AND activo = 1`,
          { replacements: { s: ROBOT_ANUAL }, type: QueryTypes.SELECT });
        if (!cfg?.comando) throw new Error(`Robot ${ROBOT_ANUAL} inexistente o inactivo`);
        await ejecutarAhora(ROBOT_ANUAL);
        robot = 'lanzado';
      } catch (e: any) {
        robotError = e?.message || 'Error lanzando el robot';
        logger.error({ msg: 'samo-ministerio: no se pudo lanzar el robot anual', error: robotError });
      }
      return res.json({ ok: true, robot, robotError });
    } catch (e: any) {
      logger.error({ msg: 'samo-ministerio: error habilitando mes', error: e?.message });
      return res.status(500).json({ ok: false, error: 'Error habilitando el mes' });
    }
  });

  router.delete('/meses/:anio/:mes', admin, async (req: Request, res: Response) => {
    const am = anioMes(req.params.anio, req.params.mes);
    if (!am) return res.status(400).json({ ok: false, error: 'Año/mes inválido' });
    try {
      await ready;
      await sequelize.query(`DELETE FROM samo_meses_habilitados WHERE anio = :anio AND mes = :mes`,
        { replacements: am });
      return res.json({ ok: true });
    } catch (e: any) {
      logger.error({ msg: 'samo-ministerio: error deshabilitando mes', error: e?.message });
      return res.status(500).json({ ok: false, error: 'Error deshabilitando el mes' });
    }
  });

  return router;
}

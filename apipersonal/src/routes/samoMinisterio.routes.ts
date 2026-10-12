// src/routes/samoMinisterio.routes.ts
// SAMO → pestaña "Licencias Ministerio": licencias cargadas en la Intranet del Ministerio
// (tabla ministerio_novedades_anual, robot intranet_descarga_anual) por dependencia,
// una línea por agente con código + fechas del mes. Todo menos 34-FRANCO COMPENSATORIO.
// Cada mes se ve solo si un admin lo habilitó cargando la clave fija SAMO_CLAVE_HABILITACION (.env).
//   GET    /samo-ministerio/meses                  → meses habilitados
//   GET    /samo-ministerio/licencias?anio&mes&dep → filas (403 si el mes no está habilitado)
//   GET    /samo-ministerio/clave                  → clave del .env (solo admin)
//   POST   /samo-ministerio/meses {anio,mes,clave} → habilitar (solo admin)
//   DELETE /samo-ministerio/meses/:anio/:mes       → deshabilitar (solo admin)

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import crypto from 'crypto';
import { requireAny } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';

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

const DEPENDENCIAS = ['HOSPITAL', 'UPA 4', 'UPA 18'];
const CODIGOS_EXCLUIDOS = ['34']; // 34-FRANCO COMPENSATORIO

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
  const admin = requireAny(['usuarios:write', 'crud:*:*']);
  const ready = sequelize.query(DDL).catch((e: any) =>
    logger.error({ msg: 'samo-ministerio: error creando samo_meses_habilitados', error: e?.message }));

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
      const rows = await sequelize.query<any>(
        `SELECT dni, apellido_nombre, legajo, cargo, codigo, novedad,
                DATE_FORMAT(GREATEST(fecha_desde, :ini), '%Y-%m-%d') AS desde,
                DATE_FORMAT(LEAST(fecha_hasta, :fin), '%Y-%m-%d')    AS hasta,
                DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS desde_real,
                DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS hasta_real
           FROM ministerio_novedades_anual
          WHERE dependencia = :dep
            AND fecha_desde <= :fin AND fecha_hasta >= :ini
            AND (codigo IS NULL OR codigo NOT IN (:excl))
          ORDER BY apellido_nombre, dni, fecha_desde, codigo`,
        { replacements: { dep, ini, fin, excl: CODIGOS_EXCLUIDOS }, type: QueryTypes.SELECT });

      // Una línea por agente; descarta duplicados exactos (el Ministerio a veces repite la carga)
      const porDni = new Map<string, any>();
      for (const r of rows) {
        const key = String(r.dni);
        let ag = porDni.get(key);
        if (!ag) {
          ag = { dni: r.dni, apellido_nombre: r.apellido_nombre, legajo: r.legajo, cargo: r.cargo, licencias: [], dias: 0 };
          porDni.set(key, ag);
        }
        const codigo = String(r.codigo || String(r.novedad || '').split('-')[0] || '?').trim();
        if (ag.licencias.some((l: any) => l.codigo === codigo && l.desde === r.desde && l.hasta === r.hasta)) continue;
        ag.licencias.push({
          codigo, novedad: r.novedad, desde: r.desde, hasta: r.hasta,
          desde_real: r.desde_real, hasta_real: r.hasta_real,
        });
        ag.dias += Math.round((Date.parse(r.hasta) - Date.parse(r.desde)) / 86400000) + 1;
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
      return res.json({ ok: true });
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

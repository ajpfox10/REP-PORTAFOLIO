// src/routes/mensajesReloj.routes.ts
// Mensajes personales al reloj desde Gestión (mig 093 mensajes_reloj + mensajes_reloj_envios).
//
// El mensaje aparece en el reloj cuando el agente ficha, mientras esté vigente. Se encola en TODOS los relojes
// activos (la gente entra por uno y sale por otro) como DATA UPDATE SMS + DATA UPDATE USER_SMS en adms_db.devcmds;
// los entrega el ADMS viejo (C:\iclockSvr). Puede tardar hasta ~5 min: el ADMS cachea "reloj sin comandos".
// Texto: sin acentos ni ñ (el ADMS lo pasa a gb18030) y máximo 80 caracteres.
// Con FICHERO_SUBIDA_DESHABILITADA=1 (dev) se guarda en la cola pero NO se manda a los relojes (estado 'simulado').
//
//   GET  /mensajes-reloj?dni=   → historial del agente con el estado en cada reloj
//   POST /mensajes-reloj        → { dni, mensaje, vigencia_min? } encola en los relojes activos
//   POST /mensajes-reloj/masivo → { dnis[], mensaje, vigencia_min? } mismo mensaje a varios agentes (máx. 300)
//   GET  /mensajes-reloj/envios → últimos 30 envíos agrupados, con aceptadas / en cola / con error
//   GET  /mensajes-reloj/relojes → relojes activos para elegir
//   Los dos POST aceptan sns[] (relojes elegidos); sin sns va a todos los activos.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { z } from 'zod';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { cargarConfig, conectarMySQL } from './fichero.routes';

export const MENSAJE_RELOJ_MAX = 80;

export function limpiarMensajeReloj(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MENSAJE_RELOJ_MAX);
}

function subidaDeshabilitada(): boolean {
  return String((env as any).FICHERO_SUBIDA_DESHABILITADA ?? process.env.FICHERO_SUBIDA_DESHABILITADA ?? '') === '1';
}

function ahoraMysql(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// sns: relojes elegidos (adms_db.iclock.SN). Si no viene, van todos los activos.
const snsSchema = z.array(z.string().trim().min(1).max(20)).optional();

const altaSchema = z.object({
  dni:          z.coerce.number().int().positive(),
  mensaje:      z.string(),
  vigencia_min: z.coerce.number().int().min(10).max(10080).optional(),
  sns:          snsSchema,
}).strict();

const MAX_AGENTES = 300;

const masivoSchema = z.object({
  dnis:         z.array(z.coerce.number().int().positive()).min(1, 'Elegí al menos un agente'),
  mensaje:      z.string(),
  vigencia_min: z.coerce.number().int().min(10).max(10080).optional(),
  sns:          snsSchema,
}).strict();

export function buildMensajesRelojRouter(sequelize: Sequelize): Router {
  const router = Router();
  const sel = <T = any>(sql: string, replacements: Record<string, any> = {}): Promise<T[]> =>
    sequelize.query(sql, { replacements, type: QueryTypes.SELECT }) as unknown as Promise<T[]>;
  const usuarioOf = (req: Request): number | null => {
    const auth = (req as any).auth;
    return auth?.principalType === 'user' && Number.isInteger(Number(auth.principalId)) ? Number(auth.principalId) : null;
  };

  // ── Historial del agente ──────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    const dni = parseInt(String(req.query.dni ?? ''), 10);
    if (!Number.isFinite(dni) || dni <= 0) return res.status(400).json({ ok: false, error: 'dni requerido' });
    try {
      const mensajes = await sel<any>(
        `SELECT m.id, m.dni, m.apellido, m.nombre, m.mensaje, m.vigencia_min, m.estado, m.error,
                DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i') AS creado,
                COALESCE(u.nombre, u.email) AS creado_por
           FROM mensajes_reloj m
           LEFT JOIN usuarios u ON u.id = m.created_by
          WHERE m.dni = :dni
          ORDER BY m.id DESC
          LIMIT 20`, { dni });
      const envios = mensajes.length
        ? await sel<any>(
          `SELECT mensaje_id, sn, reloj, devcmd_sms_id, devcmd_user_id
             FROM mensajes_reloj_envios WHERE mensaje_id IN (:ids) ORDER BY id`,
          { ids: mensajes.map(m => m.id) })
        : [];

      // Resultado de cada comando en el ADMS (devcmds vive en adms_db).
      const ids = envios.flatMap(e => [e.devcmd_sms_id, e.devcmd_user_id]).filter(Boolean);
      const cmds = new Map<number, { enviado: string | null; retorno: number | null }>();
      if (ids.length) {
        const conn = await conectarMySQL(cargarConfig());
        try {
          const [rows] = await conn.query<RowDataPacket[]>(
            'SELECT id, CmdTransTime, CmdReturn FROM devcmds WHERE id IN (?)', [ids]);
          for (const r of rows) cmds.set(Number(r.id), { enviado: r.CmdTransTime ?? null, retorno: r.CmdReturn ?? null });
        } finally {
          await conn.end();
        }
      }
      const estadoReloj = (e: any) => {
        const a = cmds.get(Number(e.devcmd_sms_id));
        const b = cmds.get(Number(e.devcmd_user_id));
        if (!a || !b) return 'sin dato';
        if (a.retorno == null || b.retorno == null) return a.enviado ? 'entregando' : 'en cola';
        return a.retorno >= 0 && b.retorno >= 0 ? 'aceptado' : `error ${a.retorno < 0 ? a.retorno : b.retorno}`;
      };
      const data = mensajes.map(m => ({
        ...m,
        relojes: envios.filter(e => e.mensaje_id === m.id).map(e => ({ sn: e.sn, reloj: e.reloj || e.sn, estado: estadoReloj(e) })),
      }));
      return res.json({ ok: true, max: MENSAJE_RELOJ_MAX, data });
    } catch (err: any) {
      logger.error({ msg: 'mensajes-reloj: historial', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // ── Encolar (uno o muchos agentes, mismo mensaje) ─────────────────────────
  // En cada reloj: UN "DATA UPDATE SMS" con el texto + un "DATA UPDATE USER_SMS" por agente, todos con el mismo
  // sms_uid. En la base queda una fila de mensajes_reloj por agente (comparten sms_uid y created_at = un envío).
  async function encolar(req: Request, res: Response, dnisIn: number[], mensajeIn: string, vigenciaIn?: number, snsIn?: string[]) {
    const vigencia = vigenciaIn ?? 1440;
    const snsElegidos = snsIn ? [...new Set(snsIn)] : null;
    if (snsElegidos && !snsElegidos.length) return res.status(400).json({ ok: false, error: 'Elegí al menos un reloj' });
    const mensaje = limpiarMensajeReloj(mensajeIn);
    if (!mensaje) return res.status(400).json({ ok: false, error: 'El mensaje está vacío' });
    if (String(mensajeIn).trim().length > MENSAJE_RELOJ_MAX) {
      return res.status(400).json({ ok: false, error: `Máximo ${MENSAJE_RELOJ_MAX} caracteres` });
    }
    const dnis = [...new Set(dnisIn.map(Number).filter(d => Number.isInteger(d) && d > 0))];
    if (!dnis.length) return res.status(400).json({ ok: false, error: 'Elegí al menos un agente' });
    if (dnis.length > MAX_AGENTES) return res.status(400).json({ ok: false, error: `Máximo ${MAX_AGENTES} agentes por envío` });

    const personas = await sel<{ dni: number; apellido: string; nombre: string }>(
      'SELECT dni, apellido, nombre FROM personal WHERE dni IN (:dnis)', { dnis });
    const porDni = new Map(personas.map(p => [Number(p.dni), p]));
    const faltan = dnis.filter(d => !porDni.has(d));
    if (faltan.length) return res.status(404).json({ ok: false, error: `No existen en personal: ${faltan.join(', ')}` });

    const usuario = usuarioOf(req);
    const ids: number[] = [];
    for (const dni of dnis) {
      const p = porDni.get(dni)!;
      const [ins] = await sequelize.query(
        `INSERT INTO mensajes_reloj (dni, apellido, nombre, mensaje, vigencia_min, estado, created_by)
         VALUES (:dni, :apellido, :nombre, :mensaje, :vigencia, 'pendiente', :usuario)`,
        { replacements: { dni, apellido: p.apellido || '', nombre: p.nombre || '', mensaje, vigencia, usuario } },
      ) as unknown as [number];
      ids.push(Number(ins));
    }
    const smsUid = (ids[0] % 65000) + 500;
    await sequelize.query('UPDATE mensajes_reloj SET sms_uid = :smsUid, created_at = (SELECT c FROM (SELECT created_at c FROM mensajes_reloj WHERE id = :primero) t) WHERE id IN (:ids)',
      { replacements: { smsUid, ids, primero: ids[0] } });

    if (subidaDeshabilitada()) {
      await sequelize.query("UPDATE mensajes_reloj SET estado = 'simulado' WHERE id IN (:ids)", { replacements: { ids } });
      return res.json({ ok: true, ids, agentes: dnis.length, estado: 'simulado', mensaje, relojes: [],
        aviso: 'Instancia con FICHERO_SUBIDA_DESHABILITADA=1: se guardó pero no se mandó a los relojes.' });
    }

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cargarConfig());
      const [activos] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias FROM iclock WHERE State = 1 AND DelTag = 0 ORDER BY Alias');
      const relojes = snsElegidos ? activos.filter(r => snsElegidos.includes(String(r.SN))) : activos;
      if (snsElegidos && relojes.length !== snsElegidos.length) {
        const ok = new Set(relojes.map(r => String(r.SN)));
        throw new Error(`Reloj no activo o inexistente: ${snsElegidos.filter(s => !ok.has(s)).join(', ')}`);
      }
      if (!relojes.length) throw new Error('No hay relojes activos');
      const inicio = ahoraMysql();
      const enviados: Array<{ sn: string; reloj: string }> = [];
      for (const r of relojes) {
        const sn = String(r.SN);
        const reloj = String(r.Alias || sn).trim();
        const [a] = await conn.query<ResultSetHeader>(
          'INSERT INTO devcmds (SN_id, CmdContent, CmdCommitTime) VALUES (?, ?, ?)',
          [sn, `DATA UPDATE SMS MSG=${mensaje}\tTAG=254\tUID=${smsUid}\tMIN=${vigencia}\tStartTime=${inicio}`, inicio]);
        for (let i = 0; i < dnis.length; i++) {
          const [b] = await conn.query<ResultSetHeader>(
            'INSERT INTO devcmds (SN_id, CmdContent, CmdCommitTime) VALUES (?, ?, ?)',
            [sn, `DATA UPDATE USER_SMS PIN=${dnis[i]}\tUID=${smsUid}`, inicio]);
          await sequelize.query(
            `INSERT INTO mensajes_reloj_envios (mensaje_id, sn, reloj, devcmd_sms_id, devcmd_user_id)
             VALUES (:id, :sn, :reloj, :a, :b)`,
            { replacements: { id: ids[i], sn, reloj, a: a.insertId, b: b.insertId } });
        }
        enviados.push({ sn, reloj });
      }
      await sequelize.query("UPDATE mensajes_reloj SET estado = 'encolado' WHERE id IN (:ids)", { replacements: { ids } });
      (res.locals as any).audit = { action: 'mensaje_reloj_enviar', table_name: 'mensajes_reloj', record_pk: ids.join(','), request_json: { dnis, mensaje, vigencia } };
      return res.json({ ok: true, ids, agentes: dnis.length, estado: 'encolado', mensaje, relojes: enviados });
    } catch (err: any) {
      await sequelize.query("UPDATE mensajes_reloj SET estado = 'error', error = :error WHERE id IN (:ids)",
        { replacements: { ids, error: String(err?.message || err).slice(0, 255) } });
      logger.error({ msg: 'mensajes-reloj: encolar', err: err?.message });
      return res.status(500).json({ ok: false, ids, error: err?.message || 'Error' });
    } finally {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
    }
  }

  router.post('/', async (req: Request, res: Response) => {
    const parsed = altaSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Datos inválidos' });
    return encolar(req, res, [parsed.data.dni], parsed.data.mensaje, parsed.data.vigencia_min, parsed.data.sns);
  });

  router.post('/masivo', async (req: Request, res: Response) => {
    const parsed = masivoSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Datos inválidos' });
    return encolar(req, res, parsed.data.dnis, parsed.data.mensaje, parsed.data.vigencia_min, parsed.data.sns);
  });

  // ── Relojes activos para elegir ───────────────────────────────────────────
  router.get('/relojes', async (_req: Request, res: Response) => {
    try {
      const conn = await conectarMySQL(cargarConfig());
      try {
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT SN, Alias, DeviceName, IPAddress, DATE_FORMAT(LastActivity, '%Y-%m-%d %H:%i') AS ultima
             FROM iclock WHERE State = 1 AND DelTag = 0 ORDER BY Alias`);
        return res.json({ ok: true, data: rows.map(r => ({
          sn: String(r.SN), alias: String(r.Alias || r.SN).trim(), modelo: r.DeviceName || null, ip: r.IPAddress || null, ultima: r.ultima || null,
        })) });
      } finally {
        await conn.end();
      }
    } catch (err: any) {
      logger.error({ msg: 'mensajes-reloj: relojes', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // ── Envíos recientes (agrupados: mismo sms_uid + mismo momento = un envío) ─
  router.get('/envios', async (_req: Request, res: Response) => {
    try {
      const grupos = await sel<any>(
        `SELECT m.sms_uid, DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS creado, m.mensaje, m.vigencia_min,
                MIN(m.estado) AS estado, COUNT(*) AS agentes,
                GROUP_CONCAT(CONCAT(m.apellido, ', ', m.nombre) ORDER BY m.apellido SEPARATOR ' · ') AS destinatarios,
                MIN(m.id) AS primer_id, COALESCE(MIN(u.nombre), MIN(u.email)) AS creado_por
           FROM mensajes_reloj m
           LEFT JOIN usuarios u ON u.id = m.created_by
          GROUP BY m.sms_uid, m.created_at, m.mensaje, m.vigencia_min
          ORDER BY primer_id DESC
          LIMIT 30`);
      // Aceptados / total por envío, leyendo devcmds del ADMS.
      const ids = grupos.length
        ? await sel<any>(
          `SELECT m.sms_uid, DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS creado, e.devcmd_user_id
             FROM mensajes_reloj m JOIN mensajes_reloj_envios e ON e.mensaje_id = m.id
            WHERE m.id >= :desde`, { desde: Math.min(...grupos.map(g => Number(g.primer_id))) })
        : [];
      const retorno = new Map<number, number | null>();
      const cmdIds = ids.map(i => Number(i.devcmd_user_id)).filter(Boolean);
      if (cmdIds.length) {
        const conn = await conectarMySQL(cargarConfig());
        try {
          const [rows] = await conn.query<RowDataPacket[]>('SELECT id, CmdReturn FROM devcmds WHERE id IN (?)', [cmdIds]);
          for (const r of rows) retorno.set(Number(r.id), r.CmdReturn == null ? null : Number(r.CmdReturn));
        } finally {
          await conn.end();
        }
      }
      const data = grupos.map(g => {
        const mios = ids.filter(i => i.sms_uid === g.sms_uid && i.creado === g.creado);
        const ret = mios.map(i => retorno.get(Number(i.devcmd_user_id)));
        return {
          ...g,
          asignaciones: mios.length,
          aceptadas: ret.filter(v => v != null && v >= 0).length,
          con_error: ret.filter(v => v != null && v < 0).length,
          en_cola: ret.filter(v => v == null).length,
        };
      });
      return res.json({ ok: true, data });
    } catch (err: any) {
      logger.error({ msg: 'mensajes-reloj: envios', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  return router;
}
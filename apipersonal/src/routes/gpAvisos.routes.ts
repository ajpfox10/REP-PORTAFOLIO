// src/routes/gpAvisos.routes.ts
// Avisos por WhatsApp a los agentes que el robot intranet_gp_confirmar confirmó en Gestiones
// Personales (Intranet MS; clave provisoria = DNI). El robot anota cada confirmado PENDIENTE en
// gp_avisos_whatsapp (mig 127); la página /app/gestiones-personales-avisos hace que la extensión
// deje el mensaje ESCRITO chat por chat y la persona toca Enviar y lo marca ENVIADO.
// Cada cambio queda en gp_avisos_historial (mig 128) con el usuario; la tarjeta de Herramientas
// del dashboard (GpAvisosTile.tsx) muestra el resumen.
import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../logging/logger';
import { celularDe } from './licenciasMedicasControl.routes';

const ESTADOS = ['PENDIENTE', 'ESCRITO', 'ENVIADO', 'OMITIDO'] as const;
const MENSAJE_DEFAULT = 'Hola {nombre}, ya está confirmado tu usuario de Gestiones Personales del Ministerio. '
  + 'Entrá con tu DNI como clave provisoria y cambiala por una propia.';

let tablasOk = false;
async function ensureTablas(sequelize: Sequelize) {
  if (tablasOk) return;
  await sequelize.query(`CREATE TABLE IF NOT EXISTS gp_avisos_whatsapp (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, dni INT NOT NULL, cuil VARCHAR(11) NOT NULL, legajo VARCHAR(10) NULL,
    agente VARCHAR(150) NULL, confirmado_el DATE NOT NULL, confirmado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado ENUM('PENDIENTE','ESCRITO','ENVIADO','OMITIDO') NOT NULL DEFAULT 'PENDIENTE', estado_at DATETIME NULL,
    telefono VARCHAR(30) NULL, detalle VARCHAR(300) NULL,
    UNIQUE KEY uq_gpaw_cuil_dia (cuil, confirmado_el), KEY ix_gpaw_estado (estado), KEY ix_gpaw_dni (dni)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS gp_avisos_config (
    id TINYINT NOT NULL PRIMARY KEY, mensaje TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await sequelize.query(`INSERT IGNORE INTO gp_avisos_config (id, mensaje) VALUES (1, :m)`, { replacements: { m: MENSAJE_DEFAULT } });
  // Historial (mig 128): cada cambio de estado con el usuario que lo hizo
  await sequelize.query(`CREATE TABLE IF NOT EXISTS gp_avisos_historial (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, aviso_id INT NOT NULL, dni INT NOT NULL, agente VARCHAR(150) NULL,
    estado_anterior VARCHAR(12) NULL, estado VARCHAR(12) NOT NULL, telefono VARCHAR(30) NULL, detalle VARCHAR(300) NULL,
    usuario_id INT NULL, usuario_email VARCHAR(200) NULL, at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_gpah_aviso (aviso_id), KEY ix_gpah_at (at), KEY ix_gpah_dni (dni)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  // Lo anterior a la tabla: una fila por aviso con su estado vigente (sin usuario)
  await sequelize.query(`INSERT INTO gp_avisos_historial (aviso_id, dni, agente, estado_anterior, estado, telefono, detalle, at)
    SELECT a.id, a.dni, a.agente, NULL,
           CASE WHEN a.estado = 'PENDIENTE' AND a.detalle IS NOT NULL THEN 'ERROR' ELSE a.estado END,
           a.telefono, a.detalle, a.estado_at
      FROM gp_avisos_whatsapp a
     WHERE a.estado_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gp_avisos_historial h WHERE h.aviso_id = a.id)`);
  tablasOk = true;
}

export function buildGpAvisosRouter(sequelize: Sequelize) {
  const r = Router();
  const q = <T = any>(sql: string, replacements: any = {}) =>
    sequelize.query(sql, { type: QueryTypes.SELECT, replacements }) as Promise<T[]>;
  const fallo = (res: Response, e: any, donde: string) => {
    logger.error({ msg: `gp-avisos ${donde}`, error: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'Error' });
  };

  // Resumen para la tarjeta de Herramientas (dashboard): cantidades, quiénes y últimos movimientos
  r.get('/resumen', async (_req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const [x] = await q<any>(`SELECT SUM(estado='PENDIENTE') AS pendientes, SUM(estado='ESCRITO') AS escritos,
                                       SUM(estado='ENVIADO') AS enviados, SUM(estado='OMITIDO') AS omitidos,
                                       SUM(estado='ENVIADO' AND DATE(estado_at) = CURDATE()) AS enviados_hoy,
                                       SUM(estado='PENDIENTE' AND detalle IS NOT NULL) AS con_error,
                                       SUM(estado='PENDIENTE' AND detalle LIKE 'SIN_WHATSAPP%') AS sin_whatsapp
                                  FROM gp_avisos_whatsapp`);
      const [run] = await q<any>(`SELECT estado, motivo, DATE_FORMAT(actualizado_at, '%Y-%m-%d %H:%i') AS at
                                    FROM script_runs WHERE script = 'intranet_gp_confirmar' ORDER BY id DESC LIMIT 1`).catch(() => [] as any[]);
      const faltan = await q<any>(`SELECT id, dni, agente, estado, LEFT(detalle, 120) AS detalle
                                     FROM gp_avisos_whatsapp WHERE estado IN ('PENDIENTE','ESCRITO')
                                    ORDER BY estado, confirmado_at DESC LIMIT 30`);
      const ultimos = await q<any>(`SELECT id, dni, agente, estado, LEFT(detalle, 120) AS detalle, usuario_email,
                                           DATE_FORMAT(at, '%Y-%m-%d %H:%i') AS at
                                      FROM gp_avisos_historial ORDER BY at DESC, id DESC LIMIT 12`);
      // La misma persona confirmada más de una vez (sin omitidos) con algo por mandar: le llegaría repetido
      const repetidos = await q<any>(`SELECT dni, MAX(agente) AS agente, COUNT(*) AS n, SUM(estado='ENVIADO') AS enviados
                                        FROM gp_avisos_whatsapp WHERE estado <> 'OMITIDO'
                                       GROUP BY dni HAVING COUNT(*) > 1 AND SUM(estado IN ('PENDIENTE','ESCRITO')) > 0`);
      const n = (v: any) => Number(v || 0);
      res.json({ ok: true, pendientes: n(x?.pendientes), escritos: n(x?.escritos), enviados: n(x?.enviados),
                 enviados_hoy: n(x?.enviados_hoy), omitidos: n(x?.omitidos), con_error: n(x?.con_error),
                 sin_whatsapp: n(x?.sin_whatsapp), robot: run || null, faltan, ultimos,
                 repetidos: repetidos.map(z => ({ ...z, n: n(z.n), enviados: n(z.enviados) })) });
    } catch (e) { fallo(res, e, 'resumen'); }
  });

  // Historial de movimientos: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&q=nombre o DNI (últimos 1000)
  r.get('/historial', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const fecha = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
      const desde = fecha(req.query.desde), hasta = fecha(req.query.hasta);
      const texto = String(req.query.q || '').trim().slice(0, 60);
      const cond: string[] = [];
      if (desde) cond.push('at >= :desde');
      if (hasta) cond.push('at < DATE_ADD(:hasta, INTERVAL 1 DAY)');
      if (texto) cond.push(/^\d+$/.test(texto) ? 'dni = :dni' : 'agente LIKE :txt');
      const rows = await q<any>(
        `SELECT id, aviso_id, dni, agente, estado_anterior, estado, telefono, detalle, usuario_email,
                DATE_FORMAT(at, '%Y-%m-%d %H:%i') AS at
           FROM gp_avisos_historial
          ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
          ORDER BY at DESC, id DESC LIMIT 1000`,
        { desde, hasta, dni: Number(texto) || 0, txt: `%${texto}%` });
      res.json({ ok: true, data: rows });
    } catch (e) { fallo(res, e, 'historial'); }
  });

  // Lista: por defecto lo que falta (PENDIENTE + ESCRITO); ?todos=1 trae también enviados/omitidos (últimos 200)
  r.get('/', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const todos = String(req.query.todos || '') === '1';
      const rows = await q<any>(
        `SELECT a.id, a.dni, a.cuil, a.legajo, a.agente, DATE_FORMAT(a.confirmado_at, '%Y-%m-%d %H:%i') AS confirmado_at,
                a.estado, DATE_FORMAT(a.estado_at, '%Y-%m-%d %H:%i') AS estado_at, a.telefono AS telefono_usado, a.detalle,
                p.apellido, p.nombre, p.telefono
           FROM gp_avisos_whatsapp a
           LEFT JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
          ${todos ? '' : "WHERE a.estado IN ('PENDIENTE','ESCRITO')"}
          ORDER BY a.estado = 'ESCRITO', a.confirmado_at DESC, a.id DESC
          LIMIT 500`);
      const [cfg] = await q<any>(`SELECT mensaje FROM gp_avisos_config WHERE id = 1`);
      res.json({
        ok: true, mensaje: cfg?.mensaje || MENSAJE_DEFAULT,
        data: rows.map(x => { const { telefono, ...resto } = x; return { ...resto, ...celularDe(telefono) }; }),
      });
    } catch (e) { fallo(res, e, 'lista'); }
  });

  // Últimas corridas del robot que confirma (página Robots: script_runs)
  r.get('/robot', async (_req: Request, res: Response) => {
    try {
      const rows = await q<any>(`SELECT id, estado, motivo, duracion_seg, DATE_FORMAT(actualizado_at, '%Y-%m-%d %H:%i') AS at
                                   FROM script_runs WHERE script = 'intranet_gp_confirmar' ORDER BY id DESC LIMIT 20`);
      res.json({ ok: true, data: rows });
    } catch (e) { fallo(res, e, 'robot'); }
  });

  r.put('/mensaje', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const m = String(req.body?.mensaje ?? '').trim();
      if (m.length < 5 || m.length > 2000) return res.status(400).json({ ok: false, error: 'El mensaje tiene que tener entre 5 y 2000 caracteres' });
      await sequelize.query(`UPDATE gp_avisos_config SET mensaje = :m WHERE id = 1`, { replacements: { m } });
      res.json({ ok: true });
    } catch (e) { fallo(res, e, 'mensaje'); }
  });

  // Cambia el estado de uno o varios: { ids: number[], estado, telefono?, detalle? }
  r.post('/estado', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
      const estado = String(req.body?.estado || '');
      if (!ids.length || ids.length > 500) return res.status(400).json({ ok: false, error: 'ids inválidos' });
      if (!(ESTADOS as readonly string[]).includes(estado)) return res.status(400).json({ ok: false, error: 'estado inválido' });
      const tel = req.body?.telefono ? String(req.body.telefono).replace(/[^\d+]/g, '').slice(0, 30) : null;
      const det = req.body?.detalle ? String(req.body.detalle).slice(0, 300) : null;
      const antes = await q<any>(`SELECT id, dni, agente, estado, detalle, telefono FROM gp_avisos_whatsapp WHERE id IN (:ids)`, { ids });
      await sequelize.query(
        `UPDATE gp_avisos_whatsapp SET estado = :estado, estado_at = NOW(),
                telefono = COALESCE(:tel, telefono), detalle = :det
          WHERE id IN (:ids)`, { replacements: { estado, tel, det, ids } });
      // Historial con el usuario que lo hizo. Un PENDIENTE con detalle es un intento fallido (ERROR).
      try {
        const userId = Number((req as any).auth?.principalId) || null;
        const [u] = userId ? await q<any>(`SELECT email FROM usuarios WHERE id = :id LIMIT 1`, { id: userId }).catch(() => [] as any[]) : [];
        const comoHist = (est: string, d: string | null) => (est === 'PENDIENTE' && d ? 'ERROR' : est);
        for (const a of antes) {
          await sequelize.query(
            `INSERT INTO gp_avisos_historial (aviso_id, dni, agente, estado_anterior, estado, telefono, detalle, usuario_id, usuario_email)
             VALUES (:id, :dni, :agente, :ant, :est, :tel, :det, :uid, :email)`,
            { replacements: { id: a.id, dni: a.dni, agente: a.agente, ant: comoHist(a.estado, a.detalle), est: comoHist(estado, det),
                              tel: tel || a.telefono || null, det, uid: userId, email: u?.email || null } });
        }
      } catch (e: any) { logger.error({ msg: 'gp-avisos historial', error: e?.message }); }
      res.json({ ok: true });
    } catch (e) { fallo(res, e, 'estado'); }
  });

  return r;
}

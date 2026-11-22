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
  // PCs que pueden mandar: cada navegador con la app abierta y la extensión de WhatsApp se anota
  // solo con un id propio (localStorage) y da señal cada minuto; el nombre se pone desde cualquier PC.
  // (Reemplaza a gp_avisos_pcs, que pedía poner el nombre en la misma PC.)
  await sequelize.query(`CREATE TABLE IF NOT EXISTS gp_avisos_equipos (
    id VARCHAR(40) NOT NULL PRIMARY KEY, nombre VARCHAR(60) NULL, ip VARCHAR(45) NULL,
    usuario_email VARCHAR(200) NULL, ext_version VARCHAR(20) NULL, ultima_senal DATETIME NOT NULL,
    creado_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  // Envíos programados: a quiénes, cuándo (hora local de las PCs), qué PC (id de gp_avisos_equipos) y si deja escrito o envía solo
  await sequelize.query(`CREATE TABLE IF NOT EXISTS gp_avisos_programados (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, aviso_ids TEXT NOT NULL, telefonos TEXT NULL,
    cuando DATETIME NOT NULL, pc VARCHAR(60) NOT NULL, modo ENUM('ESCRIBIR','ENVIAR') NOT NULL,
    mensaje TEXT NOT NULL,
    estado ENUM('PROGRAMADO','EN_CURSO','HECHO','CANCELADO','ERROR') NOT NULL DEFAULT 'PROGRAMADO',
    creado_por VARCHAR(200) NULL, creado_at DATETIME NOT NULL, tomado_at DATETIME NULL, terminado_at DATETIME NULL,
    resultado VARCHAR(300) NULL,
    KEY ix_gpap_pc_estado (pc, estado, cuando)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  // Envío automático diario (config en gp_avisos_config): a la hora, en la PC, con el modo elegido
  const cols = await sequelize.query<any>(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gp_avisos_config'`,
    { type: QueryTypes.SELECT });
  const hay = new Set(cols.map(x => x.c));
  const agregar: [string, string][] = [
    ['auto_activo', 'TINYINT(1) NOT NULL DEFAULT 0'], ['auto_hora', "CHAR(5) NOT NULL DEFAULT '10:00'"],
    ['auto_pc', 'VARCHAR(40) NULL'], ['auto_modo', "ENUM('ESCRIBIR','ENVIAR') NOT NULL DEFAULT 'ESCRIBIR'"],
    ['auto_solo_habiles', 'TINYINT(1) NOT NULL DEFAULT 1'], ['auto_ultimo', 'DATE NULL'],
  ];
  for (const [c, def] of agregar) if (!hay.has(c)) await sequelize.query(`ALTER TABLE gp_avisos_config ADD COLUMN ${c} ${def}`);
  tablasOk = true;
}

/** Fecha-hora local del servidor 'YYYY-MM-DD HH:MM:SS' (la sesión de MySQL va en UTC). */
function ahoraLocal(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const NOMBRE_PC = /^[\p{L}\p{N} ._\-]{2,60}$/u;
const ID_PC = /^[a-z0-9-]{8,40}$/;
/** IP de quien llama (sin el ::ffff: de IPv4 mapeada). */
function ipDe(req: Request) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (xf || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 45) || null;
}
/** Cómo se muestra una PC: su nombre, o IP · usuario si todavía no tiene. */
function etiquetaPc(x: { nombre?: string | null; ip?: string | null; usuario_email?: string | null; id?: string }) {
  return x.nombre || [x.ip, x.usuario_email ? String(x.usuario_email).split('@')[0] : null].filter(Boolean).join(' · ') || x.id || '?';
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

  // Estadística de reseteos (cada fila de gp_avisos_whatsapp = un reseteo que hizo el robot):
  // ?desde=YYYY-MM&hasta=YYYY-MM (inclusive). Devuelve por mes, por agente y por servicio actual.
  r.get('/estadistica', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const mes = (v: any) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : null);
      const desde = mes(req.query.desde), hasta = mes(req.query.hasta);
      const cond: string[] = [];
      if (desde) cond.push(`w.confirmado_el >= :desde`);
      if (hasta) cond.push(`w.confirmado_el < DATE_ADD(:hasta, INTERVAL 1 MONTH)`);
      const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
      const params = { desde: desde ? `${desde}-01` : null, hasta: hasta ? `${hasta}-01` : null };
      const servicioSql = `(SELECT srv.nombre FROM agentes_servicios ags JOIN servicios srv ON srv.id = ags.servicio_id
                             WHERE ags.dni = w.dni AND ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
                             ORDER BY ags.id DESC LIMIT 1)`;
      const porMes = await q<any>(
        `SELECT DATE_FORMAT(w.confirmado_el, '%Y-%m') AS mes, COUNT(*) AS reseteos, COUNT(DISTINCT w.dni) AS personas,
                SUM(w.estado = 'ENVIADO') AS avisados
           FROM gp_avisos_whatsapp w ${where} GROUP BY mes ORDER BY mes DESC`, params);
      const porAgente = await q<any>(
        `SELECT w.dni, MAX(w.legajo) AS legajo,
                COALESCE(MAX(CONCAT(p.apellido, ', ', p.nombre)), MAX(w.agente)) AS agente,
                COUNT(*) AS reseteos, COUNT(DISTINCT DATE_FORMAT(w.confirmado_el, '%Y-%m')) AS meses,
                GROUP_CONCAT(DATE_FORMAT(w.confirmado_el, '%d/%m/%Y') ORDER BY w.confirmado_el DESC SEPARATOR ', ') AS fechas,
                DATE_FORMAT(MAX(w.confirmado_el), '%Y-%m-%d') AS ultimo, SUM(w.estado = 'ENVIADO') AS avisados,
                MAX(${servicioSql}) AS servicio
           FROM gp_avisos_whatsapp w
           LEFT JOIN personal p ON p.dni = w.dni AND p.deleted_at IS NULL
          ${where}
          GROUP BY w.dni ORDER BY reseteos DESC, ultimo DESC`, params);
      const porServicioMap = new Map<string, { servicio: string; reseteos: number; personas: number }>();
      for (const a of porAgente) {
        const k = a.servicio || '(sin servicio)';
        const s = porServicioMap.get(k) || { servicio: k, reseteos: 0, personas: 0 };
        s.reseteos += Number(a.reseteos || 0); s.personas += 1;
        porServicioMap.set(k, s);
      }
      const n = (v: any) => Number(v || 0);
      res.json({
        ok: true,
        porMes: porMes.map(m => ({ ...m, reseteos: n(m.reseteos), personas: n(m.personas), avisados: n(m.avisados) })),
        porAgente: porAgente.map(a => ({ ...a, reseteos: n(a.reseteos), meses: n(a.meses), avisados: n(a.avisados) })),
        porServicio: [...porServicioMap.values()].sort((a, b) => b.reseteos - a.reseteos),
      });
    } catch (e) { fallo(res, e, 'estadistica'); }
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
      const [cfg] = await q<any>(`SELECT mensaje, auto_activo, auto_hora, auto_pc, auto_modo, auto_solo_habiles,
                                         DATE_FORMAT(auto_ultimo, '%Y-%m-%d') AS auto_ultimo FROM gp_avisos_config WHERE id = 1`);
      res.json({
        ok: true, mensaje: cfg?.mensaje || MENSAJE_DEFAULT,
        auto: { activo: !!Number(cfg?.auto_activo), hora: cfg?.auto_hora || '10:00', pc: cfg?.auto_pc || '',
                modo: cfg?.auto_modo || 'ESCRIBIR', solo_habiles: !!Number(cfg?.auto_solo_habiles ?? 1), ultimo: cfg?.auto_ultimo || null },
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

  // Envío automático diario: { activo, hora: 'HH:MM', pc (id de equipo), modo, solo_habiles }
  r.put('/auto', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const activo = !!req.body?.activo;
      const hora = String(req.body?.hora || '');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return res.status(400).json({ ok: false, error: 'Hora inválida' });
      const modo = String(req.body?.modo || '');
      if (modo !== 'ESCRIBIR' && modo !== 'ENVIAR') return res.status(400).json({ ok: false, error: 'Modo inválido' });
      const pc = String(req.body?.pc || '').trim();
      if (activo && (!ID_PC.test(pc) || !(await q<any>(`SELECT 1 FROM gp_avisos_equipos WHERE id = :pc`, { pc })).length)) {
        return res.status(400).json({ ok: false, error: 'Elegí la PC que manda el automático' });
      }
      await sequelize.query(
        `UPDATE gp_avisos_config SET auto_activo = :a, auto_hora = :h, auto_pc = :pc, auto_modo = :m, auto_solo_habiles = :sh WHERE id = 1`,
        { replacements: { a: activo ? 1 : 0, h: hora, pc: pc || null, m: modo, sh: req.body?.solo_habiles === false ? 0 : 1 } });
      res.json({ ok: true });
    } catch (e) { fallo(res, e, 'auto'); }
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

  // ── PCs y envíos programados ──────────────────────────────────────────────
  const emailDe = async (req: Request) => {
    const userId = Number((req as any).auth?.principalId) || null;
    if (!userId) return null;
    const [u] = await q<any>(`SELECT email FROM usuarios WHERE id = :id LIMIT 1`, { id: userId }).catch(() => [] as any[]);
    return u?.email || null;
  };

  // Señal de vida de un navegador con la extensión: { id, version }. Se anota solo (IP + usuario).
  r.post('/pcs/senal', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const id = String(req.body?.id || '').trim();
      if (!ID_PC.test(id)) return res.status(400).json({ ok: false, error: 'Id de PC inválido' });
      const ver = req.body?.version ? String(req.body.version).slice(0, 20) : null;
      const at = ahoraLocal();
      await sequelize.query(
        `INSERT INTO gp_avisos_equipos (id, ip, usuario_email, ext_version, ultima_senal, creado_at) VALUES (:id, :ip, :e, :v, :at, :at)
         ON DUPLICATE KEY UPDATE ip = VALUES(ip), usuario_email = VALUES(usuario_email), ext_version = VALUES(ext_version), ultima_senal = VALUES(ultima_senal)`,
        { replacements: { id, ip: ipDe(req), e: await emailDe(req), v: ver, at } });
      const [x] = await q<any>(`SELECT nombre FROM gp_avisos_equipos WHERE id = :id`, { id });
      res.json({ ok: true, nombre: x?.nombre || null });
    } catch (e) { fallo(res, e, 'pcs/senal'); }
  });

  // PCs vistas en los últimos 30 días (las activas primero)
  r.get('/pcs', async (_req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const ahora = ahoraLocal();
      const rows = await q<any>(`SELECT id, nombre, ip, usuario_email, ext_version, DATE_FORMAT(ultima_senal, '%Y-%m-%d %H:%i') AS ultima_senal,
                                        TIMESTAMPDIFF(MINUTE, ultima_senal, :ahora) AS minutos
                                   FROM gp_avisos_equipos WHERE ultima_senal >= DATE_SUB(:ahora, INTERVAL 30 DAY)
                                  ORDER BY ultima_senal DESC`, { ahora });
      res.json({ ok: true, data: rows.map(x => ({ ...x, etiqueta: etiquetaPc(x), minutos: Number(x.minutos), activa: Number(x.minutos) <= 3 })) });
    } catch (e) { fallo(res, e, 'pcs'); }
  });

  // Ponerle (o sacarle) nombre a una PC desde cualquier lado: { nombre }
  r.put('/pcs/:id/nombre', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const nombre = String(req.body?.nombre || '').trim();
      if (nombre && !NOMBRE_PC.test(nombre)) return res.status(400).json({ ok: false, error: 'De 2 a 60 letras, números, espacios, punto o guion' });
      const [x] = await sequelize.query(`UPDATE gp_avisos_equipos SET nombre = :n WHERE id = :id`,
        { replacements: { n: nombre || null, id: String(req.params.id) } }) as any;
      if (!x?.affectedRows && !x?.changedRows && !(await q<any>(`SELECT 1 FROM gp_avisos_equipos WHERE id = :id`, { id: String(req.params.id) })).length) {
        return res.status(404).json({ ok: false, error: 'PC inexistente' });
      }
      res.json({ ok: true });
    } catch (e) { fallo(res, e, 'pcs/nombre'); }
  });

  r.delete('/pcs/:id', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      await sequelize.query(`DELETE FROM gp_avisos_equipos WHERE id = :id`, { replacements: { id: String(req.params.id) } });
      res.json({ ok: true });
    } catch (e) { fallo(res, e, 'pcs/borrar'); }
  });

  const parseIds = (s: string) => String(s || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);

  /**
   * Envío automático diario. Se evalúa cuando la PC del automático pide trabajo (cada minuto):
   * si está activo, ya pasó la hora de hoy (y es día hábil si se pidió) y todavía no se armó el de
   * hoy, crea un programado con TODOS los PENDIENTE sin error que no estén ya en otro programado.
   * Se marca el día antes de crear (UPDATE condicional): no se duplica aunque pidan dos a la vez.
   * Si la PC estuvo apagada, sale cuando se prenda ese mismo día; si no, al día siguiente entran todos.
   */
  async function crearAutomaticoSiToca(pc: string, ahora: string) {
    const [cfg] = await q<any>(`SELECT mensaje, auto_activo, auto_hora, auto_pc, auto_modo, auto_solo_habiles,
                                       DATE_FORMAT(auto_ultimo, '%Y-%m-%d') AS auto_ultimo FROM gp_avisos_config WHERE id = 1`);
    if (!cfg || !Number(cfg.auto_activo) || cfg.auto_pc !== pc) return;
    const hoy = ahora.slice(0, 10);
    if (cfg.auto_ultimo === hoy || ahora.slice(11, 16) < cfg.auto_hora) return;
    const dia = new Date().getDay(); // 0 = domingo, 6 = sábado (hora local del servidor)
    if (Number(cfg.auto_solo_habiles) && (dia === 0 || dia === 6)) return;
    const [m] = await sequelize.query(
      `UPDATE gp_avisos_config SET auto_ultimo = :hoy WHERE id = 1 AND (auto_ultimo IS NULL OR auto_ultimo < :hoy)`,
      { replacements: { hoy } }) as any;
    if (!m?.affectedRows) return;
    const enCurso = await q<any>(`SELECT aviso_ids FROM gp_avisos_programados WHERE estado IN ('PROGRAMADO','EN_CURSO')`);
    const ocupados = new Set(enCurso.flatMap(x => parseIds(x.aviso_ids)));
    const pend = (await q<any>(`SELECT id FROM gp_avisos_whatsapp WHERE estado = 'PENDIENTE' AND detalle IS NULL ORDER BY confirmado_at`))
      .map(x => Number(x.id)).filter(id => !ocupados.has(id));
    if (!pend.length) return;
    await sequelize.query(
      `INSERT INTO gp_avisos_programados (aviso_ids, telefonos, cuando, pc, modo, mensaje, creado_por, creado_at)
       VALUES (:ids, '{}', :cuando, :pc, :modo, :mensaje, 'automático diario', :at)`,
      { replacements: { ids: pend.slice(0, 300).join(','), cuando: `${hoy} ${cfg.auto_hora}:00`, pc, modo: cfg.auto_modo,
                        mensaje: cfg.mensaje || MENSAJE_DEFAULT, at: ahora } });
  }

  // Lista de programados (los últimos 100) con los nombres de los agentes
  r.get('/programados', async (_req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const rows = await q<any>(
        `SELECT id, aviso_ids, DATE_FORMAT(cuando, '%Y-%m-%d %H:%i') AS cuando, pc, modo, estado, creado_por,
                DATE_FORMAT(creado_at, '%Y-%m-%d %H:%i') AS creado_at, DATE_FORMAT(terminado_at, '%Y-%m-%d %H:%i') AS terminado_at,
                resultado, :ahora >= cuando AS vencido
           FROM gp_avisos_programados ORDER BY estado IN ('PROGRAMADO','EN_CURSO') DESC, cuando DESC LIMIT 100`, { ahora: ahoraLocal() });
      const todos = [...new Set(rows.flatMap(x => parseIds(x.aviso_ids)))];
      const ag = todos.length ? await q<any>(`SELECT id, agente FROM gp_avisos_whatsapp WHERE id IN (:ids)`, { ids: todos }) : [];
      const nom = new Map(ag.map(a => [a.id, a.agente]));
      const pcIds = [...new Set(rows.map(x => x.pc))];
      const eq = pcIds.length ? await q<any>(`SELECT id, nombre, ip, usuario_email FROM gp_avisos_equipos WHERE id IN (:ids)`, { ids: pcIds }) : [];
      const pcNom = new Map(eq.map(e => [e.id, etiquetaPc(e)]));
      res.json({ ok: true, data: rows.map(x => {
        const ids = parseIds(x.aviso_ids);
        const { aviso_ids: _a, ...resto } = x;
        return { ...resto, pc_etiqueta: pcNom.get(x.pc) || x.pc, vencido: !!Number(x.vencido), ids, agentes: ids.map(i => nom.get(i) || `#${i}`) };
      }) });
    } catch (e) { fallo(res, e, 'programados'); }
  });

  // Programar: { ids, cuando: 'YYYY-MM-DDTHH:MM', pc, modo: ESCRIBIR|ENVIAR, mensaje, telefonos?: {id: tel} }
  r.post('/programados', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
      if (!ids.length || ids.length > 300) return res.status(400).json({ ok: false, error: 'Elegí al menos un agente' });
      const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(req.body?.cuando || ''));
      if (!m) return res.status(400).json({ ok: false, error: 'Fecha y hora inválidas' });
      const pc = String(req.body?.pc || '').trim();
      if (!ID_PC.test(pc) || !(await q<any>(`SELECT 1 FROM gp_avisos_equipos WHERE id = :pc`, { pc })).length) {
        return res.status(400).json({ ok: false, error: 'Elegí la PC que lo manda' });
      }
      const modo = String(req.body?.modo || '');
      if (modo !== 'ESCRIBIR' && modo !== 'ENVIAR') return res.status(400).json({ ok: false, error: 'Modo inválido' });
      const mensaje = String(req.body?.mensaje || '').trim();
      if (mensaje.length < 5 || mensaje.length > 2000) return res.status(400).json({ ok: false, error: 'El mensaje tiene que tener entre 5 y 2000 caracteres' });
      const tels: Record<string, string> = {};
      const tIn = req.body?.telefonos && typeof req.body.telefonos === 'object' ? req.body.telefonos : {};
      for (const id of ids) { const t = String(tIn[id] ?? '').replace(/[^\d+]/g, '').slice(0, 30); if (t) tels[id] = t; }
      const vivos = await q<any>(`SELECT id FROM gp_avisos_whatsapp WHERE id IN (:ids) AND estado IN ('PENDIENTE','ESCRITO')`, { ids });
      if (!vivos.length) return res.status(400).json({ ok: false, error: 'Ninguno de los elegidos está para avisar' });
      await sequelize.query(
        `INSERT INTO gp_avisos_programados (aviso_ids, telefonos, cuando, pc, modo, mensaje, creado_por, creado_at)
         VALUES (:ids, :tels, :cuando, :pc, :modo, :mensaje, :por, :at)`,
        { replacements: { ids: vivos.map(v => v.id).join(','), tels: JSON.stringify(tels), cuando: `${m[1]} ${m[2]}:00`,
                          pc, modo, mensaje, por: await emailDe(req), at: ahoraLocal() } });
      res.json({ ok: true, programados: vivos.length });
    } catch (e) { fallo(res, e, 'programar'); }
  });

  r.post('/programados/:id/cancelar', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const [x] = await sequelize.query(
        `UPDATE gp_avisos_programados SET estado = 'CANCELADO', terminado_at = :at, resultado = :r
          WHERE id = :id AND estado = 'PROGRAMADO'`,
        { replacements: { id: Number(req.params.id), at: ahoraLocal(), r: `Cancelado por ${(await emailDe(req)) || 'usuario'}` } }) as any;
      if (!x?.affectedRows) return res.status(409).json({ ok: false, error: 'Ya no está programado (arrancó o terminó)' });
      res.json({ ok: true });
    } catch (e) { fallo(res, e, 'cancelar'); }
  });

  // La PC pide trabajo: { pc } → toma el programado vencido más viejo de esa PC (uno solo, sin duplicar)
  r.post('/programados/tomar', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const pc = String(req.body?.pc || '').trim();
      if (!ID_PC.test(pc)) return res.status(400).json({ ok: false, error: 'PC inválida' });
      const ahora = ahoraLocal();
      // Uno que quedó EN_CURSO más de 3 h: se cerró la página a mitad de camino
      await sequelize.query(
        `UPDATE gp_avisos_programados SET estado = 'ERROR', terminado_at = :ahora,
                resultado = 'Se cortó a mitad de camino (se cerró la página o la PC); los que faltaban siguen para avisar'
          WHERE estado = 'EN_CURSO' AND tomado_at < DATE_SUB(:ahora, INTERVAL 3 HOUR)`, { replacements: { ahora } });
      await crearAutomaticoSiToca(pc, ahora).catch((e: any) => logger.error({ msg: 'gp-avisos automático', error: e?.message }));
      const [cand] = await q<any>(`SELECT id FROM gp_avisos_programados WHERE pc = :pc AND estado = 'PROGRAMADO' AND cuando <= :ahora
                                    ORDER BY cuando, id LIMIT 1`, { pc, ahora });
      if (!cand) return res.json({ ok: true, trabajo: null });
      const [upd] = await sequelize.query(
        `UPDATE gp_avisos_programados SET estado = 'EN_CURSO', tomado_at = :ahora WHERE id = :id AND estado = 'PROGRAMADO'`,
        { replacements: { id: cand.id, ahora } }) as any;
      if (!upd?.affectedRows) return res.json({ ok: true, trabajo: null });
      const [p] = await q<any>(`SELECT id, aviso_ids, telefonos, modo, mensaje FROM gp_avisos_programados WHERE id = :id`, { id: cand.id });
      const ids = parseIds(p.aviso_ids);
      const rows = ids.length ? await q<any>(
        `SELECT a.id, a.dni, a.agente, a.estado, p.apellido, p.nombre, p.telefono
           FROM gp_avisos_whatsapp a LEFT JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
          WHERE a.id IN (:ids) AND a.estado IN ('PENDIENTE','ESCRITO')`, { ids }) : [];
      let tels: Record<string, string> = {};
      try { tels = JSON.parse(p.telefonos || '{}') || {}; } catch { tels = {}; }
      res.json({ ok: true, trabajo: {
        id: p.id, modo: p.modo, mensaje: p.mensaje,
        avisos: rows.map(x => { const { telefono, ...resto } = x; return { ...resto, ...celularDe(telefono), telefono_elegido: tels[x.id] || null }; }),
      } });
    } catch (e) { fallo(res, e, 'tomar'); }
  });

  // La PC termina: { ok, mal, resultado }
  r.post('/programados/:id/fin', async (req: Request, res: Response) => {
    try {
      await ensureTablas(sequelize);
      const ok = Number(req.body?.ok) || 0, mal = Number(req.body?.mal) || 0;
      const txt = String(req.body?.resultado || `${ok} bien, ${mal} con error`).slice(0, 300);
      await sequelize.query(
        `UPDATE gp_avisos_programados SET estado = :e, terminado_at = :at, resultado = :r WHERE id = :id AND estado = 'EN_CURSO'`,
        { replacements: { id: Number(req.params.id), e: ok === 0 && mal > 0 ? 'ERROR' : 'HECHO', at: ahoraLocal(), r: txt } });
      res.json({ ok: true });
    } catch (e) { fallo(res, e, 'fin'); }
  });

  return r;
}

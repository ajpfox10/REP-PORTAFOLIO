// src/routes/comparacionV2.routes.ts
// Comparador SIAPE vs Ministerio 2.0: la pantalla lee las TABLAS (no recalcula contra los Excel)
// y los botones lanzan los robots 2.0 por run_robot.py (quedan en la página Robots y respetan turnos).
//
// GET  /comparacion-v2/ultima              → última corrida (comparacion_corridas) + sus filas
//                                            (comparacion_novedades) con la forma del comparador viejo,
//                                            + estado de carga de cada fila (novedades_carga_intranet).
// POST /comparacion-v2/comparar            → corre el Comparador 2.0 (espera a que termine).
// GET  /comparacion-v2/resultado?dep=[&todas=1] → resultado de la carga en la Intranet (novedades_carga_intranet),
//                                            novedades + ausentes de esa dependencia; por defecto lo abierto
//                                            (todo lo que no es OK/DESCARTADA) + los OK que cargó el robot en las últimas 24 h;
//                                            todas=1 = historial completo.
// POST /comparacion-v2/lanzar              → { tipo: novedades|ausentes|art26, dependencia } corre ese robot.
// POST /comparacion-v2/reintentar          → { dependencia, ids } vuelve a PENDIENTE esas filas con error
//                                            y lanza los robots que correspondan (reemplaza "segunda pasada").
//
// Reemplaza a GET /comparacion-siape y a /intranet/{resultado,cargar-novedades,cargar-ausentes,
// segunda-pasada,exportar-pendientes} (versión vieja, Excel), que quedan SIN USO.

import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { ejecutarAhora, resolverScriptsDir } from '../services/robotsTareasWindows';
import { logger } from '../logging/logger';
import { env } from '../config/env';
import { controlLicenciasMedicas } from '../services/licenciasMedicasControl';
import { novedadesConCodigoCarga, normNovedadCarga } from '../services/mapeoNovedades';

const PERM = 'crud:*:*';
const DEPENDENCIAS = ['HOSPITAL', 'UPA 4', 'UPA 18'] as const;
const SUFIJO: Record<string, string> = { 'HOSPITAL': 'hospital', 'UPA 4': 'upa4', 'UPA 18': 'upa18' };
const AUSENTE = 'AUSENTE SIN AVISO';
const ROBOT_COMPARAR = 'comparacion_siape_ministerio_v2';

// Botón "Bajar archivos" de /app/asistencia: SOLO descargas (archivos del comparador + otras exportaciones SIAPE).
const ROBOTS_DESCARGA: { script: string; nombre: string }[] = [
  { script: 'siape_novedades_por_periodo',       nombre: 'SIAPE Novedades por período (SIAPE.xlsx)' },
  { script: 'intranet_descarga_novedades',       nombre: 'Ministerio Hospital (MINISTERIO.xls)' },
  { script: 'intranet_descarga_novedades_upa4',  nombre: 'Ministerio UPA 4 (UPA4.xls)' },
  { script: 'intranet_descarga_novedades_upa18', nombre: 'Ministerio UPA 18 (UPA18.xls)' },
  { script: 'siape_licencias_medicas',           nombre: 'SIAPE Licencias médicas' },
  { script: 'siape_horario_admin_dia',           nombre: 'SIAPE Horario administrativo del día' },
  { script: 'siape_examenes_medicos',            nombre: 'SIAPE Exámenes médicos' },
  { script: 'siape_tiempo_acumulado_tabla',      nombre: 'SIAPE Tiempo acumulado' },
];

// Las 4 descargas que usa el comparador: cuando terminan las 4 bien, "Bajar archivos" corre la comparación
// (pedido del usuario 05/11/2026: si no, las pantallas siguen mostrando la comparación con los archivos viejos;
// p.ej. un 28 eliminado en la Intranet seguía figurando como cargado). Si alguna falla NO compara (mismo freno que circuito_v2).
const DESCARGAS_COMPARADOR = ROBOTS_DESCARGA.slice(0, 4).map(r => r.script);
type EstadoComparacion = { estado: 'esperando' | 'corriendo' | 'ok' | 'error' | 'salteada'; motivo: string | null; hora: string | null };
const seguimientoBajada = new Map<string, EstadoComparacion>();   // desde → estado de la comparación automática
const horaAhora = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(11, 16);

function normalizarDependencia(raw: any): string | null {
  const d = String(raw ?? '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/^UPA(\d)/, 'UPA $1');
  return (DEPENDENCIAS as readonly string[]).includes(d) ? d : null;
}

function robotDe(tipo: string, dep: string): string | null {
  if (!['novedades', 'ausentes', 'art26'].includes(tipo)) return null;
  return `intranet_carga_${tipo}_v2_${SUFIJO[dep]}`;
}

function correrComparacion(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('python', ['run_robot.py', ROBOT_COMPARAR],
      { cwd: resolverScriptsDir(), timeout: 10 * 60 * 1000, windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
      (err, _out, stderr) => err ? reject(new Error(String(stderr || err.message).slice(-500))) : resolve());
  });
}

export function buildComparacionV2Router(sequelize: Sequelize) {
  // Espera a que terminen las 4 descargas del comparador (lanzadas en `desde`) y corre la comparación.
  // Revisa script_runs cada 30 s, hasta 3 h. Corre en la API: no depende de que la página siga abierta.
  function vigilarYComparar(desde: string, noArrancaron: string[]) {
    for (const k of seguimientoBajada.keys()) if (k !== desde) seguimientoBajada.delete(k);   // solo la última
    const set = (e: EstadoComparacion) => seguimientoBajada.set(desde, e);
    if (noArrancaron.length) {
      set({ estado: 'salteada', motivo: `No arrancó: ${noArrancaron.join(', ')}`, hora: horaAhora() });
      return;
    }
    set({ estado: 'esperando', motivo: null, hora: null });
    const tope = Date.now() + 3 * 3600_000;
    const t = setInterval(async () => {
      try {
        if (Date.now() > tope) {
          clearInterval(t);
          set({ estado: 'salteada', motivo: 'Las descargas no terminaron en 3 horas', hora: horaAhora() });
          return;
        }
        const filas = await sequelize.query<any>(`
          SELECT r.script, r.estado FROM script_runs r
            JOIN (SELECT script, MAX(id) AS id FROM script_runs
                   WHERE script IN (:scripts) AND actualizado_at >= :desde GROUP BY script) u ON u.id = r.id`,
          { type: QueryTypes.SELECT, replacements: { scripts: DESCARGAS_COMPARADOR, desde } });
        if (filas.length < DESCARGAS_COMPARADOR.length) return;   // falta alguna
        clearInterval(t);
        const mal = filas.filter(f => f.estado !== 'ok').map(f => f.script);
        if (mal.length) {
          set({ estado: 'salteada', motivo: `No se comparó: falló ${mal.join(', ')}`, hora: horaAhora() });
          return;
        }
        set({ estado: 'corriendo', motivo: null, hora: horaAhora() });
        try {
          await correrComparacion();
          set({ estado: 'ok', motivo: null, hora: horaAhora() });
        } catch (e: any) {
          logger.error({ msg: 'comparacion-v2/bajar-archivos: comparación automática', err: e });
          set({ estado: 'error', motivo: String(e?.message ?? e).slice(0, 300), hora: horaAhora() });
        }
      } catch (e: any) {
        logger.warn({ msg: 'comparacion-v2/bajar-archivos: vigilante', err: e });
      }
    }, 30_000);
  }

  const router = Router();

  router.get('/ultima', requirePermission(PERM), async (_req: Request, res: Response) => {
    try {
      const [corrida] = await sequelize.query<any>(
        `SELECT * FROM comparacion_corridas ORDER BY id DESC LIMIT 1`, { type: QueryTypes.SELECT });
      if (!corrida) return res.json({ ok: true, corrida: null, resultado: [] });
      // la tabla de carga puede no existir todavía (nunca corrió un robot de carga 2.0)
      const [tablaCarga] = await sequelize.query<any>(
        `SELECT COUNT(*) AS n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'novedades_carga_intranet'`,
        { type: QueryTypes.SELECT });
      const conCarga = Number(tablaCarga?.n) > 0;
      const filas = await sequelize.query<any>(`
        SELECT c.estado, c.motivo, c.dependencia, c.ley, c.legajo, c.dni, c.nombre,
               c.novedad_ministerio,
               COALESCE(DATE_FORMAT(c.desde_ministerio, '%Y-%m-%d'), '') AS fecha_desde_min,
               COALESCE(DATE_FORMAT(c.hasta_ministerio, '%Y-%m-%d'), '') AS fecha_hasta_min,
               c.novedad_siap,
               COALESCE(DATE_FORMAT(c.desde_siap, '%Y-%m-%d'), '') AS fecha_desde_siap,
               COALESCE(DATE_FORMAT(c.hasta_siap, '%Y-%m-%d'), '') AS fecha_hasta_siap,
               c.justificado_siap,
               ${conCarga ? 'n.estado' : 'NULL'} AS carga_estado,
               ${conCarga ? 'n.detalle' : 'NULL'} AS carga_detalle
          FROM comparacion_novedades c
          ${conCarga ? `LEFT JOIN novedades_carga_intranet n
                 ON c.estado = 'SOLO_SIAP' AND n.dni = c.dni AND n.novedad_siap = c.novedad_siap
                AND n.desde = c.desde_siap AND n.hasta = COALESCE(c.hasta_siap, c.desde_siap)` : ''}
         WHERE c.corrida_id = ?
         ORDER BY c.dependencia, c.nombre, c.desde_siap, c.desde_ministerio`,
        { type: QueryTypes.SELECT, replacements: [corrida.id] });
      return res.json({
        ok: true,
        corrida: {
          id: corrida.id,
          creado_en: corrida.creado_en,
          archivo_ministerio: corrida.archivo_ministerio,
          archivo_siape: corrida.archivo_siape,
          ministerio_modificado: corrida.ministerio_modificado,
          siape_modificado: corrida.siape_modificado,
        },
        resultado: filas,
      });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/ultima', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/comparar', requirePermission(PERM), async (_req: Request, res: Response) => {
    try {
      await correrComparacion();
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/comparar', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.get('/resultado', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const dep = normalizarDependencia(req.query.dep ?? 'HOSPITAL');
      if (!dep) return res.status(400).json({ ok: false, error: 'Dependencia inválida' });
      const todas = String(req.query.todas ?? '') === '1';
      const [ultima] = await sequelize.query<any>(
        `SELECT MAX(id) AS id FROM comparacion_corridas`, { type: QueryTypes.SELECT });
      const filas = await sequelize.query<any>(`
        SELECT id, nombre, dni, novedad_siap AS novedad, COALESCE(label_intranet, '') AS label,
               DATE_FORMAT(desde, '%Y-%m-%d') AS desde, DATE_FORMAT(hasta, '%Y-%m-%d') AS hasta,
               estado, COALESCE(detalle, '') AS detalle, intentos, corrida_id,
               DATE_FORMAT(actualizado_en, '%Y-%m-%d %H:%i') AS actualizado,
               DATE_FORMAT(cargado_en, '%Y-%m-%d %H:%i') AS cargado
          FROM novedades_carga_intranet
         WHERE dependencia = ?
           ${todas ? '' : `AND (estado NOT IN ('OK', 'DESCARTADA')
                OR (estado = 'OK' AND cargado_en >= NOW() - INTERVAL 24 HOUR))`}
         ORDER BY (estado = 'OK'), nombre, desde`,
        { type: QueryTypes.SELECT, replacements: [dep] });
      return res.json({ ok: true, corrida_actual: ultima?.id ?? null, filas });
    } catch (err: any) {
      if (/doesn't exist/i.test(String(err?.message))) return res.json({ ok: true, corrida_actual: null, filas: [] });
      logger.error({ msg: 'comparacion-v2/resultado', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/lanzar', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const dep = normalizarDependencia(req.body?.dependencia);
      const script = dep ? robotDe(String(req.body?.tipo ?? ''), dep) : null;
      if (!script) return res.status(400).json({ ok: false, error: 'Tipo o dependencia inválidos' });
      const como = await ejecutarAhora(script);
      return res.json({ ok: true, script, como, msg: `Robot ${script} lanzado (queda en la página Robots)` });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/lanzar', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // ── Bajar archivos (05/11/2026): lanza SOLO los robots de descarga, ninguno carga nada ──
  // Cada uno espera su turno (robots_siape / robots_intranet) en run_robot.py, así que no se pisan.
  router.post('/bajar-archivos', requirePermission(PERM), async (_req: Request, res: Response) => {
    try {
      const [{ ahora }] = await sequelize.query<any>(
        `SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora`, { type: QueryTypes.SELECT });
      const lanzados: string[] = [];
      const fallidos: { script: string; error: string }[] = [];
      for (const r of ROBOTS_DESCARGA) {
        try { await ejecutarAhora(r.script); lanzados.push(r.script); }
        catch (e: any) { fallidos.push({ script: r.script, error: String(e?.message ?? e).slice(0, 200) }); }
      }
      vigilarYComparar(ahora, fallidos.map(f => f.script).filter(s => DESCARGAS_COMPARADOR.includes(s)));
      return res.json({
        ok: true, desde: ahora, lanzados, fallidos,
        msg: `${lanzados.length} descarga(s) lanzada(s)` + (fallidos.length ? ` · ${fallidos.length} no arrancaron` : ''),
      });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/bajar-archivos', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // ?desde=YYYY-MM-DD HH:MM:SS → última corrida de cada descarga posterior a ese momento (null = todavía no terminó)
  router.get('/bajar-archivos/estado', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const desde = String(req.query.desde ?? '');
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(desde)) return res.status(400).json({ ok: false, error: 'desde inválido' });
      const filas = await sequelize.query<any>(`
        SELECT r.script, r.estado, r.motivo, DATE_FORMAT(CONVERT_TZ(r.actualizado_at, '+00:00', '-03:00'), '%H:%i') AS hora
          FROM script_runs r
          JOIN (SELECT script, MAX(id) AS id FROM script_runs
                 WHERE script IN (:scripts) AND actualizado_at >= :desde GROUP BY script) u ON u.id = r.id`,
        { type: QueryTypes.SELECT, replacements: { scripts: ROBOTS_DESCARGA.map(r => r.script), desde } });
      const por = new Map(filas.map(f => [f.script, f]));
      const robots = ROBOTS_DESCARGA.map(r => ({ ...r, corrida: por.get(r.script) ?? null }));
      // comparación automática: lo que sabe el vigilante; si se reinició la API, la corrida del comparador posterior
      let comparacion: EstadoComparacion | null = seguimientoBajada.get(desde) ?? null;
      if (!comparacion) {
        const [c] = await sequelize.query<any>(`
          SELECT estado, motivo, DATE_FORMAT(CONVERT_TZ(actualizado_at, '+00:00', '-03:00'), '%H:%i') AS hora FROM script_runs
           WHERE script = :s AND actualizado_at >= :desde ORDER BY id DESC LIMIT 1`,
          { type: QueryTypes.SELECT, replacements: { s: ROBOT_COMPARAR, desde } });
        comparacion = c ? { estado: c.estado === 'ok' ? 'ok' : 'error', motivo: c.motivo, hora: c.hora }
          : { estado: 'esperando', motivo: null, hora: null };
      }
      const descargasListas = robots.every(r => r.corrida);
      const compFinal = ['ok', 'error', 'salteada'].includes(comparacion.estado);
      // si la API se reinició a mitad, el vigilante no existe: con las descargas listas se da por terminado igual
      const huerfana = descargasListas && !seguimientoBajada.has(desde) && comparacion.estado === 'esperando';
      if (huerfana) comparacion = { estado: 'salteada', motivo: 'La API se reinició durante la descarga: compará a mano', hora: null };
      return res.json({ ok: true, robots, comparacion, terminado: descargasListas && (compFinal || huerfana) });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/bajar-archivos/estado', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/reintentar', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const dep = normalizarDependencia(req.body?.dependencia);
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0);
      if (!dep || !ids.length) return res.status(400).json({ ok: false, error: 'Dependencia o filas inválidas' });

      const filas = await sequelize.query<any>(`
        SELECT id, novedad_siap, corrida_id FROM novedades_carga_intranet
         WHERE id IN (:ids) AND dependencia = :dep
           AND estado NOT IN ('OK', 'DESCARTADA', 'PERIODO_CERRADO', 'CAMBIO_SIAPE', 'ELIMINADA')`,
        { type: QueryTypes.SELECT, replacements: { ids, dep } });
      if (!filas.length) return res.json({ ok: true, msg: 'No hay filas con error para reintentar' });
      await sequelize.query(
        // deps_descartadas vacía: si era NO_EN_PLANTEL se vuelve a probar en las tres dependencias
        `UPDATE novedades_carga_intranet SET estado = 'PENDIENTE', deps_descartadas = '' WHERE id IN (:ids)`,
        { replacements: { ids: filas.map(f => f.id) } });

      const [ultima] = await sequelize.query<any>(
        `SELECT MAX(id) AS id FROM comparacion_corridas`, { type: QueryTypes.SELECT });
      const fueraDeCorrida = filas.filter(f => f.corrida_id !== ultima?.id).length;
      const tipos = new Set<string>(filas.map(f => (f.novedad_siap === AUSENTE ? 'ausentes' : 'novedades')));
      const lanzados: string[] = [];
      for (const tipo of ['novedades', 'ausentes']) {
        if (!tipos.has(tipo)) continue;
        const script = robotDe(tipo, dep)!;
        await ejecutarAhora(script);
        lanzados.push(script);
      }
      return res.json({
        ok: true, filas: filas.length, lanzados, fuera_de_corrida: fueraDeCorrida,
        msg: `${filas.length} fila(s) vuelven a PENDIENTE · lanzado: ${lanzados.join(', ')}`
          + (fueraDeCorrida ? ` · ${fueraDeCorrida} no están en la última comparación (no se reintentan hasta que vuelvan a salir)` : ''),
      });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/reintentar', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // ── Cargar desde /app/asistencia (05/11/2026) ───────────────────────────────────────────────
  // POST /comparacion-v2/cargar-filas { filas: [{dni, nombre, novedad_siap, desde, hasta, dependencia, justificado}], forzar }
  // Pone cada fila en la cola de la última comparación y lanza el robot de su dependencia:
  //  - no está en la cola → la agrega PENDIENTE;  - OK → no se toca;
  //  - PENDIENTE/ERROR/ERROR_NAV/NO_EN_PLANTEL/NO_TRABAJA_DIA → PENDIENTE;
  //  - DESCARTADA/PERIODO_CERRADO/CAMBIO_SIAPE/ELIMINADA/NO_ES_AUSENTE → solo con forzar=true, queda FORZADA:
  //    el robot la toma (no está en ESTADOS_NO_CARGAR) y las reglas de descarte no la tocan (solo miran
  //    PENDIENTE/ERROR/ERROR_NAV). Sin forzar se devuelven en `requieren_confirmacion` con su motivo.
  router.post('/cargar-filas', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const entrada = Array.isArray(req.body?.filas) ? req.body.filas : [];
      const forzar = req.body?.forzar === true;
      const lanzarAhora = req.body?.lanzar !== false;   // el front manda lanzar=false y lanza una sola vez al final
      const iso = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
      const filas = entrada.map((f: any) => ({
        dni: String(f?.dni ?? '').replace(/\D/g, ''),
        nombre: String(f?.nombre ?? '').slice(0, 160),
        novedad: String(f?.novedad_siap ?? '').trim().slice(0, 160),
        desde: iso(f?.desde), hasta: iso(f?.hasta) ?? iso(f?.desde),
        dep: normalizarDependencia(f?.dependencia),
        just: String(f?.justificado ?? '').slice(0, 10),
      })).filter((f: any) => f.dni && f.novedad && f.novedad !== '—' && f.desde && f.hasta && f.dep);
      if (!filas.length) return res.status(400).json({ ok: false, error: 'No hay filas válidas (DNI, novedad SIAPE, fechas y dependencia)' });
      if (filas.length > 2000) return res.status(400).json({ ok: false, error: 'Demasiadas filas (máx. 2000)' });

      const [ultima] = await sequelize.query<any>(`SELECT MAX(id) AS id FROM comparacion_corridas`, { type: QueryTypes.SELECT });
      const corrida = ultima?.id ?? null;
      const REQ_CONF = ['DESCARTADA', 'PERIODO_CERRADO', 'CAMBIO_SIAPE', 'ELIMINADA', 'NO_ES_AUSENTE'];

      const resumen = { agregadas: 0, a_pendiente: 0, forzadas: 0, ya_ok: 0, sin_codigo: 0 };
      const requieren: any[] = [];
      const sinCodigo: string[] = [];
      const conCodigo = await novedadesConCodigoCarga(sequelize);
      const lanzar = new Set<string>();
      // ids elegidos por tipo|dependencia: el robot carga SOLO esos (scripts/pedidos_carga.py)
      const pedidos = new Map<string, number[]>();
      const anotar = (tipo: string, dep: string, id: number) => {
        const k = `${tipo}|${dep}`;
        (pedidos.get(k) || pedidos.set(k, []).get(k)!).push(id);
        lanzar.add(robotDe(tipo, dep)!);
      };
      for (const f of filas) {
        const [q] = await sequelize.query<any>(
          `SELECT id, estado, detalle FROM novedades_carga_intranet
            WHERE dni = :dni AND novedad_siap = :nov AND desde = :desde AND hasta = :hasta`,
          { type: QueryTypes.SELECT, replacements: { dni: f.dni, nov: f.novedad, desde: f.desde, hasta: f.hasta } });
        const tipo = f.novedad === AUSENTE ? 'ausentes' : 'novedades';
        // 06/11/2026: sin código de carga en el mapeo el robot no la puede cargar → no se toca la cola
        if (!conCodigo.has(normNovedadCarga(f.novedad))) {
          resumen.sin_codigo++;
          if (!sinCodigo.includes(f.novedad)) sinCodigo.push(f.novedad);
          continue;
        }
        if (!q) {
          await sequelize.query(
            `INSERT INTO novedades_carga_intranet
               (dependencia, dni, nombre, novedad_siap, desde, hasta, justificado, motivo_comparacion, corrida_id, estado)
             VALUES (:dep, :dni, :nombre, :nov, :desde, :hasta, :just, 'CARGA_MANUAL_ASISTENCIA', :corrida, 'PENDIENTE')`,
            { replacements: { dep: f.dep, dni: f.dni, nombre: f.nombre, nov: f.novedad, desde: f.desde, hasta: f.hasta, just: f.just, corrida } });
          const [nuevo] = await sequelize.query<any>(
            `SELECT id FROM novedades_carga_intranet WHERE dni = :dni AND novedad_siap = :nov AND desde = :desde AND hasta = :hasta`,
            { type: QueryTypes.SELECT, replacements: { dni: f.dni, nov: f.novedad, desde: f.desde, hasta: f.hasta } });
          resumen.agregadas++;
          if (nuevo) anotar(tipo, f.dep, Number(nuevo.id));
          continue;
        }
        if (q.estado === 'OK') { resumen.ya_ok++; continue; }
        const necesitaConf = REQ_CONF.includes(q.estado);
        if (necesitaConf && !forzar) {
          requieren.push({ dni: f.dni, nombre: f.nombre, novedad_siap: f.novedad, desde: f.desde, hasta: f.hasta, estado: q.estado, detalle: q.detalle });
          continue;
        }
        await sequelize.query(
          `UPDATE novedades_carga_intranet
              SET estado = :estado, deps_descartadas = '', corrida_id = :corrida, dependencia = :dep,
                  detalle = CONCAT('Carga pedida desde Asistencia ', DATE_FORMAT(NOW(), '%d/%m/%Y %H:%i'),
                                   IF(detalle IS NULL OR detalle = '', '', CONCAT('. Antes: ', LEFT(detalle, 300))))
            WHERE id = :id`,
          { replacements: { estado: necesitaConf ? 'FORZADA' : 'PENDIENTE', corrida, dep: f.dep, id: q.id } });
        if (necesitaConf) resumen.forzadas++; else resumen.a_pendiente++;
        anotar(tipo, f.dep, Number(q.id));
      }

      if (pedidos.size) {
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS carga_intranet_pedidos (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tipo VARCHAR(20) NOT NULL, dependencia VARCHAR(20) NOT NULL,
            ids MEDIUMTEXT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, usado_en DATETIME NULL,
            PRIMARY KEY (id), KEY idx_pedidos_pend (tipo, dependencia, usado_en)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        for (const [k, ids] of pedidos) {
          const [tipo, dep] = k.split('|');
          await sequelize.query(
            `INSERT INTO carga_intranet_pedidos (tipo, dependencia, ids) VALUES (:tipo, :dep, :ids)`,
            { replacements: { tipo, dep, ids: ids.join(',') } });
        }
      }
      const aLanzar = Array.from(pedidos.keys()).map(k => { const [tipo, dependencia] = k.split('|'); return { tipo, dependencia }; });

      const lanzados: string[] = [];
      const fallidos: string[] = [];
      for (const script of (lanzarAhora ? lanzar : [])) {
        try { await ejecutarAhora(script); lanzados.push(script); }
        catch (e: any) { fallidos.push(`${script}: ${String(e?.message ?? e).slice(0, 150)}`); }
      }
      const partes = [
        resumen.agregadas && `${resumen.agregadas} agregada(s) a la cola`,
        resumen.a_pendiente && `${resumen.a_pendiente} vuelta(s) a PENDIENTE`,
        resumen.forzadas && `${resumen.forzadas} forzada(s)`,
        resumen.ya_ok && `${resumen.ya_ok} ya estaban OK`,
        requieren.length && `${requieren.length} necesitan confirmación`,
        resumen.sin_codigo && `${resumen.sin_codigo} sin código para cargar en el Ministerio (falta en el mapeo: ${sinCodigo.join(', ')})`,
      ].filter(Boolean);
      return res.json({
        ok: true, ...resumen, requieren_confirmacion: requieren, lanzados, fallidos, a_lanzar: aLanzar,
        msg: (partes.join(' · ') || 'Nada para cargar')
          + (lanzados.length ? ` · robot lanzado: ${lanzados.join(', ')}` : '')
          + (fallidos.length ? ` · NO arrancó: ${fallidos.join(' | ')}` : ''),
      });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/cargar-filas', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // Licencias médicas del SIAPE vs cómo se cargaron en el Ministerio (solo lectura).
  // ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (por defecto, el año en curso)
  // ── Control de cruces SIAPE vs Ministerio vs fichadas (04/11/2026) ─────────────────────────────
  // Lo calcula scripts/control_cruces.py (robot control_cruces) en la tabla control_cruces.
  router.get('/cruces', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes ?? '')) ? String(req.query.mes) : null;
      const meses = await sequelize.query<any>(
        `SELECT mes, MAX(calculado_en) AS calculado_en, COUNT(*) AS filas FROM control_cruces GROUP BY mes ORDER BY mes DESC`,
        { type: QueryTypes.SELECT }).catch(() => [] as any[]);
      // por defecto el mes anterior (el que se esta cerrando); si no esta calculado, el mas nuevo
      const hoy = new Date(); const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const mesAnt = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}`;
      const elegido = mes || (meses.some((m: any) => m.mes === mesAnt) ? mesAnt : meses[0]?.mes) || null;
      const filas = elegido ? await sequelize.query<any>(
        `SELECT categoria, dependencia, dni, nombre, ley, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, turno, entrada,
                tarde_min, siape, ministerio, detalle
           FROM control_cruces WHERE mes = :mes ORDER BY categoria, dependencia, nombre, fecha`,
        { type: QueryTypes.SELECT, replacements: { mes: elegido } }) : [];
      const corrida = await sequelize.query<any>(
        `SELECT estado, motivo, DATE_FORMAT(actualizado_at, '%d/%m/%Y %H:%i') AS cuando FROM script_runs
          WHERE script = 'control_cruces' ORDER BY id DESC LIMIT 1`, { type: QueryTypes.SELECT }).catch(() => [] as any[]);
      return res.json({ ok: true, mes: elegido, meses, filas, ultimaCorrida: corrida[0] || null });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/cruces', err: err?.message });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // ── Licencias por agente (04/11/2026): SIAPE (tabla historial, sin PRESENTE; si un rango se importó
  // varias veces queda la versión más nueva), Ministerio (ministerio_novedades_anual) y Salud Laboral
  // (reconocimientos_medicos), agrupado por agente y paginado. Filtros: desde/hasta, q, dep, fuentes.
  router.get('/licencias-agentes', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const iso = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
      const hoy = new Date();
      const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const desde = iso(req.query.desde) || f(ini);
      const hasta = iso(req.query.hasta) || f(fin);
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
      const q = String(req.query.q ?? '').trim().toUpperCase();
      const dep = String(req.query.dep ?? '').trim().toUpperCase();
      const fuentes = new Set(String(req.query.fuentes || 'SIAPE,MINISTERIO,SALUD').toUpperCase().split(','));
      const excluirParciales = String(req.query.parciales ?? '') !== '1';
      const rep = { desde, hasta };

      type Lic = { fuente: string; novedad: string; desde: string; hasta: string; detalle: string; dependencia: string };
      const porDni = new Map<number, Lic[]>();
      const push = (dni: any, l: Lic) => {
        const n = Number(dni); if (!Number.isFinite(n) || n <= 0) return;
        if (!porDni.has(n)) porDni.set(n, []);
        porDni.get(n)!.push(l);
      };
      const PARCIAL = /^(PRESENTE|BOLETA|LLEGO|LLEGÓ|LACTANCIA)/i;

      if (fuentes.has('SIAPE')) {
        const rows = await sequelize.query<any>(`
          SELECT dni, novedad, DATE_FORMAT(fecha_desde, '%Y-%m-%d') d, DATE_FORMAT(COALESCE(fecha_hasta, fecha_desde), '%Y-%m-%d') h,
                 justificado, dependencia
            FROM (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.dni, h.novedad, h.fecha_desde ORDER BY h.created_at DESC, h.id DESC) rn
                    FROM historial h
                   WHERE h.fecha_desde <= :hasta AND COALESCE(h.fecha_hasta, h.fecha_desde) >= :desde
                     AND h.novedad <> 'PRESENTE') x
           WHERE rn = 1`, { type: QueryTypes.SELECT, replacements: rep });
        for (const r of rows) {
          if (excluirParciales && PARCIAL.test(String(r.novedad))) continue;
          push(r.dni, { fuente: 'SIAPE', novedad: r.novedad, desde: r.d, hasta: r.h,
                        detalle: r.justificado ? `Justificado: ${r.justificado}` : '', dependencia: r.dependencia || '' });
        }
      }
      if (fuentes.has('MINISTERIO')) {
        const rows = await sequelize.query<any>(`
          SELECT dni, novedad, DATE_FORMAT(fecha_desde, '%Y-%m-%d') d, DATE_FORMAT(fecha_hasta, '%Y-%m-%d') h, dependencia
            FROM ministerio_novedades_anual
           WHERE fecha_desde <= :hasta AND fecha_hasta >= :desde`, { type: QueryTypes.SELECT, replacements: rep });
        for (const r of rows) {
          if (excluirParciales && /^43-/.test(String(r.novedad))) continue;
          push(r.dni, { fuente: 'Ministerio', novedad: r.novedad, desde: r.d, hasta: r.h, detalle: '', dependencia: r.dependencia || '' });
        }
      }
      if (fuentes.has('SALUD')) {
        const rows = await sequelize.query<any>(`
          SELECT dni, COALESCE(NULLIF(tipo, ''), 'Reconocimiento médico') tipo, resultado,
                 DATE_FORMAT(fecha_desde, '%Y-%m-%d') d, DATE_FORMAT(fecha_hasta, '%Y-%m-%d') h
            FROM reconocimientos_medicos
           WHERE deleted_at IS NULL AND fecha_desde <= :hasta AND fecha_hasta >= :desde`,
          { type: QueryTypes.SELECT, replacements: rep });
        for (const r of rows) push(r.dni, { fuente: 'Salud Laboral', novedad: r.tipo, desde: r.d, hasta: r.h,
                                            detalle: r.resultado ? `Resultado: ${r.resultado}` : '', dependencia: '' });
      }

      const dnis = Array.from(porDni.keys());
      const info = new Map<number, { nombre: string; ley: string }>();
      if (dnis.length) {
        const rows = await sequelize.query<any>(`
          SELECT p.dni, TRIM(CONCAT(COALESCE(p.apellido, ''), ', ', COALESCE(p.nombre, ''))) nombre,
                 (SELECT l.nombre FROM agentes a LEFT JOIN ley l ON l.id = a.ley_id
                   WHERE a.dni = p.dni AND a.deleted_at IS NULL ORDER BY a.id DESC LIMIT 1) ley
            FROM personal p WHERE p.dni IN (:dnis)`, { type: QueryTypes.SELECT, replacements: { dnis } });
        for (const r of rows) info.set(Number(r.dni), { nombre: r.nombre, ley: r.ley || '' });
      }
      let agentes = dnis.map(dni => {
        const lics = porDni.get(dni)!.sort((a, b) => a.desde.localeCompare(b.desde) || a.fuente.localeCompare(b.fuente));
        const deps = Array.from(new Set(lics.map(l => l.dependencia).filter(Boolean)));
        return { dni, nombre: info.get(dni)?.nombre || '', ley: info.get(dni)?.ley || '', dependencias: deps, licencias: lics };
      });
      if (q) agentes = agentes.filter(a => `${a.nombre} ${a.dni}`.toUpperCase().includes(q)
        || a.licencias.some(l => l.novedad.toUpperCase().includes(q)));
      if (dep) agentes = agentes.filter(a => a.dependencias.some(d => d.toUpperCase() === dep));
      agentes.sort((a, b) => (a.nombre || 'ZZZ').localeCompare(b.nombre || 'ZZZ', 'es'));
      const total = agentes.length;
      const exportar = String(req.query.todo ?? '') === '1';
      return res.json({
        ok: true, desde, hasta, page, pageSize, total, paginas: Math.max(1, Math.ceil(total / pageSize)),
        agentes: exportar ? agentes : agentes.slice((page - 1) * pageSize, page * pageSize),
      });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/licencias-agentes', err: err?.message });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/cruces/recalcular', requirePermission(PERM), async (_req: Request, res: Response) => {
    try {
      const como = await ejecutarAhora('control_cruces');
      return res.json({ ok: true, como, msg: 'Control de cruces lanzado: tarda 1–2 minutos (queda en la página Robots)' });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/cruces/recalcular', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.get('/licencias-medicas', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const anio = new Date().getFullYear();
      const iso = (v: any, def: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : def);
      const desde = iso(req.query.desde, `${anio}-01-01`);
      const hasta = iso(req.query.hasta, `${anio}-12-31`);
      const dir = (env as any).EXCEL_ASISTENCIA_DIR;
      if (!dir) throw new Error('Falta EXCEL_ASISTENCIA_DIR en .env');
      const r = await controlLicenciasMedicas(sequelize, dir, desde, hasta);
      return res.json({ ok: true, ...r });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/licencias-medicas', err: err?.message });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  return router;
}

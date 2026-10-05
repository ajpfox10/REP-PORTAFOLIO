// src/routes/scriptRuns.routes.ts
// Robots de automatización (SIAPE, Intranet MS, etc.): catálogo, configuración
// y registro de corridas.
//
// GET  /script-runs/estado
//   → todos los robots de `robots_config` (migración 056) con su configuración
//     y la última corrida de `script_runs` (o "sin datos aún").
// GET  /script-runs/historial?script=&estado=&desde=&hasta=&limit=
//   → corridas (más nuevas primero). Sin `script` = todos los robots.
// PUT  /script-runs/config/:script
//   → guarda SOLO la programación (prog_activa, prog_dias, prog_cada_n_dias,
//     prog_hora) y crea/actualiza/borra SU tarea de Windows (\Robots\<script>).
//     Carpeta y nombre del archivo quedan fijos hasta probar (destino_editable = 0);
//     el comando nunca se edita desde acá.
// GET  /script-runs/items?run_id= | script=&estado=&desde=&hasta=&limit=
//   → detalle por agente/novedad (script_run_items): qué cargó y qué falló, con motivo.
// GET  /script-runs/fallidos              → robots cuya ÚLTIMA corrida fue error (banner global)
// POST /script-runs/ejecutar/:script      → corre ya (su tarea o run_robot.py directo)
// POST /script-runs/deshabilitar-vieja/:script → deshabilita la tarea de Windows vieja
//     (tarea_windows) para pasar el robot a su tarea propia sin que corra dos veces.

import { Router, Request, Response } from 'express';
import { requirePermission } from '../middlewares/rbacCrud';
import { Sequelize, QueryTypes } from 'sequelize';
import { execFile } from 'child_process';
import {
  crearOActualizarTarea, borrarTarea, ejecutarAhora, estadoTareas, EstadoTarea,
} from '../services/robotsTareasWindows';

const DIAS_VALIDOS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO'];

export function buildScriptRunsRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/estado', requirePermission('crud:*:*'), async (_req: Request, res: Response) => {
    try {
      const robots = await sequelize.query<any>(
        `SELECT script, descripcion, grupo, orden, comando, reporta_solo,
                prog_activa, prog_dias, prog_cada_n_dias, TIME_FORMAT(prog_hora, '%H:%i') AS prog_hora,
                tarea_windows, destino_dir, destino_nombre, destino_editable, lo_leen, notas
           FROM robots_config
          WHERE activo = 1
          ORDER BY orden, script`,
        { type: QueryTypes.SELECT },
      );

      let ultimas: Record<string, any> = {};
      let totales: Record<string, any> = {};
      try {
        const rows = await sequelize.query<any>(
          `SELECT sr.id AS run_id, sr.script, sr.descripcion, sr.estado, sr.motivo, sr.filas, sr.archivo,
                  sr.duracion_seg, sr.actualizado_at,
                  (SELECT COUNT(*) FROM script_run_items i WHERE i.run_uid = sr.run_uid AND i.estado = 'error') AS items_error,
                  (SELECT COUNT(*) FROM script_run_items i WHERE i.run_uid = sr.run_uid) AS items
             FROM script_runs sr
             JOIN (SELECT script, MAX(id) AS max_id FROM script_runs GROUP BY script) last
               ON last.script = sr.script AND last.max_id = sr.id`,
          { type: QueryTypes.SELECT },
        );
        ultimas = Object.fromEntries(rows.map(r => [r.script, r]));
        const tot = await sequelize.query<any>(
          `SELECT script, COUNT(*) AS corridas, SUM(estado = 'error') AS errores
             FROM script_runs GROUP BY script`,
          { type: QueryTypes.SELECT },
        );
        totales = Object.fromEntries(tot.map(r => [r.script, r]));
      } catch {
        // script_runs puede no existir aún (ningún robot corrió todavía)
      }

      const conocidos = new Set(robots.map(r => r.script));
      // corridas de scripts que no están en el catálogo (por si acaso)
      const extras = Object.keys(ultimas).filter(s => !conocidos.has(s)).map(script => ({
        script, descripcion: ultimas[script]?.descripcion || script, grupo: 'Otros', orden: 999,
      }));

      let tareas: { robots: Record<string, EstadoTarea>; viejas: Record<string, EstadoTarea> } = { robots: {}, viejas: {} };
      try {
        tareas = await estadoTareas(robots.map(r => r.tarea_windows).filter(Boolean));
      } catch {
        // sin PowerShell / sin permisos: la página igual muestra lo de la base
      }

      const data = [...robots, ...extras].map(r => {
        const u = ultimas[r.script];
        return {
          ...r,
          tarea: tareas.robots[r.script] ?? { existe: false },
          tarea_vieja: r.tarea_windows ? (tareas.viejas[r.tarea_windows] ?? { existe: false }) : null,
          estado: u?.estado ?? null,
          motivo: u?.motivo ?? null,
          filas: u?.filas ?? null,
          archivo: u?.archivo ?? null,
          duracion_seg: u?.duracion_seg ?? null,
          actualizado_at: u?.actualizado_at ?? null,
          run_id: u?.run_id ?? null,
          items: Number(u?.items ?? 0),
          items_error: Number(u?.items_error ?? 0),
          corridas: Number(totales[r.script]?.corridas ?? 0),
          errores: Number(totales[r.script]?.errores ?? 0),
        };
      });
      return res.json({ ok: true, data });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.get('/historial', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      const where: string[] = [];
      const repl: any[] = [];
      const script = String(req.query.script || '').trim();
      const estado = String(req.query.estado || '').trim();
      const desde = String(req.query.desde || '').trim();
      const hasta = String(req.query.hasta || '').trim();
      if (script) { where.push('script = ?'); repl.push(script); }
      if (estado === 'ok' || estado === 'error') { where.push('estado = ?'); repl.push(estado); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) { where.push('actualizado_at >= ?'); repl.push(`${desde} 00:00:00`); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) { where.push('actualizado_at <= ?'); repl.push(`${hasta} 23:59:59`); }
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);

      let data: any[] = [];
      try {
        data = await sequelize.query<any>(
          `SELECT sr.id, sr.script, sr.descripcion, sr.estado, sr.motivo, sr.filas, sr.archivo,
                  sr.duracion_seg, sr.actualizado_at,
                  COALESCE(it.items, 0) AS items, COALESCE(it.items_error, 0) AS items_error,
                  COALESCE(it.items_aviso, 0) AS items_aviso
             FROM script_runs sr
             LEFT JOIN (SELECT run_uid, COUNT(*) AS items, SUM(estado = 'error') AS items_error,
                               SUM(estado = 'aviso') AS items_aviso
                          FROM script_run_items GROUP BY run_uid) it ON it.run_uid = sr.run_uid
            ${where.length ? 'WHERE ' + where.map(w => 'sr.' + w).join(' AND ') : ''}
            ORDER BY sr.id DESC
            LIMIT ${limit}`,
          { type: QueryTypes.SELECT, replacements: repl },
        );
      } catch {
        data = [];
      }
      return res.json({ ok: true, data });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.put('/config/:script', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      const script = String(req.params.script || '');
      const b = req.body || {};

      const activa = b.prog_activa ? 1 : 0;
      const dias = String(b.prog_dias || '')
        .split(',').map((d: string) => d.trim().toUpperCase()).filter(Boolean);
      if (dias.some((d: string) => !DIAS_VALIDOS.includes(d))) {
        return res.status(400).json({ ok: false, error: `Días inválidos. Usar ${DIAS_VALIDOS.join(',')}` });
      }
      const cadaN = b.prog_cada_n_dias === null || b.prog_cada_n_dias === '' || b.prog_cada_n_dias === undefined
        ? null : Number(b.prog_cada_n_dias);
      if (cadaN !== null && (!Number.isInteger(cadaN) || cadaN < 1 || cadaN > 365)) {
        return res.status(400).json({ ok: false, error: 'Cada N días: entre 1 y 365' });
      }
      if (dias.length && cadaN) {
        return res.status(400).json({ ok: false, error: 'Elegí días de la semana O cada N días, no los dos' });
      }
      const hora = b.prog_hora ? String(b.prog_hora).slice(0, 5) : null;
      if (hora !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
        return res.status(400).json({ ok: false, error: 'Hora inválida (HH:MM)' });
      }
      if (activa && !hora) {
        return res.status(400).json({ ok: false, error: 'Para activar la programación hace falta la hora' });
      }

      const [robot] = await sequelize.query<any>(
        `SELECT script, descripcion, comando, tarea_windows FROM robots_config WHERE script = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [script] },
      );
      if (!robot) return res.status(404).json({ ok: false, error: 'Robot inexistente' });
      if (activa && !robot.comando) {
        return res.status(400).json({ ok: false, error: 'Este robot no se puede programar (lo lanza otra pantalla)' });
      }
      if (activa && robot.tarea_windows) {
        const { viejas } = await estadoTareas([robot.tarea_windows]);
        const v = viejas[robot.tarea_windows];
        if (v?.existe && v.estado !== 'Disabled') {
          return res.status(409).json({
            ok: false,
            error: `Todavía lo corre la tarea de Windows "${robot.tarea_windows}". Deshabilitala primero (botón en esta misma pantalla) para que no corra dos veces.`,
          });
        }
      }

      await sequelize.query(
        `UPDATE robots_config
            SET prog_activa = ?, prog_dias = ?, prog_cada_n_dias = ?, prog_hora = ?
          WHERE script = ?`,
        { replacements: [activa, dias.join(','), cadaN, hora ? `${hora}:00` : null, script] },
      );

      // su tarea de Windows sigue a la programación
      try {
        if (activa) await crearOActualizarTarea(script, robot.descripcion, { dias, cadaN, hora: hora! });
        else await borrarTarea(script);
      } catch (e: any) {
        return res.status(500).json({ ok: false, error: `Se guardó la programación pero falló la tarea de Windows: ${e?.message || e}` });
      }
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.get('/items', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      const where: string[] = [];
      const repl: any[] = [];
      const runId = Number(req.query.run_id);
      if (runId) {
        where.push('i.run_uid = (SELECT run_uid FROM script_runs WHERE id = ?)');
        repl.push(runId);
      }
      const script = String(req.query.script || '').trim();
      const estado = String(req.query.estado || '').trim();
      const desde = String(req.query.desde || '').trim();
      const hasta = String(req.query.hasta || '').trim();
      const texto = String(req.query.q || '').trim();
      if (script) { where.push('i.script = ?'); repl.push(script); }
      if (['ok', 'error', 'aviso'].includes(estado)) { where.push('i.estado = ?'); repl.push(estado); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) { where.push('i.creado_at >= ?'); repl.push(`${desde} 00:00:00`); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) { where.push('i.creado_at <= ?'); repl.push(`${hasta} 23:59:59`); }
      if (texto) {
        where.push('(i.dni LIKE ? OR i.nombre LIKE ? OR i.detalle LIKE ?)');
        repl.push(`%${texto}%`, `%${texto}%`, `%${texto}%`);
      }
      if (!runId && !script && !estado) {
        return res.status(400).json({ ok: false, error: 'Indicá run_id, script o estado' });
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 5000);
      const data = await sequelize.query<any>(
        `SELECT i.id, i.script, i.dni, i.nombre, i.novedad, i.desde, i.hasta, i.estado, i.detalle, i.creado_at,
                rc.descripcion
           FROM script_run_items i
           LEFT JOIN robots_config rc ON rc.script = i.script
          WHERE ${where.join(' AND ')}
          ORDER BY i.id DESC
          LIMIT ${limit}`,
        { type: QueryTypes.SELECT, replacements: repl },
      );
      return res.json({ ok: true, data });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // Liviano (solo base, sin PowerShell): lo consulta el banner global cada pocos minutos.
  router.get('/fallidos', requirePermission('crud:*:*'), async (_req: Request, res: Response) => {
    try {
      const rows = await sequelize.query<any>(
        `SELECT sr.id AS run_id, sr.script, COALESCE(rc.descripcion, sr.descripcion, sr.script) AS descripcion,
                sr.motivo, sr.actualizado_at, (rc.comando IS NOT NULL AND rc.comando <> '') AS lanzable
           FROM script_runs sr
           JOIN (SELECT script, MAX(id) AS max_id FROM script_runs GROUP BY script) last
             ON last.script = sr.script AND last.max_id = sr.id
           JOIN robots_config rc ON rc.script = sr.script AND rc.activo = 1
          WHERE sr.estado = 'error'
          ORDER BY rc.orden, sr.script`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ ok: true, data: rows.map(r => ({ ...r, lanzable: !!Number(r.lanzable) })) });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.post('/ejecutar/:script', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      const [robot] = await sequelize.query<any>(
        `SELECT script, comando FROM robots_config WHERE script = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [String(req.params.script || '')] },
      );
      if (!robot) return res.status(404).json({ ok: false, error: 'Robot inexistente' });
      if (!robot.comando) return res.status(400).json({ ok: false, error: 'Este robot lo lanza otra pantalla' });
      const como = await ejecutarAhora(robot.script);
      return res.json({ ok: true, como });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.post('/deshabilitar-vieja/:script', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      const [robot] = await sequelize.query<any>(
        `SELECT tarea_windows FROM robots_config WHERE script = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [String(req.params.script || '')] },
      );
      const nombre = robot?.tarea_windows as string | undefined;
      if (!nombre || !/^[A-Za-z0-9_\- ]{1,120}$/.test(nombre)) {
        return res.status(404).json({ ok: false, error: 'Este robot no tiene tarea vieja' });
      }
      await new Promise<void>((resolve, reject) => execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Disable-ScheduledTask -TaskName '${nombre}' | Out-Null`],
        { timeout: 30000, windowsHide: true },
        (err, _o, stderr) => err ? reject(new Error(String(stderr || err.message))) : resolve()));
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  return router;
}

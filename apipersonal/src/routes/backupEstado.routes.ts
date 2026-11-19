// src/routes/backupEstado.routes.ts
// Estado del backup MySQL (C:\apps\backup_mysql, fuera de la app) para la pestaña
// 💾 Backup de Mi cuenta. SOLO LECTURA: no ejecuta el backup, no llama a rclone y
// no lee el .env del backup (la clave de cifrado nunca pasa por la app).
//
// GET /backup-estado
//   → tareas \Backup\* de Windows, últimas corridas por tipo (script_runs de la
//     base de producción, que es donde registra backup.mjs), historial con avisos,
//     diarios locales (manifiesto.json), binlogs y espacio libre del disco.

import { Router, Request, Response } from 'express';
import { requirePermission } from '../middlewares/rbacCrud';
import { Sequelize, QueryTypes } from 'sequelize';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { estadoTareasBackup } from '../services/robotsTareasWindows';

const SCRIPTS = ['backup_mysql_diario', 'backup_mysql_binlogs', 'backup_mysql_prueba'];

export function buildBackupEstadoRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/', requirePermission('crud:*:*'), async (_req: Request, res: Response) => {
    const dir = process.env.BACKUP_MYSQL_DIR?.trim() || 'D:\\backups_mysql';
    // backup.mjs registra en la base de prod; en dev se lee igual de ahí.
    const db = process.env.BACKUP_RUNS_DB?.trim() || 'personalv5';
    const avisos: string[] = [];

    let ultimas: any[] = [], historial: any[] = [], items: any[] = [];
    const leerCorridas = async (tabla: string) => {
      ultimas = await sequelize.query<any>(
        `SELECT sr.script, sr.estado, sr.motivo, sr.filas, sr.duracion_seg, sr.actualizado_at
           FROM ${tabla}script_runs sr
           JOIN (SELECT script, MAX(id) max_id FROM ${tabla}script_runs WHERE script IN (:s) GROUP BY script) u
             ON u.max_id = sr.id`,
        { type: QueryTypes.SELECT, replacements: { s: SCRIPTS } },
      );
      historial = await sequelize.query<any>(
        `SELECT id, run_uid, script, estado, motivo, filas, duracion_seg, actualizado_at
           FROM ${tabla}script_runs WHERE script IN (:s) ORDER BY id DESC LIMIT 30`,
        { type: QueryTypes.SELECT, replacements: { s: SCRIPTS } },
      );
      const uids = historial.map(h => h.run_uid).filter(Boolean);
      if (uids.length) {
        items = await sequelize.query<any>(
          `SELECT run_uid, nombre, estado, detalle FROM ${tabla}script_run_items WHERE run_uid IN (:u) AND estado <> 'ok'`,
          { type: QueryTypes.SELECT, replacements: { u: uids } },
        );
      }
    };
    try {
      await leerCorridas(/^[A-Za-z0-9_]+$/.test(db) ? `\`${db}\`.` : '');
    } catch {
      // dev: el usuario de la app no tiene permiso sobre la base de prod → se usan las corridas de la base propia
      try {
        await leerCorridas('');
        avisos.push(`Sin acceso a ${db}.script_runs (normal en dev): se muestran las corridas de la base local.`);
      } catch (e: any) { avisos.push('No se pudieron leer las corridas: ' + (e?.message || e)); }
    }

    const itemsPor: Record<string, any[]> = {};
    for (const it of items) (itemsPor[it.run_uid] ||= []).push({ nombre: it.nombre, estado: it.estado, detalle: it.detalle });

    // diarios locales
    const diarios: any[] = [];
    try {
      const dDiario = path.join(dir, 'diario');
      const nombres = fs.existsSync(dDiario) ? (await fsp.readdir(dDiario)).filter(n => /^\d{8}_\d{4}$/.test(n)).sort().reverse() : [];
      for (const n of nombres) {
        let bases = 0, bytes = 0, usuarios: number | null = null;
        try {
          const man = JSON.parse(await fsp.readFile(path.join(dDiario, n, 'manifiesto.json'), 'utf8'));
          const bs = Object.values<any>(man.bases || {});
          bases = bs.length; bytes = bs.reduce((a, b) => a + Number(b.bytes || 0), 0);
          usuarios = man.usuarios ?? null;
        } catch { /* sin manifiesto: copia incompleta */ }
        diarios.push({ nombre: n, bases, bytes, usuarios });
      }
    } catch (e: any) { avisos.push('No se pudo leer la carpeta de diarios: ' + (e?.message || e)); }

    // binlogs locales
    let binlogs = { cantidad: 0, bytes: 0, mas_viejo: null as string | null, mas_nuevo: null as string | null };
    try {
      const dBin = path.join(dir, 'binlogs');
      if (fs.existsSync(dBin)) {
        const fs2 = (await fsp.readdir(dBin)).filter(f => f.endsWith('.gz.enc'));
        let min = Infinity, max = 0;
        for (const f of fs2) {
          const st = await fsp.stat(path.join(dBin, f));
          binlogs.bytes += st.size; min = Math.min(min, st.mtimeMs); max = Math.max(max, st.mtimeMs);
        }
        binlogs.cantidad = fs2.length;
        if (fs2.length) { binlogs.mas_viejo = new Date(min).toISOString(); binlogs.mas_nuevo = new Date(max).toISOString(); }
      }
    } catch (e: any) { avisos.push('No se pudo leer la carpeta de binlogs: ' + (e?.message || e)); }

    // disco
    let disco: { libre: number; total: number } | null = null;
    try { const s = await fsp.statfs(dir); disco = { libre: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* sin disco */ }

    let tareas = {};
    try { tareas = await estadoTareasBackup(); } catch (e: any) { avisos.push('No se pudieron leer las tareas de Windows: ' + (e?.message || e)); }

    return res.json({
      ok: true,
      data: {
        dir,
        tareas,
        ultimas: Object.fromEntries(ultimas.map(u => [u.script, u])),
        historial: historial.map(h => ({ ...h, items: itemsPor[h.run_uid] || [] })),
        diarios,
        binlogs,
        disco,
        avisos,
      },
    });
  });

  return router;
}

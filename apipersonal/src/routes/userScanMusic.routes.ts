// src/routes/userScanMusic.routes.ts
// Preferencias de música de escaneo por usuario + listado/streaming de archivos.
//
// GET  /user-scan-music/tracks        — lista los MP3/OGG/WAV disponibles
// GET  /user-scan-music/tracks/:file  — sirve el archivo de audio
// GET  /user-scan-music/me            — preferencia guardada del usuario
// PUT  /user-scan-music/me            — guarda la preferencia del usuario

import path from 'path';
import fs   from 'fs';
import { Router, Request, Response } from 'express';
import { Sequelize } from 'sequelize';
import { z } from 'zod';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';

const ALLOWED_EXT = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.flac']);

function getMusicDir(): string {
  return process.env.SCAN_MUSIC_DIR || '';
}

function safeMusicPath(filename: string): string | null {
  const dir = getMusicDir();
  if (!dir) return null;
  const resolved = path.resolve(dir, filename);
  if (!resolved.startsWith(path.resolve(dir))) return null; // path traversal
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return resolved;
}

const saveSchema = z.object({
  melodia: z.string().max(255),
  volumen: z.number().min(0).max(1).default(0.1),
});

export function buildUserScanMusicRouter(sequelize: Sequelize) {
  const router = Router();

  // ── GET /user-scan-music/tracks — lista archivos disponibles ──────────────
  router.get(
    '/tracks',
    requirePermission('api:access'),
    (_req: Request, res: Response) => {
      const dir = getMusicDir();
      if (!dir || !fs.existsSync(dir)) {
        return res.json({ ok: true, data: [] });
      }
      try {
        const files = fs.readdirSync(dir)
          .filter(f => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
          .sort()
          .map(f => ({ filename: f, label: path.basename(f, path.extname(f)) }));
        return res.json({ ok: true, data: files });
      } catch (err: any) {
        logger.error({ msg: 'Error listando música', err });
        return res.status(500).json({ ok: false, error: 'Error al listar archivos' });
      }
    }
  );

  // ── GET /user-scan-music/tracks/:file — sirve el archivo de audio ─────────
  router.get(
    '/tracks/:file',
    requirePermission('api:access'),
    (req: Request, res: Response) => {
      const filename = req.params.file;
      const filepath = safeMusicPath(filename);
      if (!filepath || !fs.existsSync(filepath)) {
        return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
      }
      const ext = path.extname(filepath).toLowerCase();
      const mime: Record<string, string> = {
        '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',  '.m4a': 'audio/mp4', '.flac': 'audio/flac',
      };
      res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      fs.createReadStream(filepath).pipe(res);
    }
  );

  // ── GET /user-scan-music/me ───────────────────────────────────────────────
  router.get(
    '/me',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).auth?.principalId;
        if (!userId) return res.status(401).json({ ok: false, error: 'Sin sesión' });

        const [rows] = await sequelize.query(
          'SELECT melodia, volumen FROM user_scan_music WHERE usuario_id = :userId LIMIT 1',
          { replacements: { userId } }
        );
        const row = (rows as any[])[0];
        return res.json({
          ok: true,
          data: row
            ? { melodia: row.melodia, volumen: Number(row.volumen) }
            : { melodia: '', volumen: 0.1 },
        });
      } catch (err: any) {
        logger.error({ msg: 'Error obteniendo preferencia música', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener preferencia' });
      }
    }
  );

  // ── PUT /user-scan-music/me ───────────────────────────────────────────────
  router.put(
    '/me',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).auth?.principalId;
        if (!userId) return res.status(401).json({ ok: false, error: 'Sin sesión' });

        const parsed = saveSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.flatten() });
        }
        const { melodia, volumen } = parsed.data;

        await sequelize.query(
          `INSERT INTO user_scan_music (usuario_id, melodia, volumen)
           VALUES (:userId, :melodia, :volumen)
           ON DUPLICATE KEY UPDATE melodia = :melodia, volumen = :volumen`,
          { replacements: { userId, melodia, volumen } }
        );
        return res.json({ ok: true, data: { melodia, volumen } });
      } catch (err: any) {
        logger.error({ msg: 'Error guardando preferencia música', err });
        return res.status(500).json({ ok: false, error: 'Error al guardar preferencia' });
      }
    }
  );

  return router;
}

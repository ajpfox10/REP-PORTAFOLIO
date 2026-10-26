// Anuncio y autoactualización de los agentes SDK de relojes. Público (sin JWT) porque lo llama el agente,
// no un usuario: se valida con la clave compartida FICHERO_SDK_AGENTE_CLAVE (header X-Agente-Clave).
// El paquete del agente vive en assets/agente-sdk-relojes (lo copia deploy-prod.cmd a prod).
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { claveAgentes, registrarAgente } from '../services/sdkAgentes';

const PAQUETE_DIR = path.resolve(process.cwd(), 'assets', 'agente-sdk-relojes');
// Lo que el agente puede bajar. La config (con la clave) y el .bat que lo lanza no se actualizan solos.
const ACTUALIZABLES = /^(agente\.ps1|accion-sdk\.ps1|version\.json|README\.md|sdk\/[\w.-]+\.dll)$/i;

function texto(v: unknown, max = 100): string {
  return String(v ?? '').trim().slice(0, max);
}

function versionPaquete(): string {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(PAQUETE_DIR, 'version.json'), 'utf-8').replace(/^﻿/, '')).version || '');
  } catch {
    return '';
  }
}

function archivosPaquete(): Array<{ nombre: string; sha256: string; bytes: number }> {
  const out: Array<{ nombre: string; sha256: string; bytes: number }> = [];
  const recorrer = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) recorrer(path.join(dir, e.name), r);
      else if (ACTUALIZABLES.test(r)) {
        const buf = fs.readFileSync(path.join(dir, e.name));
        out.push({ nombre: r, sha256: crypto.createHash('sha256').update(buf).digest('hex').toUpperCase(), bytes: buf.length });
      }
    }
  };
  if (fs.existsSync(PAQUETE_DIR)) recorrer(PAQUETE_DIR, '');
  return out;
}

function exigirClave(req: Request, res: Response, next: NextFunction) {
  const clave = claveAgentes();
  if (!clave) return res.status(503).json({ ok: false, error: 'FICHERO_SDK_AGENTE_CLAVE no está configurada en el servidor' });
  if (req.get('X-Agente-Clave') !== clave) return res.status(401).json({ ok: false, error: 'clave incorrecta' });
  return next();
}

export function buildFicheroSdkAgenteRouter(): Router {
  const router = Router();
  router.use(exigirClave);

  router.post('/registro', (req: Request, res: Response) => {
    const id = texto(req.body?.id, 60);
    const ip = texto(req.body?.ip, 45);
    const puerto = Number(req.body?.puerto);
    if (!id || !/^[\d.]+$/.test(ip) || !Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
      return res.status(400).json({ ok: false, error: 'id, ip y puerto son requeridos' });
    }
    const agente = registrarAgente({
      id,
      ip,
      puerto,
      host: texto(req.body?.host, 60),
      sdkVersion: texto(req.body?.sdkVersion, 30),
      agenteVersion: texto(req.body?.agenteVersion, 20),
      firewall: texto(req.body?.firewall, 30),
      origen: String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''),
    });
    return res.json({ ok: true, id: agente.id, ultimaVersion: versionPaquete() });
  });

  router.get('/paquete', (_req: Request, res: Response) => {
    return res.json({ ok: true, version: versionPaquete(), archivos: archivosPaquete() });
  });

  router.get('/archivo', (req: Request, res: Response) => {
    const nombre = texto(req.query.nombre, 120).replace(/\\/g, '/');
    if (!ACTUALIZABLES.test(nombre) || nombre.includes('..')) return res.status(400).json({ ok: false, error: 'archivo no permitido' });
    const ruta = path.join(PAQUETE_DIR, ...nombre.split('/'));
    if (!fs.existsSync(ruta)) return res.status(404).json({ ok: false, error: 'no existe' });
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.send(fs.readFileSync(ruta));
  });

  return router;
}

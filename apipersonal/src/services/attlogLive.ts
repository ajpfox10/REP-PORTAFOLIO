// src/services/attlogLive.ts
//
// Pull EN VIVO del ATTLOG de los relojes de SALIDA (dedicados, TCP zkteco-js).
// El reloj de entrada no se baja en vivo (cientos de miles de marcas > límite TCP),
// así que la entrada se toma del checkinout sincronizado.
//
// Caché en memoria por ~2 min: el primer click paga la descarga (~15-20s), los
// siguientes son instantáneos mientras esté fresca.

import fs from 'fs';
import path from 'path';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { logger } from '../logging/logger';

export interface LivePunch { dni: string; fecha: string; hora: string; ts: number; sn: string; tipo: 'Salida'; }

interface CacheEntry { at: number; punches: LivePunch[]; relojes: string[]; }
let cache: CacheEntry | null = null;
const TTL_MS = 120_000;
let inflight: Promise<CacheEntry> | null = null;

function cfgMysql() {
  const p = path.resolve(process.cwd(), 'fichero_config.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
const normDni = (v: any) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const p2 = (n: number) => String(n).padStart(2, '0');

async function pullTodo(): Promise<CacheEntry> {
  const cfg = cfgMysql();
  const conn = await mysql.createConnection({
    host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
    user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '', database: cfg.mysqlDb || 'adms_db',
    connectTimeout: 10_000,
  });
  // relojes de salida (dominante tipo 1), activos y con IP
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT i.SN, i.IPAddress,
            SUM(ci.checktype=0) e, SUM(ci.checktype<>0) s
       FROM iclock i JOIN checkinout ci ON ci.SN=i.SN
      WHERE i.State=1 AND i.IPAddress IS NOT NULL AND i.IPAddress<>''
      GROUP BY i.SN, i.IPAddress`
  );
  await conn.end();
  const salidaClocks = rows
    .filter(r => { const e = Number(r.e) || 0, s = Number(r.s) || 0; return (e + s) > 0 && s / (e + s) >= 0.98; })
    .map(r => ({ sn: String(r.SN), ip: String(r.IPAddress) }));

  const ZKTeco = (await import('zkteco-js' as any)).default ?? (await import('zkteco-js' as any));
  const punches: LivePunch[] = [];
  const relojes: string[] = [];
  for (const c of salidaClocks) {
    const dev = new ZKTeco(c.ip, 4370, 10000, 8000);
    try {
      await dev.createSocket();
      const res = await dev.getAttendances();
      const logs = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      for (const r of logs) {
        const dni = normDni(r.user_id ?? r.deviceUserId ?? r.pin ?? '');
        if (!dni) continue;
        const dt = new Date(r.record_time ?? r.recordTime ?? r.timestamp ?? '');
        if (Number.isNaN(dt.getTime())) continue;
        punches.push({
          dni, ts: dt.getTime(), sn: c.sn, tipo: 'Salida',
          fecha: `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`,
          hora: `${p2(dt.getHours())}:${p2(dt.getMinutes())}`,
        });
      }
      relojes.push(c.sn);
    } catch (e: any) {
      logger.warn({ msg: 'attlogLive: fallo pull reloj', sn: c.sn, ip: c.ip, error: e?.message });
    } finally {
      try { await dev.disconnect(); } catch { /* noop */ }
    }
  }
  return { at: Date.now(), punches, relojes };
}

export async function getSalidaLive(force = false): Promise<CacheEntry> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = pullTodo().then(c => { cache = c; inflight = null; return c; }).catch(e => { inflight = null; throw e; });
  return inflight;
}

// Salidas en vivo de un agente dentro de un rango [desde, hasta] (YYYY-MM-DD).
export async function salidasLiveAgente(dni: string, desde: string, hasta: string, force = false): Promise<{
  punches: Array<{ fecha: string; hora: string; sn: string; tipo: 'Salida' }>;
  relojes: string[]; cacheEdadSeg: number;
}> {
  const c = await getSalidaLive(force);
  const d = normDni(dni);
  const loTs = new Date(desde + 'T00:00:00').getTime();
  const hiTs = new Date(hasta + 'T23:59:59').getTime() + 15 * 3600000; // +15h para salidas nocturnas
  const punches = c.punches
    .filter(p => p.dni === d && p.ts >= loTs && p.ts <= hiTs)
    .sort((a, b) => a.ts - b.ts)
    .map(p => ({ fecha: p.fecha, hora: p.hora, sn: p.sn, tipo: p.tipo }));
  return { punches, relojes: c.relojes, cacheEdadSeg: Math.round((Date.now() - c.at) / 1000) };
}

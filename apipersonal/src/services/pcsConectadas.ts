// src/services/pcsConectadas.ts — qué PCs le están pidiendo cosas a la API ahora (21/11/2026).
// Lo usa la lista "PCs con la app abierta" de la Agenda de turnos: además de las PCs que avisan
// solas (latido, front nuevo), muestra TODAS las que hicieron algún pedido en los últimos minutos,
// con su nombre de red (DNS inverso, ej. RRHHNATY) y usuario. Si una PC aparece acá pero no avisa,
// tiene abierta una versión vieja de la app (hay que recargarla).
// Sin datos de lo que pidió: IP, usuario, navegador y hora. Se guarda en pcs_visitas (mig 145) para ver 24/48 h.
import { Request, Response, NextFunction } from 'express';
import { promises as dns } from 'dns';
import { Sequelize, QueryTypes } from 'sequelize';

export type Visita = { ip: string; userId: number | null; userAgent: string | null; at: number; pedidos: number; primer?: number };
const visitas = new Map<string, Visita>();       // clave: ip (lo último en memoria)
const guardado = new Map<string, number>();      // ip → cuándo se escribió en la base
const nombres = new Map<string, { nombre: string | null; at: number }>();
let base: Sequelize | null = null;

export const ipDe = (req: Request) => String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');

/** La base donde se guarda (tabla pcs_visitas, mig 145): así la lista de 24/48 h sobrevive reinicios. */
export function usarBasePcs(sq: Sequelize) { base = sq; }

/** Middleware (después de authContext): anota IP + usuario. Memoria + base como mucho 1 vez por minuto por PC. */
export function registrarVisita(req: Request, _res: Response, next: NextFunction) {
  try {
    const ip = ipDe(req);
    const a = (req as any).auth;
    // solo personas con el navegador (no robots ni el agente del fichero, que entran con API key)
    const esNavegador = (a?.principalType === 'user' || a?.principalType === 'dev') && /Mozilla\//.test(String(req.headers['user-agent'] || ''));
    if (ip && esNavegador) {
      const userId = Number(a.principalId) || null;
      const prev = visitas.get(ip);
      const v: Visita = {
        ip, userId: userId ?? prev?.userId ?? null, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) || null,
        at: Date.now(), pedidos: (prev?.pedidos ?? 0) + 1,
      };
      visitas.set(ip, v);
      if (base && Date.now() - (guardado.get(ip) ?? 0) > 60_000) {
        const pedidos = v.pedidos;
        guardado.set(ip, Date.now());
        visitas.set(ip, { ...v, pedidos: 0 });   // lo acumulado ya va a la base
        base.query(
          `INSERT INTO pcs_visitas (ip, user_id, user_agent, primer_at, ultimo_at, pedidos) VALUES (:ip, :u, :ua, NOW(), NOW(), :n)
           ON DUPLICATE KEY UPDATE user_id = COALESCE(VALUES(user_id), user_id), user_agent = VALUES(user_agent),
                                   ultimo_at = NOW(), pedidos = pedidos + VALUES(pedidos)`,
          { replacements: { ip, u: v.userId, ua: v.userAgent, n: pedidos } }).catch(() => { guardado.delete(ip); });
      }
    }
  } catch { /* nunca frena el pedido */ }
  next();
}

/** PCs que pidieron algo en los últimos `ms` (base + lo más reciente en memoria). */
export async function visitasRecientes(ms: number): Promise<Visita[]> {
  const desde = Date.now() - ms;
  const out = new Map<string, Visita>();
  if (base) {
    try {
      const rows = await base.query<any>(
        `SELECT ip, user_id, user_agent, pedidos, UNIX_TIMESTAMP(primer_at) * 1000 AS primer, UNIX_TIMESTAMP(ultimo_at) * 1000 AS ultimo
           FROM pcs_visitas WHERE ultimo_at >= FROM_UNIXTIME(:d)`, { replacements: { d: Math.floor(desde / 1000) }, type: QueryTypes.SELECT });
      for (const r of rows) out.set(r.ip, { ip: r.ip, userId: r.user_id, userAgent: r.user_agent, at: Number(r.ultimo), pedidos: Number(r.pedidos), primer: Number(r.primer) });
    } catch { /* tabla todavía no creada: solo memoria */ }
  }
  for (const v of visitas.values()) {
    if (v.at < desde) continue;
    const b = out.get(v.ip);
    out.set(v.ip, { ...v, primer: b?.primer, pedidos: (b?.pedidos ?? 0) + v.pedidos, userId: v.userId ?? b?.userId ?? null });
  }
  return [...out.values()];
}

/**
 * Nombre de red de la PC (ej. 192.168.1.34 → RRHHNATY), cacheado 1 h.
 * Se usa el resolvedor de Windows (getnameinfo: DNS + NetBIOS/LLMNR); el DNS del hospital no tiene
 * los nombres de las PCs. Tarda ~4,5 s: se espera como mucho 1,5 s y si no, se completa en segundo
 * plano (el próximo refresco de la lista ya lo trae).
 */
const enCurso = new Map<string, Promise<string | null>>();
export async function nombreDeIp(ip: string): Promise<string | null> {
  if (ip === '127.0.0.1' || ip === '::1') return 'SERVIDOR';
  const c = nombres.get(ip);
  if (c && Date.now() - c.at < (c.nombre ? 3600_000 : 5 * 60_000)) return c.nombre;   // sin nombre: se reintenta a los 5 min
  let p = enCurso.get(ip);
  if (!p) {
    p = dns.lookupService(ip, 0)
      .then(r => (r.hostname && r.hostname !== ip ? r.hostname.split('.')[0].toUpperCase() : null))
      .catch(() => null)
      .then(nombre => { nombres.set(ip, { nombre, at: Date.now() }); enCurso.delete(ip); return nombre; });
    enCurso.set(ip, p);
  }
  return Promise.race([p, new Promise<string | null>(r => setTimeout(() => r(c?.nombre ?? null), 1500))]);
}

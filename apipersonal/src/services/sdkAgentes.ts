// Registro en memoria de los agentes SDK de relojes (carpeta agente-sdk-relojes, corren en otra PC).
// Cada agente se anuncia cada 60 s; si deja de anunciarse más de 150 s se lo muestra como caído.
// No se persiste: tras un reinicio de la API los agentes reaparecen solos en el próximo anuncio.
import { env } from '../config/env';

export interface SdkAgente {
  id: string;
  host: string;
  ip: string;
  puerto: number;
  sdkVersion: string;
  agenteVersion: string;
  firewall: string;
  origen: string;
  ultimoAviso: number;
}

const VIVO_MS = 150_000;
const agentes = new Map<string, SdkAgente>();

export function claveAgentes(): string {
  return String((env as any).FICHERO_SDK_AGENTE_CLAVE ?? process.env.FICHERO_SDK_AGENTE_CLAVE ?? '').trim();
}

export function registrarAgente(data: Omit<SdkAgente, 'ultimoAviso'>): SdkAgente {
  const agente: SdkAgente = { ...data, ultimoAviso: Date.now() };
  agentes.set(agente.id, agente);
  return agente;
}

export function listarAgentes(): Array<SdkAgente & { vivo: boolean; segundosDesdeAviso: number }> {
  const ahora = Date.now();
  return [...agentes.values()]
    .map(a => ({ ...a, vivo: ahora - a.ultimoAviso < VIVO_MS, segundosDesdeAviso: Math.round((ahora - a.ultimoAviso) / 1000) }))
    .sort((a, b) => Number(b.vivo) - Number(a.vivo) || b.ultimoAviso - a.ultimoAviso);
}

export function obtenerAgente(id: string): SdkAgente | undefined {
  return agentes.get(id);
}

export async function pedirAlAgente(agente: SdkAgente, ruta: string, body?: unknown, timeoutMs = 130_000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${agente.ip}:${agente.puerto}${ruta}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agente-Clave': claveAgentes() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: `Respuesta no JSON del agente (${res.status}): ${text.slice(0, 200)}` };
    }
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'el agente no respondió a tiempo' : (e?.message || String(e));
    return { ok: false, error: `No se pudo hablar con el agente ${agente.id} (${agente.ip}:${agente.puerto}): ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

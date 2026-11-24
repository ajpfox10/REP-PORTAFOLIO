// felicitar.ts — lógica compartida del envío de felicitaciones (página, banner del dashboard
// y envío automático): arma texto + tarjeta, la manda por la extensión y registra el resultado.
import { apiFetch } from '../../api/http';
import { dibujarTarjeta } from './tarjeta';

// Copia chica de lo de WhatsappTab (licencias): importarlo de ahí arrastraría esa página entera
// (y la librería de Excel) a todas las páginas, porque el envío automático vive en el Layout.
export interface ResultadoExt { ok: boolean; estado: string; modo?: 'NOMBRE' | 'TELEFONO'; destino?: string; detalle?: string | null; version?: string }
let seq = 0;
function aExtension(type: string, payload?: any, ms = 5000): Promise<ResultadoExt> {
  const id = `cumple-${Date.now()}-${++seq}`;
  return new Promise((resolve) => {
    const fin = setTimeout(() => { window.removeEventListener('message', oir); resolve({ ok: false, estado: 'ERROR', detalle: 'La extensión no respondió' }); }, ms);
    function oir(ev: MessageEvent) {
      if (ev.source !== window || ev.data?.hpw !== 'ext' || ev.data.id !== id) return;
      clearTimeout(fin); window.removeEventListener('message', oir);
      const { hpw: _h, id: _i, ...r } = ev.data;
      resolve(r);
    }
    window.addEventListener('message', oir);
    window.postMessage({ hpw: 'app', id, type, payload }, window.location.origin);
  });
}

/** Número escrito a mano → 549 + área + número (igual que en licencias). */
function celularPrueba(s: string) {
  const d = s.replace(/\D/g, '');
  if (d.startsWith('549') && d.length === 13) return d;
  let nac = d.startsWith('54') && d.length === 12 ? d.slice(2) : d.replace(/^0+/, '');
  if (nac.length === 12) {
    for (const a of nac.startsWith('11') ? [2] : [3, 4, 2]) {
      if (nac.substr(a, 2) === '15') { nac = nac.slice(0, a) + nac.slice(a + 2); break; }
    }
  } else if (nac.length === 10 && nac.startsWith('15')) nac = '11' + nac.slice(2);
  return nac.length === 10 ? `549${nac}` : d;
}

export interface ConfigFelicitacion {
  plantilla: string;
  plantilla_atrasado: string; // se usa cuando el cumpleaños ya pasó (ayer o antes)
  imagen: string;            // 'diseno:globos' | 'subida:12' | 'carpeta:<archivo>'
  nombre_en_imagen: boolean;
  automatico: boolean;
  hora: string;              // 'HH:MM'
  prueba: boolean;
  destino_prueba: string;
  modo: 'TELEFONO' | 'NOMBRE_TELEFONO';
}

/** Carpeta de tarjetas propias (D:\G\TARJETAS CUMPLEANOS). */
export interface CarpetaTarjetas { ruta: string; uncRel: string; existe: boolean; imagenes: { archivo: string; nombre: string; bytes: number }[]; error?: string }

export interface EnvioResumen { estado: string; modo: string | null; destino: string | null; detalle: string | null; automatico: boolean; at: string }

/** Lo mínimo de un cumpleaños para felicitarlo (sale de GET /alertas-cumpleanos). */
export interface CumpleFelicitable {
  dni: number;
  anio: number;
  apellido: string;
  nombre: string;
  fecha_cumple?: string;     // 'YYYY-MM-DD' del cumpleaños de este año
  dias?: number;             // 0 = hoy, -1 = ayer, ...
  celular?: string | null;
  celular_dudoso?: boolean;
  whatsapp?: { real: EnvioResumen | null; prueba: EnvioResumen | null; intentos: number } | null;
}

/** Versión mínima de la extensión que manda imágenes. */
export const VERSION_EXT_IMAGEN = '1.7.0';

/** Clave en este navegador: "esta PC manda las felicitaciones automáticas". */
export const LS_PC_AUTOMATICA = 'cumple_felicitacion_pc_automatica';
export function esPcAutomatica() {
  try { return localStorage.getItem(LS_PC_AUTOMATICA) === '1'; } catch { return false; }
}
export function setPcAutomatica(v: boolean) {
  try { if (v) localStorage.setItem(LS_PC_AUTOMATICA, '1'); else localStorage.removeItem(LS_PC_AUTOMATICA); } catch { /* sin storage */ }
  // Al destildar se borra del servidor (si no, quedaría como "PC sin señal")
  if (!v) void bajaPcAutomatica();
  // Al tildar: que el componente del Layout arranque ya, sin esperar a recargar la página
  try { window.dispatchEvent(new CustomEvent('p5:cumple_pc_automatica', { detail: v })); } catch { /* noop */ }
}

const palabras = (s: string) => String(s || '').trim().split(/\s+/).filter(Boolean);
const capital = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

export function primerNombre(row: { nombre: string }) { return capital(palabras(row.nombre)[0] || ''); }
/** Nombre que va en la tarjeta: nombres + primer apellido. */
export function nombreTarjeta(row: { nombre: string; apellido: string }) {
  return capital([palabras(row.nombre).join(' '), palabras(row.apellido)[0] || ''].filter(Boolean).join(' '));
}

export function armarTexto(plantilla: string, row: { nombre: string; apellido: string; fecha_cumple?: string; dias?: number }) {
  return plantilla
    .replace(/\{nombre\}/gi, primerNombre(row))
    .replace(/\{apellido\}/gi, capital(palabras(row.apellido).join(' ')))
    .replace(/\{fecha\}/gi, fechaCumpleTexto(row));
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Días desde el cumpleaños: 0 = hoy, negativo = ya pasó. Usa `dias` del back; si no está, lo calcula por la fecha. */
export function diasCumple(row: { fecha_cumple?: string; dias?: number }): number {
  if (typeof row.dias === 'number' && Number.isFinite(row.dias)) return row.dias;
  const [y, m, d] = String(row.fecha_cumple || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return 0;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - hoy.getTime()) / 86400000);
}

/** "ayer" o "el sábado 15/11" (para {fecha} del mensaje atrasado). */
export function fechaCumpleTexto(row: { fecha_cumple?: string; dias?: number }): string {
  const [y, m, d] = String(row.fecha_cumple || '').slice(0, 10).split('-').map(Number);
  if (diasCumple(row) === -1) return 'ayer';
  if (!y || !m || !d) return 'hace unos días';
  const f = new Date(y, m - 1, d);
  return `el ${DIAS_SEMANA[f.getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** El cumpleaños ya pasó → se usa el mensaje de atrasado. */
export function esAtrasado(row: { fecha_cumple?: string; dias?: number }) { return diasCumple(row) < 0; }

/** Texto final que se manda: el de hoy o el de atrasado, según la fecha del cumpleaños. */
export function textoFelicitacion(cfg: ConfigFelicitacion, row: { nombre: string; apellido: string; fecha_cumple?: string; dias?: number }) {
  const plantilla = esAtrasado(row) && cfg.plantilla_atrasado?.trim() ? cfg.plantilla_atrasado : cfg.plantilla;
  return armarTexto(plantilla, row);
}

/** A dónde se manda: en prueba al número/nombre de prueba; si no, al agente. */
export function destinoDe(row: CumpleFelicitable, cfg: ConfigFelicitacion) {
  if (cfg.prueba) {
    const d = (cfg.destino_prueba || '').trim();
    if (!d) return { error: 'Falta el número o nombre de prueba' } as const;
    return /\d{6,}/.test(d)
      ? { modo: 'TELEFONO', buscar: '', palabras: [] as string[], telefono: celularPrueba(d) } as const
      : { modo: 'NOMBRE', buscar: d, palabras: palabras(d), telefono: null } as const;
  }
  const ape = palabras(row.apellido), nom = palabras(row.nombre);
  if (cfg.modo === 'TELEFONO' && !row.celular) return { error: 'Sin celular en la base' } as const;
  return { modo: cfg.modo, buscar: ape[0] || '', palabras: [ape[0], nom[0]].filter(Boolean) as string[], telefono: row.celular ?? null } as const;
}

/**
 * Manda la felicitación de un agente y registra el resultado (si sale bien y no es prueba,
 * el back lo marca AVISADO). automatico = la mandó el envío automático (no una persona).
 */
export async function enviarFelicitacion(row: CumpleFelicitable, cfg: ConfigFelicitacion, automatico = false): Promise<ResultadoExt> {
  const dest = destinoDe(row, cfg);
  let r: ResultadoExt;
  if ('error' in dest) {
    r = { ok: false, estado: 'NO_ENCONTRADO', detalle: dest.error };
  } else {
    let imagen: string | null = null;
    try {
      imagen = await dibujarTarjeta({ imagen: cfg.imagen, nombre: nombreTarjeta(row), mostrarNombre: cfg.nombre_en_imagen });
    } catch (e: any) {
      r = { ok: false, estado: 'ERROR', detalle: `No se pudo armar la tarjeta: ${e?.message || e}` };
    }
    if (imagen) {
      r = await aExtension('ENVIAR', { ...dest, texto: textoFelicitacion(cfg, row), imagen }, 180000);
    }
  }
  try {
    await apiFetch('/alertas-cumpleanos/felicitacion/envios', {
      method: 'POST',
      body: JSON.stringify({
        dni: row.dni, anio: row.anio, estado: r!.estado, modo: r!.modo || null, destino: r!.destino || null,
        detalle: r!.detalle || null, imagen: cfg.imagen, prueba: cfg.prueba, automatico,
      }),
    });
  } catch { /* el envío ya salió; si falla el registro se ve en la lista */ }
  return r!;
}

/** Navegador que tiene tildado "Esta PC manda…", tal como lo ve el servidor por su último latido. */
export interface PcAutomatica {
  pc_id: string; ip: string | null; user_agent: string | null; ext_version: string | null; estado: string | null;
  ultimo_latido: string; usuario: string | null; minutos: number;
}
/** Sin latido hace más de esto = la PC automática "no se reporta" (el latido es cada 5 min). */
export const PC_SIN_SENAL_MIN = 15;

export const TXT_ESTADO_PC: Record<string, string> = {
  OK: 'Funcionando',
  ANTES_DE_HORA: 'Esperando la hora',
  APAGADO: 'Automático desactivado',
  SIN_DESTINO_PRUEBA: 'Modo prueba sin número de prueba',
  SIN_EXTENSION: 'No detecta la extensión de WhatsApp',
  EXTENSION_VIEJA: 'Extensión de WhatsApp vieja',
  ERROR: 'Error al consultar',
};

export async function leerConfigFelicitacion() {
  const r = await apiFetch<any>('/alertas-cumpleanos/felicitacion/config');
  return r.data as { config: ConfigFelicitacion; imagenes: { id: number; nombre: string; mime: string; bytes: number; created_at: string }[]; carpeta: CarpetaTarjetas; pcs?: PcAutomatica[]; plantilla_default: string; plantilla_atrasado_default: string };
}

/** Id fijo de este navegador (para el latido de la PC automática). */
const LS_PC_ID = 'cumple_felicitacion_pc_id';
export function pcIdNavegador(): string {
  try {
    let id = localStorage.getItem(LS_PC_ID);
    if (!id) {
      id = `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(LS_PC_ID, id);
    }
    return id;
  } catch { return 'pc-sin-storage'; }
}

/** Avisa al servidor que esta PC automática sigue viva (y en qué estado). Nunca tira error. */
export async function latidoPcAutomatica(estado: string, ext: string | null) {
  try {
    await apiFetch('/alertas-cumpleanos/felicitacion/latido', {
      method: 'POST', body: JSON.stringify({ pc_id: pcIdNavegador(), estado, ext }),
    });
  } catch { /* sin red: el próximo latido lo actualiza */ }
}
export async function bajaPcAutomatica() {
  try {
    await apiFetch('/alertas-cumpleanos/felicitacion/latido', {
      method: 'POST', body: JSON.stringify({ pc_id: pcIdNavegador(), baja: true }),
    });
  } catch { /* si falla, la fila vieja simplemente queda "sin señal" */ }
}

/** Pide la versión de la extensión instalada (null si no hay). */
export async function versionExtension(): Promise<string | null> {
  const r = await aExtension('PING', undefined, 1500);
  return r.ok ? String(r.version || '?') : null;
}

export const TXT_ESTADO_WSP: Record<string, string> = {
  ENVIADO: 'Enviado', NO_ENCONTRADO: 'No encontrado', SIN_WHATSAPP: 'Sin WhatsApp', ERROR: 'Error',
};

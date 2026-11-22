// envioCola.tsx — cola de envíos de la agenda de turnos (mig 143).
// El servidor no tiene WhatsApp abierto: la oficina pone los enlaces en la cola desde cualquier PC y los
// manda UNA PC marcada ("Esta PC manda los mensajes de la agenda") que tiene la app + la extensión +
// WhatsApp Web abiertos. EnvioAgendaAutomatico vive en el Layout (cualquier página) y solo hace algo en esa PC.
// Archivo chico a propósito: el Layout lo importa y no debe arrastrar la página de la agenda.
import { useEffect } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

export const LS_PC_AGENDA = 'agenda_envio_pc';          // '1' = esta PC manda
export const LS_PC_AGENDA_NOMBRE = 'agenda_envio_pc_nombre';

export function esPcAgenda() { try { return localStorage.getItem(LS_PC_AGENDA) === '1'; } catch { return false; } }
export function setPcAgenda(v: boolean) { try { if (v) localStorage.setItem(LS_PC_AGENDA, '1'); else localStorage.removeItem(LS_PC_AGENDA); } catch { /* sin storage */ } }
export function nombrePcAgenda() {
  try {
    let n = localStorage.getItem(LS_PC_AGENDA_NOMBRE);
    if (!n) { n = `PC-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; localStorage.setItem(LS_PC_AGENDA_NOMBRE, n); }
    return n;
  } catch { return 'PC'; }
}
export function setNombrePcAgenda(n: string) { try { localStorage.setItem(LS_PC_AGENDA_NOMBRE, n.trim().slice(0, 60) || 'PC'); } catch { /* noop */ } }
/** Id fijo de esta PC (navegador): con esto se la elige desde otra PC en "PCs conectadas". */
export function pcIdAgenda() {
  try {
    let id = localStorage.getItem('agenda_envio_pc_id');
    if (!id) { id = `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem('agenda_envio_pc_id', id); }
    return id;
  } catch { return 'pc-sin-storage'; }
}
/** Elige la PC que manda (null = ninguna). Lo guarda el servidor; la PC elegida se entera en su próximo aviso. */
export async function designarPcAgenda(pcId: string | null) {
  await apiFetch('/agenda-turnos/pcs/designar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pc_id: pcId, nombre: nombrePcAgenda() }) });
  if (pcId === pcIdAgenda()) setPcAgenda(true);
  else setPcAgenda(false);
}
/** Desde la 1.9.2 la extensión dice si WhatsApp Web está abierto (para la lista de PCs conectadas). */
export const VERSION_EXT_ESTADO_WA = '1.9.2';

interface ResultadoExt {
  ok: boolean; estado: string; destino?: string; detalle?: string | null; version?: string;
  encontrado?: boolean; sinLeer?: number; mensajes?: { t: number | null; tipo: string; texto: string }[];
}
/** Desde la 1.9.0 la extensión lee los mensajes sin leer de un chat (sin abrirlo). */
export const VERSION_EXT_SIN_LEER = '1.9.0';
const cmp = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); }
  return 0;
};

// ── Actualización forzada de la extensión ────────────────────────────────────
// Al deployar, el front publica /extension-whatsapp/version.json. El actualizador de cada PC (tarea de
// Windows cada 10 min) baja la versión nueva al disco; acá, si la instalada es más vieja que la publicada,
// se le pide a la extensión que se recargue ya (las versiones viejas no conocen la acción y se recargan igual).
let ultimaRevision = 0;
export async function forzarActualizacionExtension(instalada?: string | null): Promise<string | null> {
  const v = instalada === undefined ? await versionExtensionAgenda() : instalada;
  if (!v || v === '?') return null;
  try {
    const j = await fetch('/extension-whatsapp/version.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null));
    const publicada = j?.version ? String(j.version) : null;
    if (publicada && cmp(v, publicada) < 0 && Date.now() - ultimaRevision > 60_000) {
      ultimaRevision = Date.now();
      await aExtension('REVISAR_VERSION', undefined, 3000);
    }
    return publicada;
  } catch { return null; }
}
let seq = 0;
function aExtension(type: string, payload?: any, ms = 5000): Promise<ResultadoExt> {
  const id = `agenda-${Date.now()}-${++seq}`;
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
export async function versionExtensionAgenda(): Promise<string | null> {
  const r = await aExtension('PING', undefined, 1500);
  return r.ok ? String(r.version || '?') : null;
}

const CADA_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (url: string, body: any) => apiFetch<any>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let corriendo = false; // a nivel módulo: el Layout se vuelve a montar en cada página

async function ronda(avisar: (ok: number, total: number, pausa?: string, retenidos?: number) => void) {
  if (corriendo || !esPcAgenda()) return;
  corriendo = true;
  let ok = 0, total = 0, retenidos = 0;
  try {
    const version = await versionExtensionAgenda();
    const pc = nombrePcAgenda();
    const pc_id = pcIdAgenda();
    if (!version) { await post('/agenda-turnos/cola/tomar', { pc, pc_id, sin_extension: true }).catch(() => null); return; }
    if (version === '?' || cmp(version, VERSION_EXT_SIN_LEER) < 0) {
      // sin la 1.9.0 no se pueden revisar los mensajes sin leer: no se manda nada hasta que se actualice
      await forzarActualizacionExtension(version);
      await post('/agenda-turnos/cola/tomar', { pc, pc_id, version, ext_vieja: true }).catch(() => null);
      return;
    }
    for (let i = 0; i < 200 && esPcAgenda(); i++) {
      const t = await post('/agenda-turnos/cola/tomar', { pc, pc_id, version });
      if (t?.no_designada) { setPcAgenda(false); break; }   // eligieron otra PC
      const it = t?.data;
      if (!it) { if (t?.pausa && total) avisar(ok, total, t.pausa); break; }
      // ¿el agente tenía mensajes sin leer? Al mandar se marcarían como leídos: se frena y se avisa en la página
      if (it.revisar_sin_leer) {
        const s = await aExtension('SIN_LEER', { telefono: it.revisar_sin_leer }, 20_000);
        if (!s.ok) {
          await post(`/agenda-turnos/cola/${it.id}/resultado`, { toma: it.toma, estado: 'ERROR', detalle: `no se pudo revisar si tenía mensajes sin leer (${s.detalle || s.estado}); no se mandó` }).catch(() => null);
          continue;
        }
        if (s.sinLeer) {
          retenidos++;
          await post(`/agenda-turnos/cola/${it.id}/resultado`, { toma: it.toma, estado: 'SIN_LEER', sin_leer: s.sinLeer, mensajes: s.mensajes || [] }).catch(() => null);
          continue;
        }
      }
      if (total > 0) await sleep(20_000 + Math.random() * 20_000);   // pausa entre mensajes
      total++;
      const r = await aExtension('ENVIAR', { modo: 'TELEFONO', buscar: '', palabras: [], telefono: it.celular, texto: it.texto }, 180_000);
      if (r.ok) ok++;
      await post(`/agenda-turnos/cola/${it.id}/resultado`, { toma: it.toma, estado: r.ok ? 'ENVIADO' : r.estado, detalle: r.detalle || null, destino: r.destino || null })
        .catch(() => null); // si no se pudo anotar, a los 10 min vuelve a la cola (puede repetir ese mensaje)
    }
    if (total || retenidos) avisar(ok, total, undefined, retenidos);
  } catch {
    /* sin red / sin permiso: se reintenta en la próxima vuelta */
  } finally {
    corriendo = false;
  }
}

// Aviso de "estoy conectada" (todas las PCs con la app abierta, cada minuto). Si el usuario no tiene permiso
// para la agenda, después de 3 fallas seguidas deja de avisar hasta recargar la página.
let fallasLatido = 0;
async function latido(alCambiar: () => void) {
  if (fallasLatido >= 3) return;
  try {
    const version = await versionExtensionAgenda();
    let wa: { abierto?: boolean; listo?: boolean } = {};
    if (version && version !== '?' && cmp(version, VERSION_EXT_ESTADO_WA) >= 0) {
      const r: any = await aExtension('ESTADO_WA', undefined, 5000);
      if (r.ok) wa = { abierto: !!r.abierto, listo: !!r.listo };
    }
    const r = await post('/agenda-turnos/pcs/latido', {
      pc_id: pcIdAgenda(), nombre: nombrePcAgenda(), version,
      whatsapp: typeof wa.abierto === 'boolean' ? wa.abierto : undefined, whatsapp_listo: typeof wa.listo === 'boolean' ? wa.listo : undefined,
    });
    fallasLatido = 0;
    // nombre al azar (PC-XXXX) → el nombre de red de la PC (ej. RRHHNATY)
    if (r?.data?.red && /^PC-[A-Z0-9]{4}$/.test(nombrePcAgenda())) setNombrePcAgenda(String(r.data.red));
    const manda = !!r?.data?.manda;
    if (r?.data?.hay_designada) {
      if (manda !== esPcAgenda()) { setPcAgenda(manda); alCambiar(); }
    } else if (esPcAgenda()) {
      await designarPcAgenda(pcIdAgenda()).catch(() => null);   // tilde viejo (de antes de la lista): queda elegida
    }
  } catch { fallasLatido++; }
}

export function EnvioAgendaAutomatico() {
  const toast = useToast();
  useEffect(() => {
    // corre siempre: ronda() no hace nada si esta PC no está marcada (así toma el tilde sin recargar)
    const avisar = (ok: number, total: number, pausa?: string, retenidos = 0) => {
      if (pausa) toast.warning('📆 Agenda: envíos en pausa', pausa);
      if (total) toast.ok('📆 Agenda de turnos: mensajes enviados', `${ok} de ${total} salieron bien`);
      if (retenidos) toast.warning('📩 Agenda: no se mandaron', `${retenidos} tenían mensajes sin leer: revisalos en Agenda de turnos`);
    };
    // en TODAS las PCs con la extensión: si hay versión nueva publicada, que se recargue ya
    const rev = () => void forzarActualizacionExtension().catch(() => null);
    const revPrimera = setTimeout(rev, 15_000);
    const revCada = setInterval(rev, 5 * 60_000);
    const primera = setTimeout(() => void ronda(avisar), 8_000);
    const cada = setInterval(() => void ronda(avisar), CADA_MS);
    // la eligieron desde otra PC → arranca a mandar sin esperar la próxima vuelta
    const avisarLatido = () => { if (esPcAgenda()) { toast.ok('📆 Esta PC manda los mensajes de la agenda', 'La eligieron desde la lista de PCs conectadas.'); void ronda(avisar); } };
    const latPrimera = setTimeout(() => void latido(avisarLatido), 3_000);
    const latCada = setInterval(() => void latido(avisarLatido), 60_000);
    return () => { clearTimeout(primera); clearInterval(cada); clearTimeout(revPrimera); clearInterval(revCada); clearTimeout(latPrimera); clearInterval(latCada); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// gpEnvio.ts — lo común del aviso de Gestiones Personales por WhatsApp: armar el texto y
// mandarlo por la extensión (dejar ESCRITO sin enviar, o ENVIAR solo). Lo usan la página
// (/app/gestiones-personales-avisos) y el ejecutor de envíos programados del Layout
// (GpProgramadosRunner.tsx). Copia chica de aExtension para no arrastrar WhatsappTab (y Excel)
// a todas las páginas, igual que felicitar.ts de cumpleaños.
import { apiFetch } from '../../api/http';

export interface ResultadoExt { ok: boolean; estado: string; modo?: 'NOMBRE' | 'TELEFONO'; detalle?: string | null; version?: string }
let seq = 0;
export function aExtensionGp(type: string, payload?: any, ms = 5000): Promise<ResultadoExt> {
  const id = `gp-${Date.now()}-${++seq}`;
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
export function celular549(s: string) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('549') && d.length === 13) return d;
  let nac = d.startsWith('54') && d.length === 12 ? d.slice(2) : d.replace(/^0+/, '');
  if (nac.length === 12) {
    for (const a of nac.startsWith('11') ? [2] : [3, 4, 2]) {
      if (nac.substr(a, 2) === '15') { nac = nac.slice(0, a) + nac.slice(a + 2); break; }
    }
  } else if (nac.length === 10 && nac.startsWith('15')) nac = '11' + nac.slice(2);
  return nac.length === 10 ? `549${nac}` : d;
}

// Desde la 1.8.0 la extensión sabe dejar el mensaje escrito sin enviar.
export const EXT_MIN = '1.8.0';
export const verMayorIgual = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return true;
};
export const palabrasDe = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z]+/).filter(w => w.length > 1);
const tc = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());

export interface AvisoMin { id: number; dni: number; agente: string | null; apellido: string | null; nombre: string | null; celular: string | null }

export function nombreDe(a: AvisoMin) {
  const [apeGp, nomGp] = String(a.agente || '').split(',').map(s => s.trim());
  return { apellido: a.apellido || apeGp || '', nombre: a.nombre || nomGp || '' };
}
export function textoPara(plantilla: string, a: AvisoMin) {
  const { apellido, nombre } = nombreDe(a);
  return plantilla
    .replace(/\{nombre\}/g, tc(nombre.split(/\s+/)[0] || ''))
    .replace(/\{apellido\}/g, tc(apellido))
    .replace(/\{dni\}/g, String(a.dni));
}

/** Tope de espera de un envío. Desde la ext 1.9.3 los envíos hacen fila en el mismo Chrome: uno puede
 *  esperar a otro (un programado + un Escribir a mano), por eso es largo (antes 150 s). */
export const ESPERA_ENVIO_MS = 10 * 60 * 1000;

export async function marcarGp(ids: number[], estado: string, extra: { telefono?: string | null; detalle?: string | null } = {}) {
  await apiFetch('/gp-avisos/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, estado, ...extra }) });
}

/**
 * Manda UN aviso real por la extensión y deja el estado en la base.
 * enviar=false → queda ESCRITO (la persona toca Enviar); enviar=true → se envía y queda ENVIADO.
 * telManual = número elegido a mano (fuerza buscar por teléfono).
 */
export async function avisarUno(a: AvisoMin, plantilla: string, opts: { enviar: boolean; telManual?: string | null; etiqueta?: string }): Promise<boolean> {
  const texto = textoPara(plantilla, a);
  const manual = opts.telManual ? celular549(opts.telManual) : null;
  const tel = manual || a.celular;
  if (!tel) { await marcarGp([a.id], 'PENDIENTE', { detalle: 'Sin celular en la base' }); return false; }
  const { apellido, nombre } = nombreDe(a);
  const ape = palabrasDe(apellido), nom = palabrasDe(nombre);
  const r = await aExtensionGp('ENVIAR',
    { modo: manual ? 'TELEFONO' : 'NOMBRE_TELEFONO', buscar: ape[0] || '', palabras: [ape[0], nom[0]].filter(Boolean), telefono: tel, texto, sinEnviar: !opts.enviar },
    ESPERA_ENVIO_MS);
  const etiqueta = opts.etiqueta ? `${opts.etiqueta}. ` : '';
  if (r.ok) {
    await marcarGp([a.id], opts.enviar ? 'ENVIADO' : 'ESCRITO', {
      telefono: r.modo === 'TELEFONO' ? tel : null,
      detalle: (etiqueta + (r.modo === 'NOMBRE' ? 'Chat encontrado por nombre' : '')).trim() || null,
    });
  } else {
    await marcarGp([a.id], 'PENDIENTE', { detalle: `${etiqueta}${r.estado}: ${r.detalle || ''}`.slice(0, 300) });
  }
  return r.ok;
}

// ── Id de esta PC (navegador): se genera solo la primera vez y queda guardado. Con él se anota
// en el servidor y se la elige al programar desde cualquier lado (el nombre se pone desde la lista).
export const LS_PC_GP_ID = 'gp_avisos_pc_id';
export function idPcGp(): string {
  try {
    let id = localStorage.getItem(LS_PC_GP_ID) || '';
    if (!/^[a-z0-9-]{8,40}$/.test(id)) {
      id = (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).toLowerCase();
      localStorage.setItem(LS_PC_GP_ID, id);
    }
    return id;
  } catch { return ''; }
}

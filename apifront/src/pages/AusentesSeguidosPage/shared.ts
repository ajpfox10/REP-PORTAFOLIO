// src/pages/AusentesSeguidosPage/shared.ts
// Tipos y helpers de "Ausentes seguidos" (banner del Dashboard + página). Fuente: GET /fichajes-agentes/ausentes-seguidos.
import { apiFetch } from '../../api/http';

export type TipoDia = 'AUSENTE' | 'AUSENTE_NO_TOCA' | 'NO_LE_TOCA' | 'EN_CURSO';
export interface DiaRacha {
  fecha: string; dow: number; tipo: TipoDia; horario: string | null; feriado: string | null;
  siape?: boolean; ministerio?: boolean; fichaje?: string; sinHorario?: boolean; turno?: string | null;
  reconocido?: string[]; saludLaboral?: string[]; art?: string[]; jefe?: string[]; otras?: string[];
  marcas?: { h: string; t: string }[];
}
export interface Racha { desde: string; hasta: string; seguidos: number; fichoDias: number; avisos: string[]; dias: DiaRacha[] }
export interface AgenteSeguido {
  dni: string; nombre: string; servicio: string | null; ley: string | null; dependencia: string | null; ocupacion: string | null;
  maxSeguidos: number; avisos: string[]; rachas: Racha[];
}
export interface RespSeguidos {
  ok: boolean; error?: string; desde: string; hasta: string; min: number;
  corrida: { id: number; creado_en: string; siape_modificado?: string; ministerio_modificado?: string } | null;
  avisos: string[]; agentes: AgenteSeguido[]; generado?: string;
}

export async function cargarSeguidos(p: { desde?: string; hasta?: string; min?: number; refresh?: boolean } = {}) {
  const q = new URLSearchParams();
  if (p.desde) q.set('desde', p.desde);
  if (p.hasta) q.set('hasta', p.hasta);
  if (p.min) q.set('min', String(p.min));
  if (p.refresh) q.set('refresh', '1');
  const r = await apiFetch<RespSeguidos>(`/fichajes-agentes/ausentes-seguidos?${q.toString()}`);
  if (!r?.ok) throw new Error(r?.error || 'Error cargando ausentes seguidos');
  return r;
}

const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const diaCorto = (d: { fecha: string; dow: number }) => `${DOW[d.dow]} ${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}`;
export const fmtF = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const FICHO = new Set(['COMPLETO', 'SOLO_ENTRADA', 'SOLO_SALIDA', 'FICHO_SIN_TURNO']);
/** Aviso legible: "Ausente el 2026-10-02 y …" → "Ausente el vie 02/10 y …". */
export function avisoLegible(a: string) {
  return a.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_m, y, mo, d) => {
    const dow = new Date(`${y}-${mo}-${d}T12:00:00Z`).getUTCDay();
    return `${DOW[dow]} ${d}/${mo}`;
  });
}

/** Racha en texto corto: junta los días seguidos que no le tocan y, si es muy larga, recorta el medio. */
export function resumenRacha(dias: DiaRacha[], maxPartes = 9): string {
  const partes: string[] = [];
  for (let i = 0; i < dias.length; i++) {
    const d = dias[i];
    if (d.tipo === 'NO_LE_TOCA' || d.tipo === 'EN_CURSO') {
      let j = i;
      while (j + 1 < dias.length && (dias[j + 1].tipo === 'NO_LE_TOCA' || dias[j + 1].tipo === 'EN_CURSO')) j++;
      partes.push(j === i ? `(${diaCorto(d)} no le toca)` : `(${j - i + 1} días no le tocan)`);
      i = j;
    } else partes.push(d.tipo === 'AUSENTE_NO_TOCA' ? `${diaCorto(d)} ⚠️` : diaCorto(d));
  }
  if (partes.length <= maxPartes) return partes.join(' · ');
  return [...partes.slice(0, 4), '…', ...partes.slice(-3)].join(' · ');
}

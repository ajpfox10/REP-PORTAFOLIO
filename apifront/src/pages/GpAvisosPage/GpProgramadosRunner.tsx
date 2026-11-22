// GpProgramadosRunner — vive en el Layout (cualquier página de la app). En cada navegador que
// tenga la extensión de WhatsApp: cada minuto se anota solo en el servidor con su id propio
// (idPcGp, localStorage) — así aparece para elegirla al programar desde cualquier PC, con su IP
// y usuario, y se le pone nombre desde la lista — y pide si hay un envío programado vencido para
// ella. Si hay, lo "toma" (no se duplica) y avisa uno por uno: deja el mensaje ESCRITO o lo
// ENVÍA solo, según se programó. Sin extensión no hace nada.
import { useEffect } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { EXT_MIN, aExtensionGp, avisarUno, idPcGp, verMayorIgual } from './gpEnvio';

const CADA_MS = 60 * 1000;
let corriendo = false; // a nivel módulo: el Layout se vuelve a montar en cada página
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ronda(avisar: (titulo: string, txt: string, ok: boolean) => void) {
  if (corriendo) return;
  const pc = idPcGp();
  if (!pc) return;
  corriendo = true;
  let trabajoId: number | null = null;
  try {
    const ping = await aExtensionGp('PING', undefined, 1500).catch(() => ({ ok: false } as any));
    if (!ping?.ok) return; // sin extensión: esta PC no manda WhatsApp, no se anota
    const version = ping.version || '?';
    await apiFetch('/gp-avisos/pcs/senal', { method: 'POST', body: JSON.stringify({ id: pc, version }) });
    // Extensión vieja (no sabe dejar escrito): no toma nada (queda atrasado hasta que se actualice)
    if (version === '?' || !verMayorIgual(version, EXT_MIN)) return;

    const r = await apiFetch<any>('/gp-avisos/programados/tomar', { method: 'POST', body: JSON.stringify({ pc }) });
    const t = r?.trabajo;
    if (!t) return;
    trabajoId = t.id;
    const enviar = t.modo === 'ENVIAR';
    let ok = 0, mal = 0;
    for (let i = 0; i < t.avisos.length; i++) {
      const a = t.avisos[i];
      try {
        (await avisarUno(a, t.mensaje, { enviar, telManual: a.telefono_elegido, etiqueta: `Programado #${t.id}` })) ? ok++ : mal++;
      } catch { mal++; }
      if (i < t.avisos.length - 1) await sleep((enviar ? 20000 : 3000) + Math.random() * (enviar ? 20000 : 2000));
    }
    const resultado = `${ok} ${enviar ? 'enviados' : 'escritos'}${mal ? `, ${mal} con error` : ''}`;
    await apiFetch(`/gp-avisos/programados/${t.id}/fin`, { method: 'POST', body: JSON.stringify({ ok, mal, resultado }) });
    trabajoId = null;
    avisar(`📲 Avisos GP programados (#${t.id})`, enviar ? resultado : `${resultado}. Entrá a cada chat y tocá Enviar.`, mal === 0);
  } catch {
    /* sin red / sin permiso: se reintenta en la próxima vuelta */
  } finally {
    if (trabajoId) {
      await apiFetch(`/gp-avisos/programados/${trabajoId}/fin`, { method: 'POST', body: JSON.stringify({ ok: 0, mal: 1, resultado: 'Falló a mitad de camino; los que faltaban siguen para avisar' }) }).catch(() => {});
    }
    corriendo = false;
  }
}

export function GpProgramadosRunner() {
  const toast = useToast();
  useEffect(() => {
    const avisar = (titulo: string, txt: string, bien: boolean) => (bien ? toast.ok(titulo, txt) : toast.warning(titulo, txt));
    const primera = setTimeout(() => void ronda(avisar), 5000);
    const cada = setInterval(() => void ronda(avisar), CADA_MS);
    return () => { clearTimeout(primera); clearInterval(cada); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

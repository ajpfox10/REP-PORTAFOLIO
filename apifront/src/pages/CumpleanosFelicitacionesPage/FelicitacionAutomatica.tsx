// FelicitacionAutomatica — vive en el Layout (cualquier página de la app). Solo hace algo en la
// PC que tiene tildado "Esta PC manda las felicitaciones automáticas". Cada 5 minutos: si el
// envío automático está activado y ya pasó la hora, felicita a los que cumplen HOY y siguen
// pendientes. Cada cumpleaños se "toma" en el back antes de mandarlo (no se duplica entre PCs
// y se intenta una sola vez por año en automático).
import { useEffect } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { cmpVersion } from '../LicenciasMedicasControlPage/ExtensionDescarga';
import { cargarCumpleanosAlertas } from '../AlertasPage/CumpleanosBanner';
import { VERSION_EXT_IMAGEN, enviarFelicitacion, esPcAutomatica, latidoPcAutomatica, leerConfigFelicitacion, versionExtension } from './felicitar';

const CADA_MS = 5 * 60 * 1000;
let corriendo = false; // a nivel módulo: el Layout se vuelve a montar en cada página

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const horaActual = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function ronda(avisar: (ok: number, total: number, prueba: boolean) => void) {
  if (corriendo || !esPcAutomatica()) return;
  corriendo = true;
  let estado = 'ERROR', ext: string | null = null;
  try {
    const { config } = await leerConfigFelicitacion();
    ext = await versionExtension();
    if (!config.automatico) { estado = 'APAGADO'; return; }
    if (config.prueba && !config.destino_prueba.trim()) { estado = 'SIN_DESTINO_PRUEBA'; return; }
    if (!ext || ext === '?') { estado = 'SIN_EXTENSION'; return; }
    if (cmpVersion(ext, VERSION_EXT_IMAGEN) < 0) { estado = 'EXTENSION_VIEJA'; return; }
    if (horaActual() < config.hora) { estado = 'ANTES_DE_HORA'; return; }
    estado = 'OK';

    const hoy = (await cargarCumpleanosAlertas('pendientes', 0)).filter((r) => r.dias === 0) as any[];
    let ok = 0, total = 0;
    for (const row of hoy) {
      if (!esPcAutomatica()) break;
      const t = await apiFetch<any>('/alertas-cumpleanos/felicitacion/tomar', {
        method: 'POST', body: JSON.stringify({ dni: row.dni, anio: row.anio, prueba: config.prueba }),
      });
      if (!t?.tomado) continue;
      if (total > 0) await sleep(20000 + Math.random() * 20000);
      total++;
      const r = await enviarFelicitacion(row, config, true);
      if (r.ok) ok++;
    }
    if (total > 0) avisar(ok, total, config.prueba);
  } catch {
    /* sin red / sin permiso: se reintenta en la próxima vuelta */
  } finally {
    corriendo = false;
    // Latido: la página de Felicitaciones avisa si esta PC deja de reportarse
    if (esPcAutomatica()) void latidoPcAutomatica(estado, ext);
  }
}

export function FelicitacionAutomatica() {
  const toast = useToast();
  useEffect(() => {
    // Se monta siempre (aunque hoy no esté tildada): así, si alguien tilda "Esta PC manda…",
    // arranca al toque sin recargar. ronda() no hace nada si esta PC no está tildada.
    const avisar = (ok: number, total: number, prueba: boolean) =>
      toast.ok(`🎂 Felicitaciones automáticas${prueba ? ' (PRUEBA)' : ''}`, `${ok} de ${total} enviadas`);
    const correr = () => void ronda(avisar);
    // Al volver (pestaña visible otra vez, PC que sale de suspensión, vuelve la red) no se
    // espera a la próxima vuelta de 5 minutos: se revisa enseguida.
    let ultimo = Date.now();
    const alVolver = () => {
      if (document.visibilityState !== 'visible' && !navigator.onLine) return;
      if (Date.now() - ultimo < 60_000) return;
      ultimo = Date.now();
      setTimeout(correr, 3000);
    };
    const alTildar = (ev: any) => { if (ev?.detail) setTimeout(correr, 1000); };
    const primera = setTimeout(correr, 20000);
    const cada = setInterval(() => { ultimo = Date.now(); correr(); }, CADA_MS);
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('online', alVolver);
    window.addEventListener('focus', alVolver);
    window.addEventListener('p5:cumple_pc_automatica', alTildar);
    return () => {
      clearTimeout(primera); clearInterval(cada);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('online', alVolver);
      window.removeEventListener('focus', alVolver);
      window.removeEventListener('p5:cumple_pc_automatica', alTildar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

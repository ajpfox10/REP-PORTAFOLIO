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
import { VERSION_EXT_IMAGEN, enviarFelicitacion, esPcAutomatica, leerConfigFelicitacion, versionExtension } from './felicitar';

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
  try {
    const { config } = await leerConfigFelicitacion();
    if (!config.automatico || horaActual() < config.hora) return;
    if (config.prueba && !config.destino_prueba.trim()) return;
    const ext = await versionExtension();
    if (!ext || ext === '?' || cmpVersion(ext, VERSION_EXT_IMAGEN) < 0) return;

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
  }
}

export function FelicitacionAutomatica() {
  const toast = useToast();
  useEffect(() => {
    if (!esPcAutomatica()) return;
    const avisar = (ok: number, total: number, prueba: boolean) =>
      toast.ok(`🎂 Felicitaciones automáticas${prueba ? ' (PRUEBA)' : ''}`, `${ok} de ${total} enviadas`);
    const primera = setTimeout(() => void ronda(avisar), 20000);
    const cada = setInterval(() => void ronda(avisar), CADA_MS);
    return () => { clearTimeout(primera); clearInterval(cada); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// src/components/RobotsFallidosBanner.tsx
// Banner global (solo admin): robots cuya ÚLTIMA corrida terminó en error.
// No se puede cerrar a mano: cada robot desaparece recién cuando su última corrida
// queda OK. Desde acá (y desde la página Robots) se lo puede lanzar sin esperar la hora.
// Lo "lanzado" se guarda en sessionStorage para sobrevivir al cambio de página.

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/http';

export interface RobotFallido {
  run_id:         number;
  script:         string;
  descripcion:    string;
  motivo:         string | null;
  actualizado_at: string;
  lanzable:       boolean;
}

interface Lanzado { at: string; runIdPrevio: number | null }

const KEY = 'robots_lanzados';
const EVENTO = 'robots:lanzado';

function leerLanzados(): Record<string, Lanzado> {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function guardarLanzados(v: Record<string, Lanzado>) {
  try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin storage: solo se pierde el "corriendo" */ }
}

/** Lanza el robot ya (su tarea \Robots\<script> o run_robot.py directo) y lo marca como "corriendo". */
export async function lanzarRobot(script: string, runIdPrevio: number | null): Promise<void> {
  const r = await apiFetch<any>(`/script-runs/ejecutar/${encodeURIComponent(script)}`, { method: 'POST' });
  if (!r?.ok) throw new Error(r?.error || 'No se pudo lanzar');
  guardarLanzados({ ...leerLanzados(), [script]: { at: new Date().toISOString(), runIdPrevio } });
  window.dispatchEvent(new Event(EVENTO));
}

/** ¿Está lanzado y todavía sin una corrida nueva? */
export function estaCorriendo(script: string, runIdActual: number | null): Lanzado | null {
  const l = leerLanzados()[script];
  return l && (runIdActual == null || l.runIdPrevio === runIdActual) ? l : null;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export function RobotsFallidosBanner() {
  const [fallidos, setFallidos] = useState<RobotFallido[]>([]);
  const [lanzados, setLanzados] = useState<Record<string, Lanzado>>(leerLanzados);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<any>('/script-runs/fallidos');
      if (!r?.ok) return;
      const data: RobotFallido[] = r.data || [];
      // limpiar los lanzados que ya tienen resultado: terminó OK (no está en fallidos)
      // o volvió a fallar (corrida nueva) → se muestra el error nuevo con su botón
      const l = leerLanzados();
      for (const s of Object.keys(l)) {
        const f = data.find(x => x.script === s);
        if (!f || f.run_id !== l[s].runIdPrevio) delete l[s];
      }
      guardarLanzados(l);
      setLanzados(l);
      setFallidos(data);
    } catch { /* sin conexión: se reintenta en la próxima vuelta */ }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // cada 30 s si hay algo corriendo, si no cada 3 min
  const hayCorriendo = Object.keys(lanzados).length > 0;
  useEffect(() => {
    const id = window.setInterval(cargar, hayCorriendo ? 30_000 : 180_000);
    return () => window.clearInterval(id);
  }, [cargar, hayCorriendo]);

  useEffect(() => {
    const h = () => { setLanzados(leerLanzados()); cargar(); };
    window.addEventListener(EVENTO, h);
    return () => window.removeEventListener(EVENTO, h);
  }, [cargar]);

  const lanzar = async (f: RobotFallido) => {
    setEnviando(f.script);
    setErrores(e => ({ ...e, [f.script]: '' }));
    try {
      await lanzarRobot(f.script, f.run_id);
    } catch (e: any) {
      setErrores(prev => ({ ...prev, [f.script]: e?.message || 'No se pudo lanzar' }));
    } finally {
      setEnviando(null);
    }
  };

  if (fallidos.length === 0) return null;

  const btn: React.CSSProperties = {
    background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 6, color: '#fee2e2',
    padding: '4px 12px', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      marginTop: 12, background: 'rgba(127,29,29,0.25)', border: '1px solid rgba(239,68,68,0.55)',
      borderRadius: 10, padding: '10px 14px', color: '#fecaca',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <b style={{ fontSize: '0.85rem' }}>🤖❌ {fallidos.length === 1 ? 'Un robot falló' : `${fallidos.length} robots fallaron`} en su última corrida</b>
        <Link to="/app/scripts-siape" style={{ color: '#fca5a5', fontSize: '0.75rem' }}>Ver robots →</Link>
      </div>
      {fallidos.map(f => {
        const l = lanzados[f.script] && lanzados[f.script].runIdPrevio === f.run_id ? lanzados[f.script] : null;
        return (
          <div key={f.script} style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            padding: '6px 0', borderTop: '1px solid rgba(239,68,68,0.2)', fontSize: '0.8rem',
          }}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <b>{f.descripcion}</b>
              <span style={{ color: '#f87171', marginLeft: 6, fontSize: '0.72rem' }}>{fechaHora(f.actualizado_at)}</span>
              <div style={{ color: '#fca5a5', fontSize: '0.75rem', overflowWrap: 'anywhere' }}>{f.motivo || 'Sin detalle'}</div>
              {errores[f.script] && <div style={{ color: '#fde047', fontSize: '0.75rem' }}>⚠️ {errores[f.script]}</div>}
            </div>
            {!f.lanzable ? (
              <span style={{ color: '#f87171', fontSize: '0.72rem' }}>se lanza desde su pantalla</span>
            ) : l ? (
              <span style={{ color: '#fcd34d', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                ⏳ Corriendo… (lanzado {hora(l.at)})
                {Date.now() - new Date(l.at).getTime() > 30 * 60_000 && (
                  <button style={{ ...btn, marginLeft: 8 }} disabled={enviando === f.script} onClick={() => lanzar(f)}>↻ Relanzar</button>
                )}
              </span>
            ) : (
              <button style={btn} disabled={enviando === f.script} onClick={() => lanzar(f)}>
                {enviando === f.script ? 'Lanzando…' : '▶ Lanzar ahora'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

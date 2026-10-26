// src/components/AlertasJubilacionBloqueo.tsx
// Modal que tapa toda la app mientras haya alertas bloqueantes activas:
//   · jubilación (las genera el trámite jubilatorio: "Jubilación · ...")
//   · errores de datos de los robots ("Error de carga · <robot>": agente sin servicio, localidad,
//     no está en SIAPE…; las arma services/alertasCargaRobots.ts y se cierran solas si el error se resuelve)
// No tiene X: sólo se sale desactivando cada alerta, y el back guarda qué usuario lo hizo.

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';

interface AlertaBloqueante {
  id:            number;
  dni:           number;
  titulo:        string;
  mensaje:       string;
  urgente:       number;
  created_at:    string;
  agente_nombre: string | null;
}

function fmt(dt?: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AlertasJubilacionBloqueo() {
  const [alertas, setAlertas] = useState<AlertaBloqueante[]>([]);
  const [desactivando, setDesactivando] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch<any>('/alertas-agente/bloqueantes');
        if (alive) setAlertas(Array.isArray(res?.data) ? res.data : []);
      } catch {
        if (alive) setAlertas([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const desactivar = async (a: AlertaBloqueante) => {
    const quien = a.agente_nombre || `DNI ${a.dni}`;
    if (!window.confirm(`¿Desactivar la alerta "${a.titulo}" de ${quien}?\nQueda registrado tu usuario.`)) return;
    setDesactivando(a.id);
    try {
      await apiFetch(`/alertas-agente/${a.id}`, { method: 'DELETE' });
      setAlertas(prev => prev.filter(x => x.id !== a.id));
    } catch {
      window.alert('No se pudo desactivar la alerta.');
    } finally {
      setDesactivando(null);
    }
  };

  if (!alertas.length) return null;

  const esCarga = (a: AlertaBloqueante) => a.titulo.startsWith('Error de carga');
  const hayCarga = alertas.some(esCarga);
  // primero jubilación, después errores de carga (agrupados por robot)
  const alertasOrdenadas = [...alertas].sort((x, y) =>
    Number(esCarga(x)) - Number(esCarga(y)) || (esCarga(x) ? x.titulo.localeCompare(y.titulo, 'es') : 0));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(2,6,23,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div role="alertdialog" aria-modal="true" style={{
        width: '100%', maxWidth: 860, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        background: '#1a0b0b',
        border: '2px solid rgba(220,38,38,0.7)',
        borderLeft: '6px solid #dc2626',
        borderRadius: 12,
        padding: '18px 20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f87171', marginBottom: 4 }}>
          ! Alertas pendientes: {alertas.length}
        </div>
        <div style={{ fontSize: '0.82rem', color: '#fca5a5', marginBottom: 12 }}>
          No se puede usar el sistema hasta desactivar estas alertas. Queda registrado qué usuario desactiva cada una.
          {hayCarga && ' Los errores de carga se cierran solos cuando el robot vuelve a intentar y carga bien.'}
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
          {alertasOrdenadas.map((a, i) => (
            <React.Fragment key={a.id}>
            {(i === 0 || esCarga(alertasOrdenadas[i - 1]) !== esCarga(a)) && (
              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#fca5a5', margin: '6px 0 2px' }}>
                {esCarga(a) ? 'Errores de carga de los robots: hay que corregir el dato del agente' : 'Jubilación'}
              </div>
            )}
            <div style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px',
            }}>
              <span style={{
                background: a.urgente ? '#8b0000' : 'rgba(180,83,9,0.25)',
                color: a.urgente ? '#fff' : '#fbbf24',
                borderRadius: 6, padding: '1px 7px', fontSize: '0.68rem', fontWeight: 800,
              }}>
                {a.urgente ? 'URGENTE' : 'ALERTA'}
              </span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: '0.86rem' }}>
                  <span style={{ fontWeight: 700 }}>{a.agente_nombre || `DNI ${a.dni}`}</span>
                  <span className="muted"> - </span>
                  <span style={{ color: '#fecaca' }}>{a.titulo}</span>
                </div>
                <div className="muted" style={{ fontSize: '0.76rem' }}>
                  {a.mensaje} · {fmt(a.created_at)}
                </div>
              </div>
              <button
                onClick={() => desactivar(a)}
                disabled={desactivando === a.id}
                style={{
                  background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 6,
                  padding: '6px 14px', fontSize: '0.78rem', fontWeight: 700,
                  cursor: desactivando === a.id ? 'wait' : 'pointer', flexShrink: 0,
                }}
              >
                {desactivando === a.id ? 'Desactivando…' : 'Desactivar'}
              </button>
            </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

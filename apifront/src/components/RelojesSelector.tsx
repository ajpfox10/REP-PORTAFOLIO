// src/components/RelojesSelector.tsx
// Casillas con los relojes activos (GET /mensajes-reloj/relojes) para elegir a cuáles va un mensaje.
// Arranca con todos tildados. Lo usan Gestión (mensaje a un agente) y la página Mensajes al reloj.
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';

export type RelojOpcion = { sn: string; alias: string; modelo: string | null; ip: string | null; ultima: string | null };

interface Props {
  value: string[];
  onChange: (sns: string[]) => void;
}

export function RelojesSelector({ value, onChange }: Props) {
  const [relojes, setRelojes] = useState<RelojOpcion[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<{ ok: boolean; data: RelojOpcion[]; error?: string }>('/mensajes-reloj/relojes')
      .then(res => {
        const lista = res.data || [];
        setRelojes(lista);
        onChange(lista.map(r => r.sn));
      })
      .catch(e => setError(e?.message || 'No se pudieron leer los relojes'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elegidos = new Set(value);
  const alternar = (sn: string) => onChange(elegidos.has(sn) ? value.filter(s => s !== sn) : [...value, sn]);

  return (
    <div>
      <div className="row gp-row-between-center">
        <div className="muted">Relojes ({value.length} de {relojes.length})</div>
        <div className="row gp-row-wrap" style={{ gap: 6 }}>
          <button className="btn" type="button" onClick={() => onChange(relojes.map(r => r.sn))}>Todos</button>
          <button className="btn" type="button" onClick={() => onChange([])}>Ninguno</button>
        </div>
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: '0.8rem', marginTop: 4 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6, marginTop: 6 }}>
        {relojes.map(r => (
          <label key={r.sn} title={`${r.sn}${r.ip ? ` · ${r.ip}` : ''}${r.ultima ? ` · última conexión ${r.ultima}` : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 10, cursor: 'pointer', fontSize: '0.8rem',
              border: `1px solid ${elegidos.has(r.sn) ? 'rgba(20,184,166,0.6)' : 'rgba(255,255,255,0.12)'}`,
              background: elegidos.has(r.sn) ? 'rgba(20,184,166,0.12)' : 'rgba(255,255,255,0.04)',
            }}>
            <input type="checkbox" checked={elegidos.has(r.sn)} onChange={() => alternar(r.sn)} />
            <span>
              <b>{r.alias}</b>
              {r.modelo && <span className="muted"> · {r.modelo}</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Marca "servicio controlado" (los cálculos de su gente se revisaron). La pone
// admin desde la pestaña Percentil de Herramientas; se ve con un ✔ y tooltip
// ahí y en la página de estadística de jubilables (Dirección / Docencia).
import React, { useState } from 'react';

export interface ControlServicio {
  servicio_id: number;
  nota: string | null;
  por: string | null;
  en: string; // 'YYYY-MM-DD HH:MM:SS'
}

const fmtFechaHora = (v: string) => {
  const [f] = v.split(' ');
  const [y, m, d] = f.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

// Mapa servicio_id → control vigente.
export const indexarControles = (lista: ControlServicio[] | undefined | null) =>
  new Map((lista ?? []).map(c => [String(c.servicio_id), c]));

// `ultimoCambio`: último cálculo guardado / ficha ANSES de alguien del servicio.
// Si es posterior al control, el tooltip lo avisa (el control no se cae solo).
export function BadgeControlado({ control, ultimoCambio }: {
  control: ControlServicio | undefined;
  ultimoCambio?: string | null;
}) {
  // Posición fija: las tablas con scroll horizontal recortarían un absolute.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!control) return null;
  const cambio = !!ultimoCambio && ultimoCambio > control.en;
  return (
    <span
      onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setPos({ x: r.left + r.width / 2, y: r.top }); }}
      onMouseLeave={() => setPos(null)}
      style={{ position: 'relative', display: 'inline-flex', marginLeft: 6, cursor: 'help', verticalAlign: 'middle' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, borderRadius: 999, fontSize: '0.7rem', fontWeight: 800,
        background: cambio ? 'rgba(251,191,36,0.18)' : 'rgba(34,197,94,0.18)',
        color: cambio ? '#fbbf24' : '#86efac',
        border: `1px solid ${cambio ? 'rgba(251,191,36,0.5)' : 'rgba(134,239,172,0.5)'}`,
      }}>✔</span>
      {pos && (
        <span style={{
          position: 'fixed', top: pos.y - 6, left: Math.min(Math.max(pos.x, 140), window.innerWidth - 140),
          transform: 'translate(-50%, -100%)', pointerEvents: 'none',
          background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
          padding: '8px 10px', fontSize: '0.74rem', color: '#e2e8f0', width: 260, zIndex: 1000,
          boxShadow: '0 6px 18px rgba(0,0,0,0.45)', fontWeight: 400, whiteSpace: 'normal', textAlign: 'left',
          lineHeight: 1.45,
        }}>
          <b style={{ color: '#86efac' }}>Servicio controlado</b>
          <div>por {control.por ?? '—'} el {fmtFechaHora(control.en)}</div>
          {control.nota && <div style={{ color: '#cbd5e1', marginTop: 2 }}>«{control.nota}»</div>}
          {cambio && (
            <div style={{ color: '#fbbf24', marginTop: 4 }}>
              ⚠️ Hubo cambios después del control (último: {fmtFechaHora(ultimoCambio!)})
            </div>
          )}
        </span>
      )}
    </span>
  );
}

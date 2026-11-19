// src/pages/AusentesSeguidosPage/AusentesSeguidosBanner.tsx
// Banner del Dashboard (solo admin): agentes con 3 o más ausentes seguidos en días que les tocaba venir
// (últimos 60 días). La lista se ve directamente, como el de cumpleaños; "Ver todos" abre la página.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cargarSeguidos, resumenRacha, avisoLegible, type AgenteSeguido } from './shared';

export function AusentesSeguidosBanner() {
  const [rows, setRows] = useState<AgenteSeguido[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let vivo = true;
    cargarSeguidos().then(r => { if (vivo) setRows(r.agentes); }).catch(() => { if (vivo) setRows([]); });
    return () => { vivo = false; };
  }, []);

  if (dismissed || rows.length === 0) return null;
  const mostradas = rows.slice(0, 6);
  const restantes = rows.length - mostradas.length;

  return (
    <div style={{
      margin: '0 0 16px 0', padding: '14px 16px', background: 'rgba(249,115,22,0.12)',
      border: '2px solid rgba(249,115,22,0.42)', borderLeft: '5px solid #f97316', borderRadius: 12,
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>🚫</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: '#fdba74', marginBottom: 6 }}>
          Ausentes 3 o más días seguidos (últimos 60 días): {rows.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {mostradas.map(a => {
            const r = a.rachas.reduce((m, x) => (x.seguidos > m.seguidos ? x : m), a.rachas[0]);
            return (
              <div key={a.dni} style={{ fontSize: '0.82rem', lineHeight: 1.45 }}>
                <span style={{ fontWeight: 800 }}>{a.nombre}</span>
                <span className="muted"> · DNI {a.dni}{a.servicio ? ` · ${a.servicio}` : ''}{a.ley ? ` · ${a.ley}` : ''}</span>
                <span style={{ fontWeight: 800, color: '#fdba74' }}> · {r.seguidos} seguidos</span>
                <span style={{ color: '#fed7aa' }}> · {resumenRacha(r.dias)}</span>
                {a.rachas.length > 1 && <span className="muted"> · {a.rachas.length} rachas</span>}
                {a.avisos.length > 0 && (
                  <span style={{ color: '#fca5a5', fontWeight: 700 }} title={a.avisos.map(avisoLegible).join('\n')}>
                    {' '}· ⚠️ {avisoLegible(a.avisos[0])}{a.avisos.length > 1 ? ` (+${a.avisos.length - 1})` : ''}
                  </span>
                )}
              </div>
            );
          })}
          {restantes > 0 && <div style={{ fontSize: '0.78rem', color: '#fed7aa' }}>+{restantes} más.</div>}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#fed7aa' }}>
          <Link to="/app/ausentes-seguidos" style={{ color: '#fdba74', fontWeight: 800 }}>Ver todos con el detalle día por día</Link>
          {' '}· solo cuentan los días que le tocaba venir; los que no le tocan no cortan la racha.
        </div>
      </div>
      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.55)', fontSize: '1.1rem', padding: 0 }}
        onClick={() => setDismissed(true)} title="Cerrar">x</button>
    </div>
  );
}

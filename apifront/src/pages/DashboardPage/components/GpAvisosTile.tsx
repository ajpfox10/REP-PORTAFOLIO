// Tarjeta de Herramientas (dashboard): avisos por WhatsApp a los agentes que el robot
// "intranet_gp_confirmar" confirmó en Gestiones Personales. Cantidades, quiénes faltan, últimos
// movimientos (con el usuario que los hizo) y repetidos. Todo el trabajo y el historial completo
// están en /app/gestiones-personales-avisos. Backend: GET /gp-avisos/resumen (mig 127 + 128).
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../../api/http';

interface Fila { id: number; dni: number; agente: string | null; estado: string; detalle: string | null }
interface Mov extends Fila { usuario_email: string | null; at: string }
interface Resumen {
  pendientes: number; escritos: number; enviados: number; enviados_hoy: number; omitidos: number;
  con_error: number; sin_whatsapp: number;
  robot: { estado: string; motivo: string | null; at: string } | null;
  faltan: Fila[]; ultimos: Mov[];
  repetidos: { dni: number; agente: string | null; n: number; enviados: number }[];
}

const COLOR: Record<string, string> = { PENDIENTE: '#fbbf24', ESCRITO: '#60a5fa', ENVIADO: '#4ade80', OMITIDO: '#94a3b8', ERROR: '#f87171' };
const TXT: Record<string, string> = { PENDIENTE: 'Para avisar', ESCRITO: 'Escrito', ENVIADO: 'Enviado', OMITIDO: 'Omitido', ERROR: 'Error' };
const fh = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
const quien = (e: string | null) => (e ? e.split('@')[0] : 'sistema');
const nom = (a: string | null) => (a || '').split(',')[0] || '¿?';

const NUM: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 74, padding: '4px 8px', borderRadius: 8, background: 'rgba(15,23,42,0.45)' };
const LISTA: CSSProperties = { margin: 0, padding: 0, listStyle: 'none', fontSize: '0.76rem', lineHeight: 1.55, maxHeight: 170, overflowY: 'auto' };

export function GpAvisosTile() {
  const [r, setR] = useState<Resumen | null>(null);
  const cargar = useCallback(async () => {
    try { const x = await apiFetch<any>('/gp-avisos/resumen'); if (x?.ok) setR(x); } catch { /* sin permiso o API vieja */ }
  }, []);
  useEffect(() => { void cargar(); const t = setInterval(cargar, 2 * 60 * 1000); return () => clearInterval(t); }, [cargar]);
  if (!r) return null;

  const estadoDe = (f: Fila) => (f.estado === 'PENDIENTE' && f.detalle ? 'ERROR' : f.estado);
  const num = (n: number, txt: string, color: string) => (
    <div style={NUM}><b style={{ fontSize: '1.15rem', color }}>{n}</b><span style={{ fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center' }}>{txt}</span></div>
  );

  return (
    <div className="tile" style={{ gridColumn: '1 / -1', borderLeftColor: '#22c55e', borderLeftWidth: 3, cursor: 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>📲 Avisos de Gestiones Personales</h3>
        {r.robot?.estado === 'error' && <span style={{ color: '#f87171', fontSize: '0.75rem' }}>🤖 el robot falló en su última corrida</span>}
        <span style={{ flex: 1 }} />
        <Link to="/app/gestiones-personales-avisos" style={{ color: '#86efac', fontWeight: 700, fontSize: '0.8rem' }}>Abrir · historial completo →</Link>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        {num(r.pendientes - r.con_error, 'para avisar', COLOR.PENDIENTE)}
        {num(r.escritos, 'escritos sin enviar', COLOR.ESCRITO)}
        {num(r.enviados_hoy, 'enviados hoy', COLOR.ENVIADO)}
        {num(r.enviados, 'enviados en total', COLOR.ENVIADO)}
        {num(r.sin_whatsapp, 'sin WhatsApp', COLOR.ERROR)}
        {r.con_error - r.sin_whatsapp > 0 && num(r.con_error - r.sin_whatsapp, 'otro error', COLOR.ERROR)}
        {r.omitidos > 0 && num(r.omitidos, 'omitidos', COLOR.OMITIDO)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Falta avisar ({r.faltan.length})</div>
          {r.faltan.length ? (
            <ul style={LISTA}>
              {r.faltan.map(f => {
                const e = estadoDe(f);
                return (
                  <li key={f.id} title={f.detalle || ''}>
                    <span style={{ color: COLOR[e] }}>● {TXT[e]}</span> {f.agente} <span style={{ color: '#64748b' }}>{f.dni}</span>
                  </li>
                );
              })}
            </ul>
          ) : <div style={{ fontSize: '0.76rem', color: '#4ade80' }}>✓ No falta nadie</div>}
        </div>

        <div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Últimos movimientos</div>
          {r.ultimos.length ? (
            <ul style={LISTA}>
              {r.ultimos.map(m => (
                <li key={m.id} title={m.detalle || ''}>
                  <span style={{ color: '#64748b' }}>{fh(m.at)}</span> {nom(m.agente)} → <span style={{ color: COLOR[m.estado] || '#e2e8f0' }}>{TXT[m.estado] || m.estado}</span>
                  <span style={{ color: '#64748b' }}> ({quien(m.usuario_email)})</span>
                </li>
              ))}
            </ul>
          ) : <div style={{ fontSize: '0.76rem', color: '#64748b' }}>Todavía no hay movimientos.</div>}
        </div>
      </div>

      {r.repetidos.length > 0 && (
        <div style={{ marginTop: 8, fontSize: '0.76rem', color: '#fbbf24' }}>
          ⚠️ Confirmados más de una vez (omití los de más para no mandarles dos veces):{' '}
          {r.repetidos.map(x => `${nom(x.agente)} ×${x.n}${x.enviados ? ' (ya enviado)' : ''}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

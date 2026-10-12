// src/pages/BecariosArtPage/BajasArtTab.tsx
// Pestaña "Bajas en ART" de Carga de ART. Lee art_baja_queue: un trigger encola el DNI cuando un
// tramo de agentes pasa a BAJA, y el robot "Baja de trabajadores en ART" (página Robots,
// scripts/art_baja_trabajador.mjs) le pone F. Egreso Empresa en ProvinciART.
// - Sigue activo: el DNI tiene otro tramo vigente (cambio de ocupación, etc.) → no se da de baja.
// - Reintentar: vuelve a PENDING para la próxima corrida del robot.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

interface FilaBaja {
  id: number;
  dni: number;
  status: string;
  resultado: string | null;
  fecha_baja_art: string | null;
  fecha_egreso: string | null;
  trabajador_id: number | null;
  attempts: number;
  last_error: string | null;
  created_at: string | null;
  finished_at: string | null;
  apellido: string | null;
  nombre: string | null;
  cuil: string | null;
}

const ESTADOS: Array<[string, string, string, string]> = [
  // clave (status o resultado), etiqueta, fondo, color
  ['BAJA_OK',      'Dado de baja',     'rgba(34,197,94,0.15)',   '#4ade80'],
  ['NO_EN_ART',    'No estaba en ART', 'rgba(34,197,94,0.08)',   '#86efac'],
  ['SIGUE_ACTIVO', 'Sigue activo',     'rgba(148,163,184,0.15)', '#cbd5e1'],
  ['PENDING',      'Pendiente',        'rgba(59,130,246,0.15)',  '#93c5fd'],
  ['PROCESSING',   'Procesando',       'rgba(245,158,11,0.15)',  '#fbbf24'],
  ['ERROR',        'Error',            'rgba(239,68,68,0.15)',   '#f87171'],
];
const claveDe = (f: FilaBaja) => (f.status === 'DONE' || f.status === 'SKIPPED') ? (f.resultado || f.status) : f.status;
const estiloEstado = (e: string) => ESTADOS.find(x => x[0] === e) ?? [e, e, 'rgba(255,255,255,0.06)', '#cbd5e1'];

const S = {
  panel: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 16 },
  th: { padding: '5px 8px', textAlign: 'left' as const, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' as const, color: '#94a3b8', whiteSpace: 'nowrap' as const, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { padding: '6px 8px', fontSize: '0.78rem', verticalAlign: 'top' as const, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  btn: { cursor: 'pointer', borderRadius: 6, padding: '4px 10px', fontWeight: 600, fontSize: '0.74rem', border: 'none' },
  input: { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 10px', fontSize: '0.84rem', minWidth: 240 },
};

function fmt(dt?: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtFecha(d?: string | null) {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

export function BajasArtTab() {
  const toast = useToast();
  const [filas, setFilas] = useState<FilaBaja[]>([]);
  const [resumen, setResumen] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState<string>('todos');
  const [texto, setTexto] = useState('');
  const [enCurso, setEnCurso] = useState<Record<number, boolean>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch<any>('/becarios-art/bajas');
      if (r?.ok) { setFilas(r.data ?? []); setResumen(r.resumen ?? {}); }
      else toast.error('No se pudo leer la cola de bajas', r?.error);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setCargando(false);
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return filas.filter(f => {
      if (filtro !== 'todos' && claveDe(f) !== filtro) return false;
      if (!t) return true;
      return `${f.apellido ?? ''} ${f.nombre ?? ''}`.toLowerCase().includes(t) || String(f.dni).includes(t) || (f.cuil ?? '').includes(t);
    });
  }, [filas, filtro, texto]);

  async function reintentar(dni: number) {
    setEnCurso(p => ({ ...p, [dni]: true }));
    try {
      const r = await apiFetch<any>(`/becarios-art/bajas/${dni}/reintentar`, { method: 'POST', body: JSON.stringify({}) });
      if (r?.ok) { toast.ok('Marcado para la próxima corrida'); cargar(); }
      else toast.error(r?.error ?? 'No se pudo');
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setEnCurso(p => ({ ...p, [dni]: false }));
    }
  }

  return (
    <div style={S.panel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>Bajas en ART</div>
          <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
            Cuando un agente pasa a BAJA queda en esta lista y el robot "Baja de trabajadores en ART" (página Robots)
            le carga la F. de Egreso en ProvinciART. Si el agente sigue con otro tramo vigente no se da de baja.
          </div>
        </div>
        <button style={{ ...S.btn, background: '#334155', color: '#94a3b8' }} onClick={cargar} disabled={cargando} title="Recargar">
          {cargando ? '…' : '↺'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 }}>
        {[['todos', 'Todos', 'rgba(255,255,255,0.06)', '#e2e8f0', filas.length] as const,
          ...ESTADOS.map(([e, l, bg, c]) => [e, l, bg, c, resumen[e] ?? 0] as const)]
          .map(([key, label, bg, color, n]) => (
            <button key={key} onClick={() => setFiltro(key)}
              style={{ ...S.btn, background: bg, color, padding: '6px 12px',
                outline: filtro === key ? `2px solid ${color}` : 'none' }}>
              {label}: <strong>{n}</strong>
            </button>
          ))}
        <input style={{ ...S.input, marginLeft: 'auto' }} placeholder="Buscar apellido, DNI o CUIL…"
          value={texto} onChange={e => setTexto(e.target.value)} />
      </div>

      {!filas.length && !cargando && (
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem', padding: '18px 0', textAlign: 'center' as const }}>
          No hay bajas en la cola.
        </div>
      )}

      {filas.length > 0 && (
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
            <thead>
              <tr>
                <th style={S.th}>Apellido y nombre</th>
                <th style={S.th}>DNI</th>
                <th style={S.th}>CUIL</th>
                <th style={S.th}>Estado</th>
                <th style={S.th}>Egreso (base)</th>
                <th style={S.th}>Egreso cargado en ART</th>
                <th style={S.th}>Detalle</th>
                <th style={S.th}>Intentos</th>
                <th style={S.th}>Encolado</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {visibles.slice(0, 500).map(f => {
                const [, label, bg, color] = estiloEstado(claveDe(f));
                return (
                  <tr key={f.id}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{f.apellido ? `${f.apellido}, ${f.nombre ?? ''}` : '—'}</td>
                    <td style={S.td}>{f.dni}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' as const }}>{f.cuil ?? '—'}</td>
                    <td style={S.td}>
                      <span style={{ borderRadius: 4, padding: '2px 7px', fontSize: '0.7rem', fontWeight: 700, background: bg, color }}>{label}</span>
                    </td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' as const }}>{fmtFecha(f.fecha_egreso)}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' as const }}>{fmtFecha(f.fecha_baja_art)}</td>
                    <td style={{ ...S.td, fontSize: '0.72rem', color: f.status === 'ERROR' ? '#fca5a5' : 'rgba(255,255,255,0.45)', maxWidth: 360 }}>{f.last_error ?? '—'}</td>
                    <td style={{ ...S.td, textAlign: 'center' as const, color: f.attempts >= 3 ? '#f87171' : undefined }}>{f.attempts}</td>
                    <td style={{ ...S.td, fontSize: '0.72rem', whiteSpace: 'nowrap' as const, color: 'rgba(255,255,255,0.4)' }}>{fmt(f.created_at)}</td>
                    <td style={{ ...S.td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }}>
                      {(f.status === 'ERROR' || f.resultado === 'SIGUE_ACTIVO') && (
                        <button style={{ ...S.btn, background: '#1d4ed8', color: '#fff' }} disabled={enCurso[f.dni]}
                          onClick={() => reintentar(f.dni)}>
                          {enCurso[f.dni] ? '…' : 'Reintentar'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibles.length > 500 && (
            <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
              Mostrando 500 de {visibles.length}: usá el buscador o los filtros.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

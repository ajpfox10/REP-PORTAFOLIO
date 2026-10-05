// src/pages/BecariosArtPage/EstablecimientoArtTab.tsx
// Pestaña "Establecimiento en ART" de Carga de ART: control de que cada agente esté SOLO en
// el establecimiento de Catán (488242). Lee art_control_establecimiento, que llena el robot
// scripts/art_editar_establecimiento.mjs (1 fila por DNI).
// - Reintentar: marca REINTENTAR; lo procesa el robot "Reintentar pasar a Catán" (página Robots).
// - No está en ART: lo manda a la cola de alta que ya existe (/becarios-art/errores/:dni/reintentar).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

interface FilaControl {
  dni: number;
  cuil: string;
  trabajador_id: number | null;
  establecimiento_destino: string;
  establecimientos_antes: string | null;
  accion: string | null;
  estado: string;
  detalle: string | null;
  intentos: number;
  ultimo_intento: string | null;
  apellido: string | null;
  nombre: string | null;
}

const ESTADOS: Array<[string, string, string, string]> = [
  // estado, etiqueta, fondo, color
  ['OK',         'Pasado a Catán',     'rgba(34,197,94,0.15)',   '#4ade80'],
  ['YA_OK',      'Ya estaba en Catán', 'rgba(34,197,94,0.08)',   '#86efac'],
  ['PARCIAL',    'Parcial (en 2)',     'rgba(245,158,11,0.15)',  '#fbbf24'],
  ['ERROR',      'Error',              'rgba(239,68,68,0.15)',   '#f87171'],
  ['REINTENTAR', 'Para reintentar',    'rgba(59,130,246,0.15)',  '#93c5fd'],
  ['NO_EN_ART',  'No está en ART',     'rgba(168,85,247,0.15)',  '#c4b5fd'],
];
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

export function EstablecimientoArtTab() {
  const toast = useToast();
  const [filas, setFilas] = useState<FilaControl[]>([]);
  const [resumen, setResumen] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState<string>('pendientes');
  const [texto, setTexto] = useState('');
  const [enCurso, setEnCurso] = useState<Record<number, boolean>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch<any>('/becarios-art/establecimiento');
      if (r?.ok) { setFilas(r.data ?? []); setResumen(r.resumen ?? {}); }
      else toast.error('No se pudo leer el control', r?.error);
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
      if (filtro === 'pendientes' && !['ERROR', 'PARCIAL', 'REINTENTAR', 'NO_EN_ART'].includes(f.estado)) return false;
      if (filtro !== 'pendientes' && filtro !== 'todos' && f.estado !== filtro) return false;
      if (!t) return true;
      return `${f.apellido ?? ''} ${f.nombre ?? ''}`.toLowerCase().includes(t) || String(f.dni).includes(t) || f.cuil.includes(t);
    });
  }, [filas, filtro, texto]);

  async function accion(dni: number, url: string, okMsg: string) {
    setEnCurso(p => ({ ...p, [dni]: true }));
    try {
      const r = await apiFetch<any>(url, { method: 'POST', body: JSON.stringify({}) });
      if (r?.ok) { toast.ok(okMsg); cargar(); }
      else toast.error(r?.error ?? 'No se pudo');
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setEnCurso(p => ({ ...p, [dni]: false }));
    }
  }

  const total = Object.values(resumen).reduce((a, b) => a + b, 0);
  const pendientes = (resumen.ERROR ?? 0) + (resumen.PARCIAL ?? 0) + (resumen.REINTENTAR ?? 0) + (resumen.NO_EN_ART ?? 0);

  return (
    <div style={S.panel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>Establecimiento en ART — todos en Catán (488242)</div>
          <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
            Resultado del robot que pasa a cada agente al establecimiento de Catán. Los errores y parciales
            (y los que marques con Reintentar) los vuelve a procesar el robot "Reintentar pasar a Catán" de la página Robots.
          </div>
        </div>
        <button style={{ ...S.btn, background: '#334155', color: '#94a3b8' }} onClick={cargar} disabled={cargando} title="Recargar">
          {cargando ? '…' : '↺'}
        </button>
      </div>

      {/* Resumen por estado (click = filtrar) */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 }}>
        {[['todos', `Todos`, 'rgba(255,255,255,0.06)', '#e2e8f0', total] as const,
          ['pendientes', 'A resolver', 'rgba(239,68,68,0.10)', '#fca5a5', pendientes] as const,
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
          Todavía no hay resultados: el robot "Pasar agentes a Catán en ART" no corrió con la versión que anota en la tabla.
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
                <th style={S.th}>Estaba en</th>
                <th style={S.th}>Detalle</th>
                <th style={S.th}>Intentos</th>
                <th style={S.th}>Último intento</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {visibles.slice(0, 500).map(f => {
                const [, label, bg, color] = estiloEstado(f.estado);
                return (
                  <tr key={f.dni}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{f.apellido ? `${f.apellido}, ${f.nombre ?? ''}` : '—'}</td>
                    <td style={S.td}>{f.dni}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' as const }}>{f.cuil}</td>
                    <td style={S.td}>
                      <span style={{ borderRadius: 4, padding: '2px 7px', fontSize: '0.7rem', fontWeight: 700, background: bg, color }}>{label}</span>
                    </td>
                    <td style={{ ...S.td, fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)', maxWidth: 320 }}>{f.establecimientos_antes ?? '—'}</td>
                    <td style={{ ...S.td, fontSize: '0.72rem', color: f.detalle ? '#fca5a5' : 'rgba(255,255,255,0.3)', maxWidth: 320 }}>{f.detalle ?? '—'}</td>
                    <td style={{ ...S.td, textAlign: 'center' as const, color: f.intentos >= 3 ? '#f87171' : undefined }}>{f.intentos}</td>
                    <td style={{ ...S.td, fontSize: '0.72rem', whiteSpace: 'nowrap' as const, color: 'rgba(255,255,255,0.4)' }}>{fmt(f.ultimo_intento)}</td>
                    <td style={{ ...S.td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }}>
                      {(f.estado === 'ERROR' || f.estado === 'PARCIAL') && (
                        <button style={{ ...S.btn, background: '#1d4ed8', color: '#fff' }} disabled={enCurso[f.dni]}
                          onClick={() => accion(f.dni, `/becarios-art/establecimiento/${f.dni}/reintentar`, 'Marcado para reintentar')}>
                          {enCurso[f.dni] ? '…' : 'Reintentar'}
                        </button>
                      )}
                      {f.estado === 'NO_EN_ART' && (
                        <button style={{ ...S.btn, background: '#7c3aed', color: '#fff' }} disabled={enCurso[f.dni]}
                          title="Lo manda a la cola de alta automática en ART"
                          onClick={() => accion(f.dni, `/becarios-art/errores/${f.dni}/reintentar`, 'Enviado a la cola de alta')}>
                          {enCurso[f.dni] ? '…' : 'Dar de alta'}
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

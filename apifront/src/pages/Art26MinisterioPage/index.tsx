// src/pages/Art26MinisterioPage/index.tsx
// Módulo "Art. 26 → Ministerio (FC)". Controla el Art.26 cargado por los jefes contra la
// Intranet MS y prepara el Excel que consume el robot scripts/cargar_art26_intranet.py.
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';

interface Art26Row {
  id: number;
  dni: string;
  nombre_full: string;
  fecha: string;
  dias: number;
  desde_ddmm: string;
  hasta_ddmm: string;
  motivo: string;
  observaciones: string;
  estado: string;          // estado del Art.26
  jefe_nombre: string;
  estado_ms: 'YA_EN_MS' | 'PENDIENTE' | 'CONFLICTO' | 'ERROR';
  detalle_ms: string;
}

interface ApiResult {
  ok: boolean;
  resumen: {
    total: number;
    pendiente: number;
    ya_en_ms: number;
    conflicto: number;
    error: number;
    por_estado_art26: Record<string, number>;
  };
  fuentes: { historial: string | null; log: string | null; export: string | null; dir: string };
  rows: Art26Row[];
  error?: string;
}

const BADGE_MS: Record<string, { label: string; color: string; bg: string }> = {
  PENDIENTE: { label: '● Pendiente', color: '#f59e0b', bg: 'rgba(245,158,11,0.06)' },
  YA_EN_MS:  { label: '✓ Ya en MS', color: '#22c55e', bg: 'transparent' },
  CONFLICTO: { label: '⚠ Conflicto', color: '#a78bfa', bg: 'rgba(167,139,250,0.06)' },
  ERROR:     { label: '✗ Error carga', color: '#ef4444', bg: 'rgba(239,68,68,0.06)' },
};

function mesStr(s: string) { return s?.length >= 7 ? s.slice(0, 7) : ''; }

export function Art26MinisterioPage() {
  const toast = useToast();
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [generando, setGenerando] = useState(false);

  const [fEstado, setFEstado] = useState('');   // estado_ms
  const [fMes, setFMes] = useState('');
  const [fTexto, setFTexto] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ApiResult>('/articulo-26-intranet/control');
      if (!res.ok) throw new Error(res.error || 'Error');
      setData(res);
    } catch (e: any) {
      toast.error('Error al cargar el control', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const generarExcel = async () => {
    setGenerando(true);
    try {
      const res = await apiFetch<any>('/articulo-26-intranet/generar-excel', { method: 'POST' });
      if (!res.ok) throw new Error(res.error || 'Error');
      toast.ok('Excel generado', `${res.filas} filas → ${res.path}`);
    } catch (e: any) {
      toast.error('No se pudo generar el Excel', e?.message || 'Error');
    } finally {
      setGenerando(false);
    }
  };

  const meses = useMemo(() => {
    const set = new Set<string>();
    (data?.rows || []).forEach(r => { const m = mesStr(r.fecha); if (m) set.add(m); });
    return Array.from(set).sort().reverse();
  }, [data]);

  const filtradas = useMemo(() => {
    let r = data?.rows || [];
    if (fEstado) r = r.filter(x => x.estado_ms === fEstado);
    if (fMes) r = r.filter(x => mesStr(x.fecha) === fMes);
    if (fTexto) {
      const t = fTexto.toLowerCase();
      r = r.filter(x => x.nombre_full.toLowerCase().includes(t) || String(x.dni).includes(t));
    }
    return r;
  }, [data, fEstado, fMes, fTexto]);

  const exportar = () => {
    exportToExcel('art26_ministerio', filtradas.map(r => ({
      DNI: r.dni, Agente: r.nombre_full, Fecha: r.fecha, Dias: r.dias,
      Desde: r.desde_ddmm, Hasta: r.hasta_ddmm, 'Estado Art.26': r.estado,
      'Estado MS': r.estado_ms, Detalle: r.detalle_ms, Motivo: r.motivo, Jefe: r.jefe_nombre,
    })));
  };

  const rs = data?.resumen;
  const card = (label: string, val: number | undefined, color: string) => (
    <div style={{ background: '#0f172a', border: `1px solid ${color}33`, borderRadius: 8, padding: '10px 14px', minWidth: 120 }}>
      <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{val ?? '—'}</div>
    </div>
  );

  return (
    <Layout title="Art. 26 → Ministerio (FC)">
      <div style={{ padding: '1rem 1.25rem', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.35rem' }}>📋 Artículo 26 → Ministerio (FC)</h1>
            <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: 4 }}>
              Control del Art. 26 cargado por los jefes y preparación de la carga como <b>FC / Franco Compensatorio</b> en la Intranet MS.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={cargar} disabled={loading}>{loading ? '⏳' : '🔄'} Actualizar</button>
            <button className="btn" onClick={exportar} disabled={!filtradas.length}>⬇️ Exportar vista</button>
            <button className="btn js-btn-save" onClick={generarExcel} disabled={generando}>
              {generando ? '⏳ Generando…' : '🤖 Generar Excel para el robot'}
            </button>
          </div>
        </div>

        {/* Resumen */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
          {card('Total', rs?.total, '#e2e8f0')}
          {card('Pendientes', rs?.pendiente, '#f59e0b')}
          {card('Ya en MS', rs?.ya_en_ms, '#22c55e')}
          {card('Conflicto', rs?.conflicto, '#a78bfa')}
          {card('Error carga', rs?.error, '#ef4444')}
        </div>

        {/* Fuentes */}
        {data?.fuentes && (
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: 12 }}>
            Carpeta: <code>{data.fuentes.dir}</code>{' · '}
            Historial MS: {data.fuentes.historial ? <span style={{ color: '#22c55e' }}>✓ {data.fuentes.historial}</span> : <span style={{ color: '#64748b' }}>no cargado (todo queda PENDIENTE)</span>}{' · '}
            Log robot: {data.fuentes.log ? <span style={{ color: '#22c55e' }}>✓ {data.fuentes.log}</span> : <span style={{ color: '#64748b' }}>sin log</span>}
          </div>
        )}

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <select className="input" value={fEstado} onChange={e => setFEstado(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Estado MS (todos)</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="YA_EN_MS">Ya en MS</option>
            <option value="CONFLICTO">Conflicto</option>
            <option value="ERROR">Error carga</option>
          </select>
          <select className="input" value={fMes} onChange={e => setFMes(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">Mes (todos)</option>
            {meses.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input className="input" placeholder="Buscar por nombre o DNI…" value={fTexto} onChange={e => setFTexto(e.target.value)} style={{ maxWidth: 260, flex: 1 }} />
          <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: '#94a3b8' }}>{filtradas.length} fila(s)</span>
        </div>

        {/* Tabla */}
        <div style={{ overflowX: 'auto', border: '1px solid #1e293b', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#0f172a', textAlign: 'left' }}>
                {['Estado MS', 'Agente', 'DNI', 'Desde', 'Hasta', 'Días', 'Estado Art.26', 'Detalle', 'Jefe'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.map(r => {
                const b = BADGE_MS[r.estado_ms];
                return (
                  <tr key={r.id} style={{ background: b?.bg, borderBottom: '1px solid #16202e' }}>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                      <span style={{ color: b?.color, fontWeight: 600 }}>{b?.label || r.estado_ms}</span>
                    </td>
                    <td style={{ padding: '7px 10px' }}>{r.nombre_full}</td>
                    <td style={{ padding: '7px 10px', color: '#94a3b8' }}>{r.dni}</td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{r.desde_ddmm}</td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{r.hasta_ddmm}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>{r.dias}</td>
                    <td style={{ padding: '7px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{r.estado}</td>
                    <td style={{ padding: '7px 10px', color: '#94a3b8', fontSize: '0.76rem' }}>{r.detalle_ms}</td>
                    <td style={{ padding: '7px 10px', color: '#64748b', fontSize: '0.76rem' }}>{r.jefe_nombre}</td>
                  </tr>
                );
              })}
              {!filtradas.length && (
                <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                  {loading ? 'Cargando…' : 'Sin registros para los filtros aplicados.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, fontSize: '0.76rem', color: '#64748b', lineHeight: 1.6 }}>
          <b>Flujo:</b> 1) «Generar Excel para el robot» deja <code>art26_export.xlsx</code> en la carpeta ART26.
          2) Se corre <code>python scripts/cargar_art26_intranet.py --pass CLAVE</code> (carga cada Art.26 como FC).
          3) El robot deja <code>resultado_carga_art26.xlsx</code>; al «Actualizar» acá se ve OK/error por fila.
          El control «Ya en MS / Conflicto» usa además <code>historial_intranet.xlsx</code> si está presente.
        </div>
      </div>
    </Layout>
  );
}

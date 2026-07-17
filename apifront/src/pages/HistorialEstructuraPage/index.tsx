// src/pages/HistorialEstructuraPage/index.tsx
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';

const DEPS = ['HOSPITAL', 'UPA 4', 'UPA 18'] as const;
type Dep = typeof DEPS[number];

const DEP_COLORS: Record<string, string> = {
  'HOSPITAL': '#60a5fa',
  'UPA 4':    '#34d399',
  'UPA 18':   '#f59e0b',
};

interface HistRow {
  dni: string;
  nombre: string;
  origen: string;
  legajo: string;
  apellido: string;
  parte: string;
  plantel: string;
  fecha_baja: string;
  cargo: string;
  estado: string;
  detalle: string;
}

const PAGE_SIZE = 50;

const toRow = (r: HistRow) => ({
  DNI: r.dni, Nombre: r.nombre, Origen: r.origen, Legajo: r.legajo,
  'Apellido y Nombre': r.apellido, Parte: r.parte, 'Plantel -> Serv.': r.plantel,
  'Fecha baja': r.fecha_baja, Cargo: r.cargo, Estado: r.estado, Detalle: r.detalle,
});

export function HistorialEstructuraPage() {
  const toast = useToast();
  const [dep, setDep]           = useState<Dep>('HOSPITAL');
  const [filas, setFilas]       = useState<HistRow[]>([]);
  const [existe, setExiste]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [lanzando, setLanzando] = useState(false);
  const [estado, setEstado]     = useState('todos');
  const [origen, setOrigen]     = useState('todos');
  const [texto, setTexto]       = useState('');
  const [page, setPage]         = useState(0);
  const firstLoad = useRef(false);

  const cargar = useCallback(async (d?: Dep) => {
    const key = d ?? dep;
    setLoading(true);
    try {
      const r = await apiFetch<{ ok: boolean; filas: HistRow[]; existe: boolean }>(
        `/intranet/historial-estructura/resultado?dep=${encodeURIComponent(key)}`
      );
      setFilas(r?.ok ? (r.filas ?? []) : []);
      setExiste(!!r?.existe);
    } catch {
      setFilas([]); setExiste(false);
    } finally {
      setLoading(false);
    }
  }, [dep]);

  useEffect(() => {
    if (!firstLoad.current) { firstLoad.current = true; cargar('HOSPITAL'); }
  }, []);

  useEffect(() => {
    if (firstLoad.current) { setPage(0); cargar(dep); }
  }, [dep]);

  async function lanzar() {
    setLanzando(true);
    try {
      const r = await apiFetch<{ ok: boolean; msg?: string; error?: string }>(
        '/intranet/historial-estructura/generar',
        { method: 'POST', body: JSON.stringify({ dependencia: dep }) }
      );
      if (r?.ok) toast.ok(r.msg ?? 'Script iniciado');
      else toast.error(r?.error ?? 'Error al iniciar');
    } catch (e: any) {
      toast.error(e?.message ?? 'Error');
    } finally {
      setLanzando(false);
    }
  }

  const resumen = useMemo(() => {
    const dnis   = new Set(filas.map(f => f.dni));
    const dnisOk = new Set(filas.filter(f => f.estado === 'OK').map(f => f.dni));
    const dnisErr = new Set(filas.filter(f => f.estado !== 'OK').map(f => f.dni));
    return { filas: filas.length, dnis: dnis.size, ok: dnisOk.size, error: dnisErr.size };
  }, [filas]);

  const filtradas = useMemo(() => {
    let r = filas;
    if (estado !== 'todos') r = r.filter(x => (estado === 'OK' ? x.estado === 'OK' : x.estado !== 'OK'));
    if (origen !== 'todos') r = r.filter(x => x.origen === origen);
    if (texto.trim()) {
      const t = texto.toLowerCase().trim();
      r = r.filter(x =>
        x.nombre.toLowerCase().includes(t) || x.dni.includes(t) ||
        x.apellido.toLowerCase().includes(t) || x.legajo.includes(t) ||
        x.parte.toLowerCase().includes(t)
      );
    }
    return r;
  }, [filas, estado, origen, texto]);

  const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const visibles   = filtradas.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <Layout title="Historial de Estructura" showBack>
      <strong>🗂 Historial de Estructura (Intranet Ministerio)</strong>
      <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 12 }}>
        Recorre los DNIs de personalv5 en Buscar Personal y descarga todas las filas del plantel ·
        activos por su dependencia, inactivos contra Hospital · salida en D:\G\HISTORIAL ESTRUCTURA
      </div>

      {/* Sub-tabs por dependencia */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {DEPS.map(d => {
          const color = DEP_COLORS[d] ?? '#94a3b8';
          return (
            <button key={d} onClick={() => { setDep(d); setEstado('todos'); setOrigen('todos'); setTexto(''); }}
              style={{
                padding: '5px 16px', fontSize: '0.78rem', fontWeight: dep === d ? 700 : 400,
                background: 'none', border: 'none', cursor: 'pointer',
                color: dep === d ? color : '#64748b',
                borderBottom: dep === d ? `2px solid ${color}` : '2px solid transparent',
                marginBottom: -1,
              }}>
              {d}
            </button>
          );
        })}
      </div>

      {/* Resumen */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {([
          ['Filas plantel', resumen.filas, '#60a5fa'],
          ['DNIs', resumen.dnis, '#818cf8'],
          ['DNIs OK', resumen.ok, '#22c55e'],
          ['DNIs con error', resumen.error, '#ef4444'],
        ] as [string, number, string][]).map(([label, val, color]) => (
          <div key={label} className="card" style={{ flex: '1 1 80px', textAlign: 'center', padding: '7px 10px' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{val}</div>
            <div className="muted" style={{ fontSize: '0.66rem' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Acciones + filtros */}
      <div className="card" style={{ marginBottom: 12, padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" onClick={lanzar} disabled={lanzando}
          style={{ background: '#16a34a', color: '#fff', fontSize: '0.76rem', whiteSpace: 'nowrap' }}>
          {lanzando ? '⏳...' : `▶ Generar y lanzar (${dep})`}
        </button>
        <button className="btn" onClick={() => cargar()} disabled={loading}
          style={{ fontSize: '0.76rem', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.07)' }}>
          {loading ? '⏳...' : '🔄 Actualizar resultado'}
        </button>

        <select className="input" value={estado} onChange={e => { setEstado(e.target.value); setPage(0); }}
          style={{ fontSize: '0.78rem', width: 130 }}>
          <option value="todos">Todos</option>
          <option value="OK">Solo OK</option>
          <option value="error">Solo errores</option>
        </select>

        <select className="input" value={origen} onChange={e => { setOrigen(e.target.value); setPage(0); }}
          style={{ fontSize: '0.78rem', width: 140 }}>
          <option value="todos">Activos e inactivos</option>
          <option value="ACTIVO">Activos</option>
          <option value="INACTIVO">Inactivos</option>
        </select>

        <input className="input" placeholder="Nombre, DNI, legajo o parte..."
          value={texto} onChange={e => { setTexto(e.target.value); setPage(0); }}
          style={{ fontSize: '0.78rem', flex: '1 1 140px', minWidth: 120 }} />

        <button className="btn" onClick={() => exportToExcel(`historial_estructura_${dep.replace(' ', '').toLowerCase()}`, filtradas.map(toRow))}
          disabled={!filtradas.length}
          style={{ background: 'rgba(255,255,255,0.07)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
          📥 Exportar ({filtradas.length})
        </button>
      </div>

      {!existe && !loading && (
        <div className="card muted" style={{ padding: 24, textAlign: 'center' }}>
          Todavía no hay resultado para {dep}. Generá y lanzá el script; la ventana CMD queda abierta en el servidor
          y podés ir actualizando acá para ver el avance.
        </div>
      )}

      {existe && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['Estado', 'Origen', 'DNI', 'Nombre', 'Legajo', 'Apellido y Nombre', 'Parte', 'Plantel → Serv.', 'Fecha baja', 'Cargo', 'Detalle'].map(c => (
                    <th key={c} style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.map((r, i) => (
                  <tr key={`${r.dni}-${i}`} style={{
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    background: r.estado !== 'OK' ? 'rgba(239,68,68,0.05)' : undefined,
                  }}>
                    <td style={{ padding: '5px 8px', color: r.estado === 'OK' ? '#22c55e' : '#ef4444', whiteSpace: 'nowrap' }}>
                      {r.estado === 'OK' ? '✓ OK' : '✗ Error'}
                    </td>
                    <td style={{ padding: '5px 8px', color: r.origen === 'ACTIVO' ? '#60a5fa' : '#94a3b8' }}>{r.origen}</td>
                    <td style={{ padding: '5px 8px' }}>{r.dni}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.nombre}</td>
                    <td style={{ padding: '5px 8px' }}>{r.legajo}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.apellido}</td>
                    <td style={{ padding: '5px 8px' }}>{r.parte}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.plantel}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.fecha_baja}</td>
                    <td style={{ padding: '5px 8px' }}>{r.cargo}</td>
                    <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.detalle}</td>
                  </tr>
                ))}
                {!visibles.length && (
                  <tr><td colSpan={11} className="muted" style={{ padding: 16, textAlign: 'center' }}>Sin filas con los filtros actuales</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
              <button className="btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}
                style={{ fontSize: '0.74rem', background: 'rgba(255,255,255,0.07)' }}>← Anterior</button>
              <span className="muted" style={{ fontSize: '0.74rem' }}>Página {safePage + 1} de {totalPages}</span>
              <button className="btn" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}
                style={{ fontSize: '0.74rem', background: 'rgba(255,255,255,0.07)' }}>Siguiente →</button>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}

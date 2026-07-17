// src/pages/ComparadorSiapePage/index.tsx
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';

const DEPS_RES = ['HOSPITAL', 'UPA 4', 'UPA 18'] as const;
type DepRes = typeof DEPS_RES[number];
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';

interface CompRow {
  legajo: string;
  dni: string;
  nombre: string;
  dependencia: string;
  ley: string;
  novedad_ministerio: string;
  fecha_desde_min: string;
  fecha_hasta_min: string;
  novedad_siap: string;
  fecha_desde_siap: string;
  fecha_hasta_siap: string;
  estado: 'COINCIDENTE' | 'NO COINCIDENTE' | 'RANGO_DISTINTO' | 'SOLO_SIAP';
  motivo: string;
}

function leyLabel(ley: string): string {
  const u = ley.toUpperCase();
  if (u.includes('BECARIO') || u.includes('BECA')) return 'BECARIO';
  return ley || '—';
}

interface ResultadoRow {
  nombre: string;
  dni: string;
  novedad: string;
  desde: string;
  hasta: string;
  estado: string;
  detalle: string;
  ley?: string;
}

interface ApiResult {
  ok: boolean;
  resumen: {
    total_ministerio: number;
    total_siap_con_novedad: number;
    coincidentes: number;
    rango_distinto: number;
    no_coincidentes: number;
    solo_siap: number;
  };
  archivos: { ministerio: string; siap: string };
  resultado: CompRow[];
  errores: CompRow[];
  cached?: boolean;
  error?: string;
}

const BADGE: Record<string, { label: string; color: string }> = {
  'COINCIDENTE':    { label: '✓ OK',         color: '#22c55e' },
  'RANGO_DISTINTO': { label: '⚠ Rango',      color: '#f59e0b' },
  'NO COINCIDENTE': { label: '✗ No coincide',color: '#ef4444' },
  'SOLO_SIAP':      { label: '↑ Solo SIAP',  color: '#a78bfa' },
};

const BADGE_RES: Record<string, { label: string; color: string }> = {
  'OK':         { label: '✓ OK',        color: '#22c55e' },
  'ERROR':      { label: '✗ Error',     color: '#ef4444' },
  'EXCEPCION':  { label: '⚠ Excepción', color: '#f59e0b' },
  'SIN_FECHA':  { label: '— Sin fecha', color: '#64748b' },
  'ERROR_NAV':  { label: '↯ Nav error', color: '#ef4444' },
};

const BG: Record<string, string> = {
  'NO COINCIDENTE': 'rgba(239,68,68,0.05)',
  'RANGO_DISTINTO': 'rgba(245,158,11,0.05)',
  'SOLO_SIAP':      'rgba(167,139,250,0.05)',
};

function mesStr(s: string) { return s?.length >= 7 ? s.slice(0, 7) : ''; }

function aplicarFiltros(rows: CompRow[], mes: string, texto: string, estado: string, dep: string, novedad: string) {
  let r = rows;
  if (mes) {
    r = r.filter(x =>
      mesStr(x.fecha_desde_min)  === mes ||
      mesStr(x.fecha_hasta_min)  === mes ||
      mesStr(x.fecha_desde_siap) === mes ||
      mesStr(x.fecha_hasta_siap) === mes
    );
  }
  if (estado && estado !== 'todos') r = r.filter(x => x.estado === estado);
  if (dep && dep !== 'todos') r = r.filter(x => x.dependencia === dep);
  if (novedad && novedad !== 'todas') {
    r = r.filter(x => x.novedad_ministerio === novedad || x.novedad_siap === novedad);
  }
  if (texto.trim()) {
    const t = texto.toLowerCase().trim();
    r = r.filter(x =>
      x.nombre.toLowerCase().includes(t) || x.dni.includes(t) || x.legajo.includes(t)
    );
  }
  return r;
}

const DEP_COLORS: Record<string, string> = {
  'HOSPITAL': '#60a5fa',
  'UPA 4':    '#34d399',
  'UPA 18':   '#f59e0b',
};

const COLS = ['Estado','Dep.','Ley','Legajo','DNI','Nombre','Nov. Ministerio','Desde Min.','Hasta Min.','Nov. SIAP','Desde SIAP','Hasta SIAP','Motivo'];

function Tabla({ rows }: { rows: CompRow[] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const visible    = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.06)' }}>
              {COLS.map(h => <th key={h} style={{ padding: '4px 6px', textAlign: 'left', color: '#94a3b8', fontSize: '0.64rem', whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {!visible.length
              ? <tr><td colSpan={COLS.length} style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>Sin resultados</td></tr>
              : visible.map((r, i) => {
                  const b = BADGE[r.estado] ?? { label: r.estado, color: '#94a3b8' };
                  const ll = leyLabel(r.ley ?? '');
                  const isBecario = ll === 'BECARIO';
                  const isNoAplica = r.motivo === 'BECARIO_NO_APLICA';
                  return (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: isNoAplica ? 'rgba(100,116,139,0.06)' : BG[r.estado] }}>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: isNoAplica ? '#64748b' : b.color, fontWeight: 600, fontSize: '0.64rem' }}>
                          {isNoAplica ? '— N/A' : b.label}
                        </span>
                      </td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: DEP_COLORS[r.dependencia] ?? '#94a3b8', fontWeight: 600, fontSize: '0.63rem' }}>{r.dependencia || '—'}</span>
                      </td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: isBecario ? '#f59e0b' : '#94a3b8', fontWeight: isBecario ? 700 : 400, fontSize: '0.63rem' }}>{ll}</span>
                      </td>
                      <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: '0.68rem', color: '#94a3b8' }}>{r.legajo || '—'}</td>
                      <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: '0.68rem', color: '#94a3b8' }}>{r.dni || '—'}</td>
                      <td style={{ padding: '3px 6px', fontWeight: 500, fontSize: '0.72rem' }}>{r.nombre}</td>
                      <td style={{ padding: '3px 6px', color: '#60a5fa', fontSize: '0.67rem' }}>{r.novedad_ministerio}</td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', fontSize: '0.66rem' }}>{r.fecha_desde_min}</td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', fontSize: '0.66rem' }}>{r.fecha_hasta_min}</td>
                      <td style={{ padding: '3px 6px', color: '#a3e635', fontSize: '0.67rem' }}>{r.novedad_siap}</td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', fontSize: '0.66rem' }}>{r.fecha_desde_siap}</td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', fontSize: '0.66rem' }}>{r.fecha_hasta_siap}</td>
                      <td style={{ padding: '3px 6px', fontSize: '0.62rem', color: isNoAplica ? '#f59e0b' : '#64748b' }}>{r.motivo}</td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.75rem' }}>
          <button className="btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
            style={{ padding: '3px 10px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.07)' }}>‹ Ant.</button>
          <span className="muted">Pág. {safePage + 1} / {totalPages} · {rows.length} registros</span>
          <button className="btn" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}
            style={{ padding: '3px 10px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.07)' }}>Sig. ›</button>
        </div>
      )}
    </div>
  );
}

const COLS_RES = ['Nombre','DNI','Ley','Novedad','Desde','Hasta','Estado','Detalle'];
const PAGE_SIZE = 50;

function TablaResultados({ rows }: { rows: ResultadoRow[] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const visible    = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.06)' }}>
              {COLS_RES.map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#94a3b8', fontSize: '0.69rem', whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {!visible.length
              ? <tr><td colSpan={COLS_RES.length} style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>Sin resultados</td></tr>
              : visible.map((r, i) => {
                  const b = BADGE_RES[r.estado] ?? { label: r.estado, color: '#94a3b8' };
                  const bg = r.estado === 'OK' ? 'rgba(34,197,94,0.04)' : r.estado.startsWith('ERROR') || r.estado === 'EXCEPCION' ? 'rgba(239,68,68,0.05)' : '';
                  return (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: bg }}>
                      <td style={{ padding: '4px 8px', fontWeight: 500 }}>{r.nombre}</td>
                      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '0.73rem', color: '#94a3b8' }}>{r.dni}</td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: leyLabel(r.ley ?? '') === 'BECARIO' ? '#f59e0b' : '#94a3b8', fontWeight: leyLabel(r.ley ?? '') === 'BECARIO' ? 700 : 400, fontSize: '0.68rem' }}>
                          {leyLabel(r.ley ?? '') || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '4px 8px', color: '#a78bfa', fontSize: '0.72rem' }}>{r.novedad}</td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', fontSize: '0.71rem' }}>{r.desde}</td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', fontSize: '0.71rem' }}>{r.hasta}</td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: b.color, fontWeight: 600, fontSize: '0.69rem' }}>{b.label}</span>
                      </td>
                      <td style={{ padding: '4px 8px', fontSize: '0.67rem', color: '#64748b' }}>{r.detalle}</td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.75rem' }}>
          <button className="btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
            style={{ padding: '3px 10px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.07)' }}>‹ Ant.</button>
          <span className="muted">Pág. {safePage + 1} / {totalPages} · {rows.length} registros</span>
          <button className="btn" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}
            style={{ padding: '3px 10px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.07)' }}>Sig. ›</button>
        </div>
      )}
    </div>
  );
}

const toRow = (r: CompRow) => ({
  Estado: r.estado, Dependencia: r.dependencia, Legajo: r.legajo, DNI: r.dni, Nombre: r.nombre,
  'Nov. Ministerio': r.novedad_ministerio,
  'Desde Min': r.fecha_desde_min, 'Hasta Min': r.fecha_hasta_min,
  'Nov. SIAP': r.novedad_siap,
  'Desde SIAP': r.fecha_desde_siap, 'Hasta SIAP': r.fecha_hasta_siap,
  Motivo: r.motivo,
});

// Clave para identificar una novedad ya procesada con OK
function resKey(dni: string, novedad: string, desde: string, hasta: string) {
  return `${dni}|${novedad}|${desde}|${hasta}`;
}

export function ComparadorSiapePage() {
  const toast = useToast();
  const [data, setData]       = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [mes, setMes]         = useState('');
  const [estado, setEstado]   = useState('todos');
  const [dep, setDep]         = useState('todos');
  const [novedad, setNovedad] = useState('todas');
  const [texto, setTexto]     = useState('');

  // Resultado de carga Ministerio
  const [depRes, setDepRes]             = useState<DepRes>('HOSPITAL');
  const [resultado, setResultado]       = useState<ResultadoRow[]>([]);
  const [loadingRes, setLoadingRes]     = useState(false);
  const [filtroRes, setFiltroRes]       = useState('no_ok');
  const [textoRes, setTextoRes]         = useState('');
  const [exportandoPend, setExportandoPend] = useState(false);
  const [tab, setTab] = useState<'comparacion' | 'resultados'>('comparacion');
  const [filtroDetalle, setFiltroDetalle] = useState('todos');
  const [cargando, setCargando]           = useState(false);
  const [segundaPasada, setSegundaPasada] = useState(false);
  const firstLoad = useRef(false);

  const cargarResultado = useCallback(async (dep?: DepRes) => {
    const d = dep ?? depRes;
    setLoadingRes(true);
    try {
      const r = await apiFetch<{ ok: boolean; filas: ResultadoRow[]; existe: boolean }>(
        `/intranet/resultado?dep=${encodeURIComponent(d)}`
      );
      if (r?.ok) setResultado(r.filas ?? []);
      else setResultado([]);
    } catch { setResultado([]); } finally {
      setLoadingRes(false);
    }
  }, [depRes]);

  useEffect(() => {
    if (!firstLoad.current) { firstLoad.current = true; cargarResultado('HOSPITAL'); }
  }, []);

  useEffect(() => {
    if (firstLoad.current) cargarResultado(depRes);
  }, [depRes]);

  async function lanzarScript(endpoint: string, body: object, setRunning: (v: boolean) => void) {
    setRunning(true);
    try {
      const r = await apiFetch<{ ok: boolean; msg?: string; error?: string }>(
        endpoint, { method: 'POST', body: JSON.stringify(body) }
      );
      if (r?.ok) toast.ok(r.msg ?? 'Script iniciado');
      else toast.error(r?.error ?? 'Error al iniciar');
    } catch (e: any) {
      toast.error(e?.message ?? 'Error');
    } finally {
      setRunning(false);
    }
  }

  // Set de claves ya OK en el resultado
  const okSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of resultado) {
      if (r.estado === 'OK') s.add(resKey(r.dni, r.novedad, r.desde, r.hasta));
    }
    return s;
  }, [resultado]);

  async function cargar(refresh = false) {
    setLoading(true);
    try {
      const r = await apiFetch<ApiResult>(`/comparacion-siape${refresh ? '?refresh=1' : ''}`);
      if (!r?.ok) throw new Error(r?.error ?? 'Error');
      setData(r);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  }

  const meses = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.resultado) {
      [r.fecha_desde_min, r.fecha_hasta_min, r.fecha_desde_siap, r.fecha_hasta_siap]
        .forEach(f => { const m = mesStr(f); if (m) s.add(m); });
    }
    return [...s].sort();
  }, [data]);

  const novedades = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.resultado) {
      [r.novedad_ministerio, r.novedad_siap]
        .forEach(n => { if (n && n !== 'â€"') s.add(n); });
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [data]);

  const completa = useMemo(
    () => aplicarFiltros(data?.resultado ?? [], mes, texto, estado, dep, novedad),
    [data, mes, texto, estado, dep, novedad]
  );

  // SOLO_SIAP pendientes = los que no tienen OK en resultado y no son BECARIO_NO_APLICA
  const pendientes = useMemo(() =>
    completa.filter(r =>
      r.estado === 'SOLO_SIAP' &&
      r.motivo !== 'BECARIO_NO_APLICA' &&
      !okSet.has(resKey(r.dni, r.novedad_siap, r.fecha_desde_siap, r.fecha_hasta_siap))
    ),
    [completa, okSet]
  );

  const res = useMemo(() => {
    if (!data) return null;
    return {
      total_ministerio:       completa.filter(r => r.estado !== 'SOLO_SIAP').length,
      total_siap_con_novedad: completa.filter(r => r.novedad_siap && r.novedad_siap !== '—').length,
      coincidentes:           completa.filter(r => r.estado === 'COINCIDENTE').length,
      rango_distinto:         completa.filter(r => r.estado === 'RANGO_DISTINTO').length,
      no_coincidentes:        completa.filter(r => r.estado === 'NO COINCIDENTE').length,
      solo_siap:              completa.filter(r => r.estado === 'SOLO_SIAP').length,
    };
  }, [completa, data]);

  // Resultado filtrado
  const resFiltrado = useMemo(() => {
    let r = resultado;
    if (filtroRes === 'no_ok') r = r.filter(x => x.estado !== 'OK');
    else if (filtroRes !== 'todos') r = r.filter(x => x.estado === filtroRes);
    if (filtroDetalle !== 'todos') r = r.filter(x => x.detalle === filtroDetalle);
    if (textoRes.trim()) {
      const t = textoRes.toLowerCase();
      r = r.filter(x => x.nombre.toLowerCase().includes(t) || x.dni.includes(t));
    }
    return r;
  }, [resultado, filtroRes, filtroDetalle, textoRes]);

  const detallesDisponibles = useMemo(() => {
    let base = resultado;
    if (filtroRes === 'no_ok') base = resultado.filter(x => x.estado !== 'OK');
    else if (filtroRes !== 'todos') base = resultado.filter(x => x.estado === filtroRes);
    return [...new Set(base.map(x => x.detalle).filter(Boolean))].sort();
  }, [resultado, filtroRes]);

  const resConteo = useMemo(() => ({
    ok:    resultado.filter(r => r.estado === 'OK').length,
    error: resultado.filter(r => r.estado !== 'OK').length,
  }), [resultado]);

  return (
    <Layout title="Comparador SIAPE vs Ministerio" showBack>
      <strong>📋 Comparador SIAPE vs Ministerio</strong>
      <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 12 }}>
        Cruza novedades SIAP contra Ministerio usando el mapeo de asistencia · join por DNI
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {([['comparacion', '📋 Comparación'], ['resultados', `📤 Resultados de carga${resultado.length > 0 ? ` (${resultado.length})` : ''}`]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '7px 18px', fontSize: '0.8rem', fontWeight: tab === key ? 700 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === key ? '#fff' : '#64748b',
              borderBottom: tab === key ? '2px solid #7c3aed' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'comparacion' && !data && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <button className="btn" onClick={() => cargar(false)}
            style={{ background: '#2563eb', color: '#fff', padding: '9px 24px' }}>
            Cargar y comparar
          </button>
        </div>
      )}

      {tab === 'comparacion' && loading && <div className="card muted" style={{ padding: 24, textAlign: 'center' }}>⏳ Leyendo archivos...</div>}

      {tab === 'comparacion' && data && !loading && (<>
        {/* Resumen */}
        {res && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {([
              ['Total Min.', res.total_ministerio,       '#60a5fa'],
              ['Total SIAP', res.total_siap_con_novedad, '#818cf8'],
              ['Coincidentes', res.coincidentes,         '#22c55e'],
              ['Rango dist.', res.rango_distinto,        '#f59e0b'],
              ['No coincid.', res.no_coincidentes,       '#ef4444'],
              ['Solo SIAP',   res.solo_siap,             '#a78bfa'],
            ] as [string,number,string][]).map(([label, val, color]) => (
              <div key={label} className="card" style={{ flex: '1 1 80px', textAlign: 'center', padding: '7px 10px' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{val}</div>
                <div className="muted" style={{ fontSize: '0.66rem' }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div className="card" style={{ marginBottom: 12, padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: '0.72rem', marginRight: 4 }}>
            {data.archivos?.ministerio} · {data.archivos?.siap}
            {data.cached && <span style={{ marginLeft: 4 }}>(caché)</span>}
          </span>

          <select className="input" value={mes} onChange={e => setMes(e.target.value)}
            style={{ fontSize: '0.78rem', width: 150 }}>
            <option value="">Todo el periodo</option>
            {meses.map(m => <option key={m} value={m}>Mes: {m}</option>)}
          </select>

          <select className="input" value={estado} onChange={e => setEstado(e.target.value)}
            style={{ fontSize: '0.78rem', width: 150 }}>
            <option value="todos">Todos los estados</option>
            <option value="COINCIDENTE">Coincidentes</option>
            <option value="RANGO_DISTINTO">Rango distinto</option>
            <option value="NO COINCIDENTE">No coincidentes</option>
            <option value="SOLO_SIAP">Solo en SIAP</option>
          </select>

          <select className="input" value={dep} onChange={e => setDep(e.target.value)}
            style={{ fontSize: '0.78rem', width: 120 }}>
            <option value="todos">Todas las dep.</option>
            <option value="HOSPITAL">Hospital</option>
            <option value="UPA 4">UPA 4</option>
            <option value="UPA 18">UPA 18</option>
          </select>

          <select className="input" value={novedad} onChange={e => setNovedad(e.target.value)}
            style={{ fontSize: '0.78rem', width: 210 }}>
            <option value="todas">Todas las novedades</option>
            {novedades.map(n => <option key={n} value={n}>{n}</option>)}
          </select>

          <input className="input" placeholder="Nombre, DNI o legajo..."
            value={texto} onChange={e => setTexto(e.target.value)}
            style={{ fontSize: '0.78rem', flex: '1 1 140px', minWidth: 120 }} />

          <button className="btn" onClick={() => cargar(true)}
            style={{ fontSize: '0.76rem', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.07)' }}>
            🔄 Recargar
          </button>
        </div>

        {/* Acciones exportar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
            Registros: <strong>{completa.length}</strong>
            {pendientes.length > 0 && (
              <span style={{ marginLeft: 10, color: '#a78bfa', fontSize: '0.78rem' }}>
                · <strong>{pendientes.length}</strong> pendientes de carga
              </span>
            )}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => exportToExcel('comparacion_siape', completa.map(toRow))}
              disabled={!completa.length}
              style={{ background: 'rgba(255,255,255,0.07)', fontSize: '0.75rem' }}>
              📥 Exportar todo ({completa.length})
            </button>
            <button className="btn"
              onClick={async () => {
                if (!pendientes.length) return;
                setExportandoPend(true);
                try {
                  const r = await apiFetch<{ ok: boolean; path?: string; error?: string }>(
                    '/intranet/exportar-pendientes',
                    { method: 'POST', body: JSON.stringify({ dependencia: dep, filas: pendientes.map(toRow) }) }
                  );
                  if (r?.ok) toast.ok(`Guardado en servidor (${pendientes.length} filas)`);
                  else toast.error(r?.error ?? 'Error al guardar');
                } catch (e: any) {
                  toast.error(e?.message ?? 'Error');
                } finally {
                  setExportandoPend(false);
                }
              }}
              disabled={!pendientes.length || exportandoPend}
              style={{ background: '#7c3aed', color: '#fff', fontSize: '0.75rem' }}>
              {exportandoPend ? '⏳ Guardando...' : `🚀 Exportar pendientes (${pendientes.length})`}
            </button>
            {(['HOSPITAL', 'UPA 4', 'UPA 18'] as const).map(d => (
              <button key={d} className="btn"
                onClick={() => lanzarScript('/intranet/cargar-novedades', { dependencia: d }, setCargando)}
                disabled={cargando}
                style={{ background: '#16a34a', color: '#fff', fontSize: '0.75rem' }}>
                {cargando ? '⏳...' : `▶ ${d}`}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
          <Tabla rows={completa} />
        </div>
      </>)}

      {/* ── Tab: Resultados de carga Ministerio ── */}
      {tab === 'resultados' && <div style={{ marginTop: 0 }}>

        {/* Sub-tabs por dependencia */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {DEPS_RES.map(d => {
            const color = DEP_COLORS[d] ?? '#94a3b8';
            return (
              <button key={d} onClick={() => { setDepRes(d); setFiltroRes('no_ok'); setFiltroDetalle('todos'); setTextoRes(''); }}
                style={{
                  padding: '5px 16px', fontSize: '0.78rem', fontWeight: depRes === d ? 700 : 400,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: depRes === d ? color : '#64748b',
                  borderBottom: depRes === d ? `2px solid ${color}` : '2px solid transparent',
                  marginBottom: -1,
                }}>
                {d}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
          <div>
            {resultado.length > 0 && (
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                <span style={{ color: '#22c55e' }}>✓ {resConteo.ok} OK</span>
                {' · '}
                <span style={{ color: '#ef4444' }}>✗ {resConteo.error} errores</span>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => cargarResultado()} disabled={loadingRes}
              style={{ fontSize: '0.73rem', background: 'rgba(255,255,255,0.07)' }}>
              🔄 {loadingRes ? 'Cargando...' : 'Actualizar'}
            </button>
            {resFiltrado.length > 0 && (
              <button className="btn"
                onClick={() => exportToExcel(`resultado_carga_${depRes.replace(' ', '')}`, resFiltrado.map(r => ({
                  Nombre: r.nombre, DNI: r.dni, Novedad: r.novedad,
                  Desde: r.desde, Hasta: r.hasta, Estado: r.estado, Detalle: r.detalle
                })))}
                style={{ fontSize: '0.73rem', background: '#16a34a', color: '#fff' }}>
                📥 Exportar ({resFiltrado.length})
              </button>
            )}
            {resFiltrado.some(r => r.estado !== 'OK') && (
              <button className="btn"
                onClick={() => {
                  const errores = resFiltrado
                    .filter(r => r.estado !== 'OK')
                    .map(r => ({ Nombre: r.nombre, DNI: r.dni, Novedad: r.novedad, Desde: r.desde, Hasta: r.hasta }));
                  lanzarScript('/intranet/segunda-pasada', { filas: errores, dependencia: depRes }, setSegundaPasada);
                }}
                disabled={segundaPasada}
                style={{ background: '#d97706', color: '#fff', fontSize: '0.73rem' }}>
                {segundaPasada ? '⏳...' : `🔁 Segunda pasada ${depRes}`}
              </button>
            )}
          </div>
        </div>

        {resultado.length === 0 && !loadingRes && (
          <div className="card muted" style={{ padding: 16, textAlign: 'center', fontSize: '0.8rem' }}>
            Sin datos — aún no se ejecutó la carga para {depRes} o no existe el archivo de resultados
          </div>
        )}

        {resultado.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <select className="input" value={filtroRes}
                onChange={e => { setFiltroRes(e.target.value); setFiltroDetalle('todos'); }}
                style={{ fontSize: '0.78rem', width: 160 }}>
                <option value="no_ok">Solo errores</option>
                <option value="todos">Todos los estados</option>
                <option value="OK">Solo OK</option>
                <option value="ERROR">Solo ERROR</option>
                <option value="EXCEPCION">Solo Excepción</option>
                <option value="ERROR_NAV">Solo Nav error</option>
              </select>
              <select className="input" value={filtroDetalle} onChange={e => setFiltroDetalle(e.target.value)}
                style={{ fontSize: '0.78rem', flex: '1 1 200px', minWidth: 160 }}>
                <option value="todos">Todos los motivos</option>
                {detallesDisponibles.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <input className="input" placeholder="Buscar nombre o DNI..."
                value={textoRes} onChange={e => setTextoRes(e.target.value)}
                style={{ fontSize: '0.78rem', flex: '1 1 180px', minWidth: 140 }} />
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <TablaResultados rows={resFiltrado} />
            </div>
          </>
        )}
      </div>}
    </Layout>
  );
}

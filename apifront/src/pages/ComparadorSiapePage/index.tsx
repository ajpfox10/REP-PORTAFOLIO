// src/pages/ComparadorSiapePage/index.tsx
// Versión 2.0: lee la última corrida del Comparador 2.0 (tablas comparacion_*) y el resultado
// de la carga (novedades_carga_intranet). Los botones lanzan los robots 2.0 por run_robot.py
// (quedan en la página Robots). La versión vieja (Excel + scripts sueltos) quedó SIN USO.
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';

const DEPS_RES = ['HOSPITAL', 'UPA 4', 'UPA 18'] as const;
type DepRes = typeof DEPS_RES[number];
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';
import { useAuth } from '../../auth/AuthProvider';
import { CargaSiapeContent } from '../CargaSiapePage';

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
  justificado_siap?: string;
  estado: 'COINCIDENTE' | 'NO COINCIDENTE' | 'RANGO_DISTINTO' | 'SOLO_SIAP';
  motivo: string;
  carga_estado?: string | null;   // estado en novedades_carga_intranet (solo filas SOLO_SIAP)
  carga_detalle?: string | null;
}

function leyLabel(ley: string): string {
  const u = ley.toUpperCase();
  if (u.includes('BECARIO') || u.includes('BECA')) return 'BECARIO';
  return ley || '—';
}

interface ResultadoRow {
  id: number;
  nombre: string;
  dni: string;
  novedad: string;        // novedad SIAPE (clave para cruzar con la comparación)
  label: string;          // opción de la Intranet con la que se cargó / intentó
  desde: string;
  hasta: string;
  estado: string;
  detalle: string;
  intentos: number;
  corrida_id: number | null;
  actualizado: string;
  ley?: string;
}

interface Corrida {
  id: number;
  creado_en: string;
  archivo_ministerio: string;
  archivo_siape: string;
  ministerio_modificado: string | null;
  siape_modificado: string | null;
}

interface ApiResult {
  ok: boolean;
  corrida: Corrida | null;
  resultado: CompRow[];
  error?: string;
}

function fechaHora(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
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
  'PENDIENTE':  { label: '● Pendiente', color: '#f59e0b' },
  'DESCARTADA': { label: '— Descartada', color: '#64748b' },
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

const COLS = ['Estado','Dep.','Ley','Legajo','DNI','Nombre','Nov. Ministerio','Desde Min.','Hasta Min.','Nov. SIAP','Desde SIAP','Hasta SIAP','Motivo','Carga'];

// Estado de carga de una fila SOLO_SIAP (sin fila en la tabla de carga = el robot todavía no la tomó)
function cargaDe(r: CompRow): 'OK' | 'ERROR' | 'SIN_INTENTAR' | 'DESCARTADA' | null {
  if (r.estado !== 'SOLO_SIAP' || r.motivo === 'BECARIO_NO_APLICA') return null;
  if (r.carga_estado === 'OK') return 'OK';
  if (r.carga_estado === 'DESCARTADA') return 'DESCARTADA';
  if (r.carga_estado && r.carga_estado !== 'PENDIENTE') return 'ERROR';
  return 'SIN_INTENTAR';
}

const BADGE_CARGA: Record<string, { label: string; color: string }> = {
  OK:           { label: '✓ Cargada',     color: '#22c55e' },
  ERROR:        { label: '✗ Error',       color: '#ef4444' },
  SIN_INTENTAR: { label: '● Sin intentar', color: '#f59e0b' },
  DESCARTADA:   { label: '— Descartada',   color: '#64748b' },
};

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
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }} title={r.carga_detalle || ''}>
                        {(() => { const c = cargaDe(r); const bc = c ? BADGE_CARGA[c] : null;
                          return bc ? <span style={{ color: bc.color, fontWeight: 600, fontSize: '0.63rem' }}>{bc.label}</span> : null; })()}
                      </td>
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

const COLS_RES = ['Nombre','DNI','Novedad','Desde','Hasta','Estado','Intentos','Detalle'];
const PAGE_SIZE = 50;

function TablaResultados({ rows }: { rows: ResultadoRow[] }) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [rows]);
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
                      <td style={{ padding: '4px 8px', color: '#a78bfa', fontSize: '0.72rem' }}>
                        {r.novedad}
                        {r.label && r.label !== r.novedad && <div style={{ color: '#64748b', fontSize: '0.64rem' }}>→ {r.label}</div>}
                      </td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', fontSize: '0.71rem' }}>{r.desde}</td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', fontSize: '0.71rem' }}>{r.hasta}</td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: b.color, fontWeight: 600, fontSize: '0.69rem' }}>{b.label}</span>
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: '0.69rem', color: '#94a3b8' }}>{r.intentos}</td>
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
  JUSTIFICADO: r.justificado_siap ?? '',
  Motivo: r.motivo,
  Carga: r.carga_estado ?? '',
  'Detalle carga': r.carga_detalle ?? '',
});

function detalleGrupo(detalle: string) {
  const d = String(detalle ?? '').replace(/^×\s*Close\s*/i, '').trim();
  const n = d.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (!d) return '';
  if (n.startsWith('SUPERPOSICION EXACTA')) return 'Superposicion exacta';
  if (n.startsWith('SUPERPOSICION NO EXACTA')) return 'Superposicion no exacta';
  if (n.includes('SE SUPERPONE')) return 'Superposicion sin identificar';
  if (n.includes('MAXIMO PERMITIDO') || n.includes('MAXIMO') || n.includes('SUPERA')) return 'Maximo permitido';
  if (n.includes('NO PERTENECE') || n.includes('NO PRESTA SERVICIO')) return 'No pertenece / no presta servicio';
  if (n.includes('OPCION NO DISPONIBLE')) return 'Opcion no disponible';
  if (n.includes('TIMEOUT') || n.includes('LOCATOR')) return 'Timeout de pantalla';
  if (n.includes('SIN FILA VALIDA')) return 'Sin fila valida';
  if (n.includes('YA POSEE')) return 'Ya posee novedad';
  if (n.includes('BROWSER CERRADO')) return 'Browser cerrado';
  return d.split('|')[0].split('.')[0].slice(0, 120).trim();
}

function normFiltro(v: string) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function novedadesPisadas(detalle: string) {
  const text = String(detalle ?? '').replace(/\s+/g, ' ').trim();
  const idx = text.toLowerCase().indexOf('se pisa con ');
  if (idx < 0) return [];

  const tail = text.slice(idx + 'se pisa con '.length);
  const found = new Map<string, string>();
  for (const part of tail.split(/\s+\|\s+/)) {
    const m = part.match(/^(.*?)(?=\s+\d{1,2}\/\d{1,2}\/\d{4})/);
    const label = String(m?.[1] ?? '').replace(/\([^)]*\)/g, '').replace(/[.;,]+$/g, '').replace(/\s+/g, ' ').trim();
    const key = normFiltro(label);
    if (key && !found.has(key)) found.set(key, label.toUpperCase());
  }
  return [...found.values()];
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
  const [comparando, setComparando]     = useState(false);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const [tab, setTab] = useState<'comparacion' | 'resultados' | 'carga_siape'>('comparacion');
  const { hasPerm } = useAuth();
  const esAdmin = hasPerm('crud:*:*');   // Carga SiAPe era solo admin
  const [filtroDetalle, setFiltroDetalle] = useState('todos');
  const [filtroPisada, setFiltroPisada] = useState('todos');
  const [cargando, setCargando]           = useState(false);
  const [cargandoAusentes, setCargandoAusentes] = useState(false);
  const [segundaPasada, setSegundaPasada] = useState(false);
  const firstLoad = useRef(false);

  const cargarResultado = useCallback(async (dep?: DepRes) => {
    const d = dep ?? depRes;
    setLoadingRes(true);
    try {
      const r = await apiFetch<{ ok: boolean; filas: ResultadoRow[] }>(
        `/comparacion-v2/resultado?dep=${encodeURIComponent(d)}${verAnteriores ? '&todas=1' : ''}`
      );
      if (r?.ok) setResultado(r.filas ?? []);
      else setResultado([]);
    } catch { setResultado([]); } finally {
      setLoadingRes(false);
    }
  }, [depRes, verAnteriores]);

  useEffect(() => {
    if (!firstLoad.current) { firstLoad.current = true; cargarResultado('HOSPITAL'); cargar(); }
  }, []);

  useEffect(() => {
    if (firstLoad.current) cargarResultado(depRes);
  }, [depRes, verAnteriores]);

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

  async function cargar() {
    setLoading(true);
    try {
      const r = await apiFetch<ApiResult>('/comparacion-v2/ultima');
      if (!r?.ok) throw new Error(r?.error ?? 'Error');
      setData(r.corrida ? r : null);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  }

  // Corre el Comparador 2.0 (lee los archivos de D:\G\comparacion y guarda una corrida nueva)
  async function comparar() {
    setComparando(true);
    try {
      const r = await apiFetch<{ ok: boolean; error?: string }>('/comparacion-v2/comparar', { method: 'POST' });
      if (!r?.ok) throw new Error(r?.error ?? 'Error');
      toast.ok('Comparación lista');
      await cargar();
      await cargarResultado();
    } catch (e: any) {
      toast.error('No se pudo comparar', e?.message);
    } finally {
      setComparando(false);
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
        .forEach(n => { if (n && n !== '—"') s.add(n); });
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [data]);

  const completa = useMemo(
    () => aplicarFiltros(data?.resultado ?? [], mes, texto, estado, dep, novedad),
    [data, mes, texto, estado, dep, novedad]
  );

  // Estado de carga de las SOLO_SIAP (las 3 dependencias, desde la base)
  const cargaConteo = useMemo(() => {
    const c = { OK: 0, ERROR: 0, SIN_INTENTAR: 0, DESCARTADA: 0 };
    for (const r of completa) { const k = cargaDe(r); if (k) c[k]++; }
    return c;
  }, [completa]);

  // Imprime en orden alfabético los 28 de SIAPE (AUSENTE SIN AVISO) y los de la Intranet
  // (28-INASISTENCIA). Respeta los filtros de mes, dependencia y texto (no los de estado/novedad).
  function imprimir28() {
    if (!data) return;
    const base = aplicarFiltros(data.resultado, mes, texto, 'todos', dep, 'todas');
    const fmt = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || ''));
    const esc = (v: string) => String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
    const ordenar = (rows: CompRow[], campo: keyof CompRow) =>
      [...rows].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || String(a[campo]).localeCompare(String(b[campo])));

    const siape = ordenar(base.filter(r => r.novedad_siap === 'AUSENTE SIN AVISO'), 'fecha_desde_siap');
    const intranet = ordenar(base.filter(r => /^28/.test(r.novedad_ministerio || '')), 'fecha_desde_min');

    const enIntranet = (r: CompRow) => {
      if (r.estado === 'COINCIDENTE') return 'Sí';
      if (r.estado === 'RANGO_DISTINTO') return 'Sí (otro rango)';
      const c = cargaDe(r);
      if (c === 'OK') return 'Sí (cargado por el robot)';
      if (c === 'ERROR') return `No — ${r.carga_detalle || 'error de carga'}`;
      if (c === 'DESCARTADA') return 'No — descartada (no se carga)';
      return 'No';
    };
    const enSiape = (r: CompRow) =>
      r.estado === 'COINCIDENTE' ? 'Sí' : r.estado === 'RANGO_DISTINTO' ? 'Sí (otro rango)' : 'No';

    const tabla = (titulo: string, rows: CompRow[], desde: keyof CompRow, hasta: keyof CompRow, colCruce: string, cruce: (r: CompRow) => string) => {
      let prev = '';
      const filas = rows.map(r => {
        const mismo = r.dni === prev; prev = r.dni;
        return `<tr class="${mismo ? '' : 'nuevo'}"><td>${mismo ? '' : esc(r.nombre)}</td><td>${mismo ? '' : esc(r.dni)}</td>`
          + `<td>${esc(r.dependencia)}</td><td>${fmt(String(r[desde]))}</td><td>${fmt(String(r[hasta]))}</td><td>${esc(cruce(r))}</td></tr>`;
      }).join('');
      const agentes = new Set(rows.map(r => r.dni)).size;
      return `<h2>${titulo}</h2><div class="sub">${rows.length} registro(s) · ${agentes} agente(s)</div>`
        + `<table><thead><tr><th>Agente</th><th>DNI</th><th>Dep.</th><th>Desde</th><th>Hasta</th><th>${colCruce}</th></tr></thead>`
        + `<tbody>${filas || '<tr><td colspan="6">Sin registros</td></tr>'}</tbody></table>`;
    };

    const filtros = [dep !== 'todos' ? dep : 'Todas las dependencias', mes ? `Mes ${mes}` : 'Todo el período', texto.trim() ? `Búsqueda: ${texto.trim()}` : '']
      .filter(Boolean).join(' · ');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Art. 28 — SIAPE e Intranet</title><style>
      body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;margin:18px}
      h1{font-size:16px;margin:0 0 2px} h2{font-size:13px;margin:18px 0 2px;page-break-after:avoid}
      .sub{color:#444;margin-bottom:6px} table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top} th{background:#eee}
      tr.nuevo td{border-top:2px solid #444} .salto{page-break-before:always}
      @media print{body{margin:8mm}}
    </style></head><body>
      <h1>Art. 28 (inasistencias) — SIAPE e Intranet</h1>
      <div class="sub">Corrida ${data.corrida?.id ?? ''} · ${esc(fechaHora(data.corrida?.creado_en))} · ${esc(filtros)} · orden alfabético</div>
      ${tabla('28 en SIAPE (AUSENTE SIN AVISO)', siape, 'fecha_desde_siap', 'fecha_hasta_siap', '¿Está en la Intranet?', enIntranet)}
      <div class="salto"></div>
      ${tabla('28 en la Intranet (28-INASISTENCIA)', intranet, 'fecha_desde_min', 'fecha_hasta_min', '¿Está en SIAPE?', enSiape)}
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('El navegador bloqueó la ventana de impresión'); return; }
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

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

  const resultadoPorEstado = useMemo(() => {
    let r = resultado;
    if (filtroRes === 'no_ok') r = r.filter(x => !['OK', 'PENDIENTE', 'DESCARTADA'].includes(x.estado));
    else if (filtroRes !== 'todos') r = r.filter(x => x.estado === filtroRes);
    return r;
  }, [resultado, filtroRes]);

  const detallesDisponibles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of resultadoPorEstado) {
      const g = detalleGrupo(row.detalle);
      if (!g) continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [resultadoPorEstado]);

  const filtroDetalleActivo = useMemo(() => {
    if (filtroDetalle === 'todos') return 'todos';
    return detallesDisponibles.some(([d]) => d === filtroDetalle) ? filtroDetalle : 'todos';
  }, [detallesDisponibles, filtroDetalle]);

  useEffect(() => {
    if (filtroDetalle !== filtroDetalleActivo) setFiltroDetalle(filtroDetalleActivo);
  }, [filtroDetalle, filtroDetalleActivo]);

  const resultadoPorMotivo = useMemo(() => {
    let r = resultadoPorEstado;
    if (filtroDetalleActivo !== 'todos') r = r.filter(x => detalleGrupo(x.detalle) === filtroDetalleActivo);
    return r;
  }, [resultadoPorEstado, filtroDetalleActivo]);

  const pisadasDisponibles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of resultadoPorMotivo) {
      const pisadas = novedadesPisadas(row.detalle);
      if (!pisadas.length) continue;
      const vistas = new Set<string>();
      for (const p of pisadas) {
        const key = normFiltro(p);
        if (!key || vistas.has(key)) continue;
        vistas.add(key);
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [resultadoPorMotivo]);

  const filtroPisadaActivo = useMemo(() => {
    if (filtroPisada === 'todos') return 'todos';
    return pisadasDisponibles.some(([d]) => d === filtroPisada) ? filtroPisada : 'todos';
  }, [pisadasDisponibles, filtroPisada]);

  useEffect(() => {
    if (filtroPisada !== filtroPisadaActivo) setFiltroPisada(filtroPisadaActivo);
  }, [filtroPisada, filtroPisadaActivo]);

  // Resultado filtrado
  const resFiltrado = useMemo(() => {
    let r = resultadoPorMotivo;
    if (filtroPisadaActivo !== 'todos') r = r.filter(x => novedadesPisadas(x.detalle).includes(filtroPisadaActivo));
    if (textoRes.trim()) {
      const t = textoRes.toLowerCase();
      r = r.filter(x => x.nombre.toLowerCase().includes(t) || x.dni.includes(t));
    }
    return r;
  }, [resultadoPorMotivo, filtroPisadaActivo, textoRes]);

  const resConteo = useMemo(() => ({
    ok:        resultado.filter(r => r.estado === 'OK').length,
    error:     resultado.filter(r => !['OK', 'PENDIENTE', 'DESCARTADA'].includes(r.estado)).length,
    pendiente: resultado.filter(r => r.estado === 'PENDIENTE').length,
  }), [resultado]);

  const erroresVisibles = useMemo(
    () => resFiltrado.filter(r => !['OK', 'PENDIENTE', 'DESCARTADA'].includes(r.estado)),
    [resFiltrado]
  );

  return (
    <Layout title="Comparador SIAPE vs Ministerio" showBack>
      <strong>📋 Comparador SIAPE vs Ministerio</strong>
      <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 12 }}>
        Cruza novedades SIAP contra Ministerio usando el mapeo de asistencia · join por DNI
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {([['comparacion', '📋 Comparación'], ['resultados', `📤 Resultados de carga${resultado.length > 0 ? ` (${resultado.length})` : ''}`], ...(esAdmin ? [['carga_siape', '🏥 Carga SiAPe']] as const : [])] as const).map(([key, label]) => (
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
          <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 12 }}>Todavía no hay ninguna comparación guardada.</div>
          <button className="btn" onClick={comparar} disabled={comparando}
            style={{ background: '#2563eb', color: '#fff', padding: '9px 24px' }}>
            {comparando ? '⏳ Comparando...' : '⚖ Comparar ahora'}
          </button>
        </div>
      )}

      {tab === 'comparacion' && loading && <div className="card muted" style={{ padding: 24, textAlign: 'center' }}>⏳ Leyendo la última comparación...</div>}

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
          <span className="muted" style={{ fontSize: '0.72rem', marginRight: 4 }}
            title={`Ministerio: ${data.corrida?.archivo_ministerio} (${fechaHora(data.corrida?.ministerio_modificado)})\nSIAPE: ${data.corrida?.archivo_siape} (${fechaHora(data.corrida?.siape_modificado)})`}>
            Corrida {data.corrida?.id} · {fechaHora(data.corrida?.creado_en)}
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

          <button className="btn" onClick={() => cargar()}
            style={{ fontSize: '0.76rem', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.07)' }}>
            🔄 Recargar
          </button>
          <button className="btn" onClick={comparar} disabled={comparando}
            title="Corre el Comparador 2.0 con los archivos actuales de D:\\G\\comparacion"
            style={{ fontSize: '0.76rem', whiteSpace: 'nowrap', background: '#2563eb', color: '#fff' }}>
            {comparando ? '⏳ Comparando...' : '⚖ Comparar de nuevo'}
          </button>
        </div>

        {/* Acciones exportar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
            Registros: <strong>{completa.length}</strong>
            {(cargaConteo.OK + cargaConteo.ERROR + cargaConteo.SIN_INTENTAR) > 0 && (
              <span style={{ marginLeft: 10, fontSize: '0.78rem' }}>
                · Solo SIAP: <span style={{ color: '#22c55e' }}><strong>{cargaConteo.OK}</strong> cargadas</span>
                {' · '}<span style={{ color: '#ef4444' }}><strong>{cargaConteo.ERROR}</strong> con error</span>
                {' · '}<span style={{ color: '#f59e0b' }}><strong>{cargaConteo.SIN_INTENTAR}</strong> sin intentar</span>
                {cargaConteo.DESCARTADA > 0 && <>{' · '}<span style={{ color: '#64748b' }}><strong>{cargaConteo.DESCARTADA}</strong> descartadas</span></>}
              </span>
            )}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => exportToExcel('comparacion_siape', completa.map(toRow))}
              disabled={!completa.length}
              style={{ background: 'rgba(255,255,255,0.07)', fontSize: '0.75rem' }}>
              📥 Exportar todo ({completa.length})
            </button>
            <button className="btn" onClick={imprimir28}
              title="Imprime en orden alfabético los 28 de SIAPE (ausente sin aviso) y los 28 de la Intranet, con los filtros de mes / dependencia / búsqueda"
              style={{ background: 'rgba(255,255,255,0.07)', fontSize: '0.75rem' }}>
              🖨 Imprimir 28
            </button>
            {(['HOSPITAL', 'UPA 4', 'UPA 18'] as const).map(d => (
              <button key={d} className="btn"
                onClick={() => lanzarScript('/comparacion-v2/lanzar', { tipo: 'novedades', dependencia: d }, setCargando)}
                disabled={cargando}
                title={`Carga en la Intranet las novedades pendientes de ${d} (robot 2.0)`}
                style={{ background: '#16a34a', color: '#fff', fontSize: '0.75rem' }}>
                {cargando ? '⏳...' : `▶ ${d}`}
              </button>
            ))}
            {(['HOSPITAL', 'UPA 4', 'UPA 18'] as const).map(d => (
              <button key={`aus-${d}`} className="btn"
                onClick={() => lanzarScript('/comparacion-v2/lanzar', { tipo: 'ausentes', dependencia: d }, setCargandoAusentes)}
                disabled={cargandoAusentes}
                title={`Carga como 28 - INASISTENCIA los ausentes pendientes de ${d} (robot 2.0)`}
                style={{ background: '#dc2626', color: '#fff', fontSize: '0.75rem' }}>
                {cargandoAusentes ? '...' : `Ausentes ${d}`}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
          <Tabla rows={completa} />
        </div>
      </>)}

      {/* ── Tab: Resultados de carga Ministerio ── */}
      {tab === 'carga_siape' && esAdmin && <CargaSiapeContent />}

      {tab === 'resultados' && <div style={{ marginTop: 0 }}>

        {/* Sub-tabs por dependencia */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {DEPS_RES.map(d => {
            const color = DEP_COLORS[d] ?? '#94a3b8';
            return (
              <button key={d} onClick={() => { setDepRes(d); setFiltroRes('no_ok'); setFiltroDetalle('todos'); setFiltroPisada('todos'); setTextoRes(''); }}
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
                {resConteo.pendiente > 0 && <>{' · '}<span style={{ color: '#f59e0b' }}>● {resConteo.pendiente} pendientes</span></>}
              </span>
            )}
            <label className="muted" style={{ fontSize: '0.72rem', marginLeft: 10, cursor: 'pointer' }}
              title="Por defecto se ve solo la última comparación; esto suma las filas de comparaciones anteriores">
              <input type="checkbox" checked={verAnteriores} onChange={e => setVerAnteriores(e.target.checked)} style={{ marginRight: 4 }} />
              Ver también corridas anteriores
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => cargarResultado()} disabled={loadingRes}
              style={{ fontSize: '0.73rem', background: 'rgba(255,255,255,0.07)' }}>
              🔄 {loadingRes ? 'Cargando...' : 'Actualizar'}
            </button>
            {resFiltrado.length > 0 && (
              <button className="btn"
                onClick={() => exportToExcel(`resultado_carga_${depRes.replace(' ', '')}`, resFiltrado.map(r => ({
                  Nombre: r.nombre, DNI: r.dni, Novedad: r.novedad, 'Opción Intranet': r.label,
                  Desde: r.desde, Hasta: r.hasta, Estado: r.estado, Intentos: r.intentos, Detalle: r.detalle
                })))}
                style={{ fontSize: '0.73rem', background: '#16a34a', color: '#fff' }}>
                📥 Exportar ({resFiltrado.length})
              </button>
            )}
            {erroresVisibles.length > 0 && (
              <button className="btn"
                onClick={async () => {
                  await lanzarScript('/comparacion-v2/reintentar',
                    { ids: erroresVisibles.map(r => r.id), dependencia: depRes }, setSegundaPasada);
                  cargarResultado();
                }}
                disabled={segundaPasada}
                title="Vuelve a PENDIENTE las filas con error que se ven y lanza el robot 2.0 para reintentarlas"
                style={{ background: '#d97706', color: '#fff', fontSize: '0.73rem' }}>
                {segundaPasada ? '⏳...' : `🔁 Reintentar errores ${depRes} (${erroresVisibles.length})`}
              </button>
            )}
          </div>
        </div>

        {resultado.length === 0 && !loadingRes && (
          <div className="card muted" style={{ padding: 16, textAlign: 'center', fontSize: '0.8rem' }}>
            Sin datos — todavía no se corrió la carga 2.0 para {depRes}
          </div>
        )}

        {resultado.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <select className="input" value={filtroRes}
                onChange={e => { setFiltroRes(e.target.value); setFiltroDetalle('todos'); setFiltroPisada('todos'); }}
                style={{ fontSize: '0.78rem', width: 160 }}>
                <option value="no_ok">Solo errores</option>
                <option value="todos">Todos los estados</option>
                <option value="OK">Solo OK</option>
                <option value="ERROR">Solo ERROR</option>
                <option value="EXCEPCION">Solo Excepción</option>
                <option value="ERROR_NAV">Solo Nav error</option>
                <option value="PENDIENTE">Solo pendientes</option>
                <option value="DESCARTADA">Solo descartadas</option>
              </select>
              <select className="input" value={filtroDetalleActivo} onChange={e => { setFiltroDetalle(e.target.value); setFiltroPisada('todos'); }}
                style={{ fontSize: '0.78rem', flex: '1 1 200px', minWidth: 160 }}>
                <option value="todos">Todos los motivos</option>
                {detallesDisponibles.map(([d, count]) => (
                  <option key={d} value={d}>{d} ({count})</option>
                ))}
              </select>
              <select className="input" value={filtroPisadaActivo} onChange={e => setFiltroPisada(e.target.value)}
                disabled={pisadasDisponibles.length === 0}
                style={{ fontSize: '0.78rem', flex: '1 1 180px', minWidth: 150 }}>
                <option value="todos">Todas las pisadas</option>
                {pisadasDisponibles.map(([d, count]) => (
                  <option key={d} value={d}>Se pisa con {d} ({count})</option>
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

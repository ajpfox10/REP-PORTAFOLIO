// src/pages/SamoPage/index.tsx
// Página exclusiva del rol SAMO.
// Tabs: Licencias activas | Bajas/Renuncias | Altas/Activos | Totales por Servicio
// NO la ven: salud_laboral, jefe_servicio, ni ningún otro rol.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf } from '../../utils/export';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d?: string | null): string {
  if (!d) return '—';
  try {
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-').map(Number);
    if (!y || !m || !day) return String(d);
    return new Date(y, m - 1, day).toLocaleDateString('es-AR');
  } catch { return String(d); }
}

async function fetchAll<T = any>(endpoint: string, sort = ''): Promise<T[]> {
  const PAGE = 200;
  let page = 1;
  let all: T[] = [];
  let total = Infinity;
  while (all.length < total) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const sortPart = sort ? `&sort=${sort}` : '';
    const res = await apiFetch<any>(`${endpoint}${sep}limit=${PAGE}&page=${page}${sortPart}`);
    const rows: T[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total);
    else total = all.length;
    if (rows.length < PAGE) break;
    page++;
  }
  return all;
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: color, borderRadius: '16px 0 0 16px' }} />
      <div style={{ paddingLeft: 10 }}>
        <div className="muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1, color }}>{value.toLocaleString('es-AR')}</div>
      </div>
    </div>
  );
}

// ─── Tab button ────────────────────────────────────────────────────────────────
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      fontSize: '0.82rem', padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
      border: `1px solid ${active ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
      background: active ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.04)',
      color: active ? '#c4b5fd' : '#94a3b8', fontWeight: active ? 700 : 400,
    }}>{children}</button>
  );
}

// ─── Tabla genérica ────────────────────────────────────────────────────────────
function MiniTabla({ rows, cols }: {
  rows: any[];
  cols: { key: string; label: string; mono?: boolean; badge?: (v: any) => { text: string; color: string } | null }[];
}) {
  if (!rows.length) return <div className="muted" style={{ padding: '20px 0', textAlign: 'center', fontSize: '0.82rem' }}>Sin registros.</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: '0.79rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0 }}>
            {cols.map(c => (
              <th key={c.key} style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {cols.map(c => {
                const val = r[c.key];
                const badge = c.badge?.(val);
                return (
                  <td key={c.key} style={{ padding: '5px 10px', whiteSpace: 'nowrap', fontFamily: c.mono ? 'monospace' : undefined }}>
                    {badge
                      ? <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5, background: badge.color + '33', color: badge.color, fontWeight: 700 }}>{badge.text}</span>
                      : (val === null || val === undefined || val === '') ? '—' : String(val)
                    }
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Búsqueda rápida ───────────────────────────────────────────────────────────
function Busqueda({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
      <input className="input" style={{ flex: 1, maxWidth: 340, fontSize: '0.83rem' }}
        placeholder="Buscar por DNI / apellido…" value={value}
        onChange={e => onChange(e.target.value)} />
      {value && <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => onChange('')}>✕</button>}
    </div>
  );
}

// ─── Constantes de fecha ──────────────────────────────────────────────────────
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const _HOY        = new Date();
const AÑO_ACTUAL  = _HOY.getFullYear();
const MES_ACTUAL  = _HOY.getMonth() + 1; // 1-12

/** Chequea si una fecha ISO (YYYY-MM-DD) cae en un mes/año dado */
function enMesAño(fechaStr: string | null | undefined, mes: number, año: number): boolean {
  if (!fechaStr) return false;
  const s = String(fechaStr).slice(0, 10);
  const [y, m] = s.split('-').map(Number);
  return y === año && m === mes;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
type TabId = 'licencias' | 'bajas' | 'altas' | 'servicio';

// ─── Página principal ─────────────────────────────────────────────────────────
export function SamoPage() {
  const toast = useToast();

  // ── Datos ──────────────────────────────────────────────────────────────────
  const [licencias,    setLicencias]    = useState<any[]>([]);
  const [agentes,      setAgentes]      = useState<any[]>([]);
  const [personalMap,  setPersonalMap]  = useState<Record<string, { apellido: string; nombre: string; legajo?: string }>>({});
  const [sectoresMap,  setSectoresMap]  = useState<Record<number, string>>({});
  const [serviciosMap, setServiciosMap] = useState<Record<string, number>>({});  // servicio_nombre → count
  const [loading,      setLoading]      = useState(true);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [tab,       setTab]       = useState<TabId>('licencias');
  const [busqueda,  setBusqueda]  = useState('');
  const [mesFiltro, setMesFiltro] = useState(MES_ACTUAL);
  // año fijo = año actual; solo mes es seleccionable (enero → mes actual)
  const mesesDisponibles = Array.from({ length: MES_ACTUAL }, (_, i) => i + 1);

  // ── Carga ──────────────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [rLic, rAg, rPers, rSect, rServ] = await Promise.allSettled([
        fetchAll('/reconocimientos_medicos', '-fecha_desde'),
        fetchAll('/agentes'),
        fetchAll('/personal/search'),
        apiFetch<any>('/reparticiones?limit=500'),
        fetchAll('/agentes_servicios'),
      ]);

      if (rLic.status === 'fulfilled')  setLicencias(rLic.value);
      if (rAg.status  === 'fulfilled')  setAgentes(rAg.value);

      if (rPers.status === 'fulfilled') {
        const map: Record<string, { apellido: string; nombre: string; legajo?: string }> = {};
        for (const p of rPers.value) {
          if (p.dni != null) map[String(p.dni)] = { apellido: p.apellido || '', nombre: p.nombre || '', legajo: p.legajo || '' };
        }
        setPersonalMap(map);
      }

      if (rSect.status === 'fulfilled') {
        const rows = rSect.value?.data || [];
        const m: Record<number, string> = {};
        for (const r of rows) m[Number(r.id)] = r.reparticion_nombre || r.nombre || `#${r.id}`;
        setSectoresMap(m);
      }

      // Totales por servicio_nombre activos (sin fecha_hasta)
      if (rServ.status === 'fulfilled') {
        const activos = rServ.value.filter((s: any) => !s.fecha_hasta && s.servicio_nombre);
        const m: Record<string, number> = {};
        for (const s of activos) {
          const k = s.servicio_nombre as string;
          m[k] = (m[k] || 0) + 1;
        }
        setServiciosMap(m);
      }
    } catch (e: any) {
      toast.error('Error al cargar SAMO', e?.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Derivados ──────────────────────────────────────────────────────────────
  const enriquece = (a: any) => {
    const p = personalMap[String(a.dni)] || { apellido: '', nombre: '', legajo: '' };
    return {
      ...a,
      apellido: p.apellido || a.apellido || '—',
      nombre:   p.nombre   || a.nombre   || '—',
      legajo:   a.legajo   || p.legajo   || '—',
      sector:   sectoresMap[a.sector_id] || '—',
    };
  };

  const filtrar = (arr: any[]) => {
    if (!busqueda.trim()) return arr;
    const q = busqueda.trim().toLowerCase();
    return arr.filter(r =>
      String(r.dni || '').includes(q) ||
      (r.apellido || '').toLowerCase().includes(q) ||
      (r.nombre   || '').toLowerCase().includes(q)
    );
  };

  const bajas = useMemo(() =>
    agentes.filter(a => a.estado_empleo === 'BAJA' || a.fecha_egreso).map(enriquece),
    [agentes, personalMap, sectoresMap]   // eslint-disable-line
  );

  const altas = useMemo(() =>
    agentes.filter(a => a.estado_empleo === 'ACTIVO').map(enriquece),
    [agentes, personalMap, sectoresMap]   // eslint-disable-line
  );

  // ── KPIs mes actual ────────────────────────────────────────────────────────
  const altasMesActual  = useMemo(() =>
    agentes.filter(a => a.estado_empleo === 'ACTIVO' && enMesAño(a.fecha_ingreso, MES_ACTUAL, AÑO_ACTUAL)).map(enriquece),
    [agentes, personalMap, sectoresMap]   // eslint-disable-line
  );
  const bajasMesActual  = useMemo(() =>
    agentes.filter(a => (a.estado_empleo === 'BAJA' || a.fecha_egreso) && enMesAño(a.fecha_egreso, MES_ACTUAL, AÑO_ACTUAL)).map(enriquece),
    [agentes, personalMap, sectoresMap]   // eslint-disable-line
  );

  // ── Filtrados por mes seleccionado ─────────────────────────────────────────
  const altasFiltradas = useMemo(() =>
    altas.filter(a => enMesAño(a.fecha_ingreso, mesFiltro, AÑO_ACTUAL)),
    [altas, mesFiltro]
  );
  const bajasFiltradas = useMemo(() =>
    bajas.filter(a => enMesAño(a.fecha_egreso, mesFiltro, AÑO_ACTUAL)),
    [bajas, mesFiltro]
  );

  // Totales generales (sin filtro de mes, para los KPIs globales)
  const licActivas  = licencias.filter(r => !r.fecha_hasta);
  const licCerradas = licencias.filter(r =>  r.fecha_hasta);

  // ── Columnas por tab ───────────────────────────────────────────────────────
  const colsBajas = [
    { key: 'legajo',       label: 'Legajo', mono: true },
    { key: 'dni',          label: 'DNI',    mono: true },
    { key: 'apellido',     label: 'Apellido' },
    { key: 'nombre',       label: 'Nombre' },
    { key: 'sector',       label: 'Sector' },
    { key: 'fecha_ingreso',label: 'Fecha Alta',  badge: undefined, key2: 'fecha_ingreso_fmt' },
    { key: 'fecha_egreso', label: 'Fecha Baja',  badge: undefined, key2: 'fecha_egreso_fmt'  },
    { key: 'estado_empleo',label: 'Estado',
      badge: (v: string) => v === 'BAJA' ? { text: 'BAJA', color: '#ef4444' } : { text: v || '?', color: '#94a3b8' } },
  ];

  const colsAltas = [
    { key: 'legajo',        label: 'Legajo', mono: true },
    { key: 'dni',           label: 'DNI',    mono: true },
    { key: 'apellido',      label: 'Apellido' },
    { key: 'nombre',        label: 'Nombre' },
    { key: 'sector',        label: 'Sector' },
    { key: 'fecha_ingreso', label: 'Fecha Alta', badge: undefined },
    { key: 'estado_empleo', label: 'Estado',
      badge: (v: string) => v === 'ACTIVO' ? { text: 'ACTIVO', color: '#10b981' } : { text: v || '?', color: '#94a3b8' } },
  ];

  const colsLic = [
    { key: 'fecha_desde',  label: 'Desde',    mono: true },
    { key: 'fecha_hasta',  label: 'Hasta',    mono: true },
    { key: 'dni',          label: 'DNI',      mono: true },
    { key: 'apellido',     label: 'Apellido' },
    { key: 'nombre',       label: 'Nombre' },
    { key: 'tipo',         label: 'Tipo' },
    { key: 'cantidad_dias',label: 'Días',     mono: true },
    { key: 'resultado',    label: 'Resultado' },
    { key: 'activa',       label: 'Estado',
      badge: (v: any) => v ? { text: '🔴 Activa', color: '#ef4444' } : { text: '✅ Cerrada', color: '#10b981' } },
  ];

  // Licencias filtradas por mes seleccionado (fecha_desde o fecha como fallback)
  const licenciasFiltradas = useMemo(() =>
    licencias.filter(r => enMesAño(r.fecha_desde || r.fecha, mesFiltro, AÑO_ACTUAL)),
    [licencias, mesFiltro]
  );

  // Filas formateadas para licencias (filtradas por mes)
  const licRows = licenciasFiltradas.map(r => {
    const fechaInicio = r.fecha_desde || r.fecha;
    return {
      ...r,
      apellido:    personalMap[String(r.dni)]?.apellido || r.apellido || '—',
      nombre:      personalMap[String(r.dni)]?.nombre   || r.nombre   || '—',
      fecha_desde: fechaInicio ? fmt(fechaInicio) : '—',
      fecha_hasta: r.fecha_hasta ? fmt(r.fecha_hasta) : '—',
      activa:      !r.fecha_hasta,
    };
  });

  // Filas formateadas para bajas/altas (filtradas por mes)
  const bajasRows = bajasFiltradas.map(a => ({
    ...a,
    fecha_ingreso: fmt(a.fecha_ingreso),
    fecha_egreso:  fmt(a.fecha_egreso),
  }));

  const altasRows = altasFiltradas.map(a => ({
    ...a,
    fecha_ingreso: fmt(a.fecha_ingreso),
  }));

  // Totales por servicio
  const servicioRows = Object.entries(serviciosMap)
    .sort(([, a], [, b]) => b - a)
    .map(([servicio, total]) => ({ Servicio: servicio, Total: total }));

  // ── Exports ────────────────────────────────────────────────────────────────
  const exportar = (tipo: 'excel' | 'pdf') => {
    let rows: any[] = [];
    let file = 'samo';
    if (tab === 'licencias') { rows = filtrar(licRows);   file = 'samo_licencias'; }
    if (tab === 'bajas')     { rows = filtrar(bajasRows); file = 'samo_bajas'; }
    if (tab === 'altas')     { rows = filtrar(altasRows); file = 'samo_altas'; }
    if (tab === 'servicio')  { rows = servicioRows;        file = 'samo_por_servicio'; }
    if (tipo === 'excel') exportToExcel(file, rows);
    if (tipo === 'pdf')   exportToPdf(file, rows);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout title="SAMO" showBack>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: '1.05rem' }}>🏥 SAMO — Panel de Personal</strong>
          <div className="muted" style={{ fontSize: '0.73rem', marginTop: 3 }}>
            {loading ? 'Cargando datos…' : `${agentes.length} agentes · ${licencias.length} licencias`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" style={{ fontSize: '0.75rem', background: '#16a34a', color: '#fff' }}
            onClick={() => exportar('excel')} disabled={loading}>📊 Excel</button>
          <button className="btn" style={{ fontSize: '0.75rem', background: '#dc2626', color: '#fff' }}
            onClick={() => exportar('pdf')} disabled={loading}>📕 PDF</button>
          <button className="btn" style={{ fontSize: '0.75rem' }}
            onClick={cargar} disabled={loading}>🔄 Actualizar</button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ marginBottom: 6 }}>
        <div className="muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Totales generales
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
          <KpiCard label="Activos totales"    value={altas.length}      color="#10b981" />
          <KpiCard label="Bajas totales"      value={bajas.length}      color="#ef4444" />
          <KpiCard label="Licencias activas"  value={licActivas.length} color="#f59e0b" />
          <KpiCard label="Licencias cerradas" value={licCerradas.length}color="#64748b" />
          <KpiCard label="Servicios activos"  value={Object.keys(serviciosMap).length} color="#7c3aed" />
        </div>
        <div className="muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          {MESES[MES_ACTUAL - 1]} {AÑO_ACTUAL}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
          <KpiCard label="Altas este mes"  value={altasMesActual.length}  color="#34d399" />
          <KpiCard label="Bajas este mes"  value={bajasMesActual.length}  color="#f87171" />
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <Tab active={tab === 'licencias'} onClick={() => { setTab('licencias'); setBusqueda(''); }}>
          🏥 Licencias {licActivas.length > 0 && <span style={{ marginLeft: 5, background: '#ef4444', color: '#fff', borderRadius: 99, fontSize: '0.65rem', padding: '1px 6px' }}>{licActivas.length}</span>}
        </Tab>
        <Tab active={tab === 'bajas'} onClick={() => { setTab('bajas'); setBusqueda(''); }}>
          📤 Bajas / Renuncias ({bajas.length})
        </Tab>
        <Tab active={tab === 'altas'} onClick={() => { setTab('altas'); setBusqueda(''); }}>
          📥 Activos / Altas ({altas.length})
        </Tab>
        <Tab active={tab === 'servicio'} onClick={() => { setTab('servicio'); setBusqueda(''); }}>
          📊 Por Servicio ({Object.keys(serviciosMap).length})
        </Tab>
      </div>

      {/* ── Contenido ── */}
      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>🔄 Cargando…</div>
        ) : (
          <>
            {/* Tab: Licencias */}
            {tab === 'licencias' && (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    Filtrando por mes de inicio:
                  </div>
                  <select
                    className="input"
                    style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
                    value={mesFiltro}
                    onChange={e => { setMesFiltro(Number(e.target.value)); setBusqueda(''); }}
                  >
                    {mesesDisponibles.map(m => (
                      <option key={m} value={m}>{MESES[m - 1]} {AÑO_ACTUAL}</option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: '0.72rem' }}>
                    {licenciasFiltradas.length} licencia{licenciasFiltradas.length !== 1 ? 's' : ''} en {MESES[mesFiltro - 1]}
                    {' · '}{licenciasFiltradas.filter(r => !r.fecha_hasta).length} activas
                    {' · '}{licenciasFiltradas.filter(r =>  r.fecha_hasta).length} cerradas
                  </span>
                </div>
                <Busqueda value={busqueda} onChange={setBusqueda} />
                <MiniTabla rows={filtrar(licRows)} cols={colsLic} />
              </>
            )}

            {/* Tab: Bajas */}
            {tab === 'bajas' && (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    Filtrando por mes de egreso:
                  </div>
                  <select
                    className="input"
                    style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
                    value={mesFiltro}
                    onChange={e => { setMesFiltro(Number(e.target.value)); setBusqueda(''); }}
                  >
                    {mesesDisponibles.map(m => (
                      <option key={m} value={m}>{MESES[m - 1]} {AÑO_ACTUAL}</option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: '0.72rem' }}>
                    {bajasFiltradas.length} baja{bajasFiltradas.length !== 1 ? 's' : ''} en {MESES[mesFiltro - 1]}
                  </span>
                </div>
                <Busqueda value={busqueda} onChange={setBusqueda} />
                <MiniTabla rows={filtrar(bajasRows)} cols={colsBajas} />
              </>
            )}

            {/* Tab: Altas / Activos */}
            {tab === 'altas' && (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    Filtrando por mes de ingreso:
                  </div>
                  <select
                    className="input"
                    style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
                    value={mesFiltro}
                    onChange={e => { setMesFiltro(Number(e.target.value)); setBusqueda(''); }}
                  >
                    {mesesDisponibles.map(m => (
                      <option key={m} value={m}>{MESES[m - 1]} {AÑO_ACTUAL}</option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: '0.72rem' }}>
                    {altasFiltradas.length} alta{altasFiltradas.length !== 1 ? 's' : ''} en {MESES[mesFiltro - 1]}
                  </span>
                </div>
                <Busqueda value={busqueda} onChange={setBusqueda} />
                <MiniTabla rows={filtrar(altasRows)} cols={colsAltas} />
              </>
            )}

            {/* Tab: Por Servicio */}
            {tab === 'servicio' && (
              <>
                <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 14 }}>
                  Agentes con servicio activo (sin fecha de baja en agentes_servicios)
                </div>
                {/* Barras */}
                <div style={{ marginBottom: 16 }}>
                  {(() => {
                    const max = servicioRows[0]?.Total || 1;
                    return servicioRows.map((r, i) => {
                      const pct = Math.round((r.Total / max) * 100);
                      const COLS = ['#7c3aed','#2563eb','#10b981','#f59e0b','#ec4899','#06b6d4','#f97316','#ef4444'];
                      const color = COLS[i % COLS.length];
                      return (
                        <div key={r.Servicio} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <div title={r.Servicio} style={{ minWidth: 200, maxWidth: 200, fontSize: '0.78rem', textAlign: 'right', color: 'rgba(255,255,255,0.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.Servicio}
                          </div>
                          <div style={{ flex: 1, height: 20, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.6s ease', minWidth: 4 }} />
                          </div>
                          <div style={{ minWidth: 36, textAlign: 'right', fontWeight: 700, fontSize: '0.82rem' }}>{r.Total}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
                {/* Tabla resumen */}
                <MiniTabla
                  rows={servicioRows}
                  cols={[
                    { key: 'Servicio', label: 'Servicio' },
                    { key: 'Total',    label: 'Agentes activos', mono: true },
                  ]}
                />
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

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
type TabId = 'licencias' | 'bajas' | 'altas' | 'servicio' | 'articulo26' | 'art48' | 'papcolpo' | 'examen' | 'prexamen';

// ─── Página principal ─────────────────────────────────────────────────────────
export function SamoPage() {
  const toast = useToast();

  // ── Datos ──────────────────────────────────────────────────────────────────
  const [licencias,       setLicencias]       = useState<any[]>([]);
  const [agentes,         setAgentes]         = useState<any[]>([]);
  const [personalMap,     setPersonalMap]      = useState<Record<string, { apellido: string; nombre: string; legajo?: string }>>({});
  const [sectoresMap,     setSectoresMap]      = useState<Record<number, string>>({});   // id → nombre sector
  const [serviciosMap,    setServiciosMap]     = useState<Record<number, string>>({});   // id → nombre servicio
  const [reparticionMap,  setReparticionMap]   = useState<Record<number, string>>({});   // id → nombre reparticion
  const [servicioTotales, setServicioTotales]  = useState<Record<string, number>>({});   // nombre servicio → count agentes
  const [art26,           setArt26]            = useState<any[]>([]);
  const [art48,           setArt48]            = useState<any[]>([]);
  const [papcolpo,        setPapcolpo]         = useState<any[]>([]);
  const [examen,          setExamen]           = useState<any[]>([]);
  const [prexamen,        setPrexamen]         = useState<any[]>([]);
  const [loading,         setLoading]          = useState(true);

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
      const [rLic, rAg, rPers, rSect, rServ, rRep, rArt26, rArt48, rPapcolpo, rExamen, rPrexamen] = await Promise.allSettled([
        fetchAll('/reconocimientos_medicos', '-fecha_desde'),
        fetchAll('/agentes'),
        fetchAll('/personal/search'),
        fetchAll('/sectores'),
        fetchAll('/servicios'),
        fetchAll('/reparticiones'),
        fetchAll('/articulo_26', '-fecha'),
        fetchAll('/agentes?ley_id=14'),
        fetchAll('/papcolpo', '-fecha'),
        fetchAll('/examen', '-fecha'),
        fetchAll('/prexamen', '-fecha'),
      ]);

      if (rLic.status === 'fulfilled') setLicencias(rLic.value);
      if (rAg.status  === 'fulfilled') setAgentes(rAg.value);

      if (rPers.status === 'fulfilled') {
        const map: Record<string, { apellido: string; nombre: string; legajo?: string }> = {};
        for (const p of rPers.value) {
          if (p.dni != null) map[String(p.dni)] = { apellido: p.apellido || '', nombre: p.nombre || '', legajo: p.legajo || '' };
        }
        setPersonalMap(map);
      }

      // Sectores: id → nombre
      if (rSect.status === 'fulfilled') {
        const m: Record<number, string> = {};
        for (const s of rSect.value) m[Number(s.id)] = s.nombre || `#${s.id}`;
        setSectoresMap(m);
      }

      // Servicios: id → nombre
      if (rServ.status === 'fulfilled') {
        const m: Record<number, string> = {};
        for (const s of rServ.value) m[Number(s.id)] = s.nombre || `#${s.id}`;
        setServiciosMap(m);

        // Totales por servicio (agentes activos con servicio_id)
        if (rAg.status === 'fulfilled') {
          const totales: Record<string, number> = {};
          for (const a of rAg.value) {
            if (a.estado_empleo === 'ACTIVO' && a.servicio_id) {
              const k = m[Number(a.servicio_id)] || `Servicio #${a.servicio_id}`;
              totales[k] = (totales[k] || 0) + 1;
            }
          }
          setServicioTotales(totales);
        }
      }

      // Reparticiones: id → nombre
      if (rRep.status === 'fulfilled') {
        const m: Record<number, string> = {};
        for (const r of rRep.value) m[Number(r.id)] = r.reparticion_nombre || r.nombre || `#${r.id}`;
        setReparticionMap(m);
      }

      // Artículo 26
      if (rArt26.status === 'fulfilled') setArt26(rArt26.value);

      // Artículo 48
      if (rArt48.status === 'fulfilled') setArt48(rArt48.value);

      // Pap/Colpo, Examen, Pre-examen
      if (rPapcolpo.status  === 'fulfilled') setPapcolpo(rPapcolpo.value);
      if (rExamen.status    === 'fulfilled') setExamen(rExamen.value);
      if (rPrexamen.status  === 'fulfilled') setPrexamen(rPrexamen.value);

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
      apellido:     p.apellido || a.apellido || '—',
      nombre:       p.nombre   || a.nombre   || '—',
      legajo:       a.legajo   || p.legajo   || '—',
      sector:       sectoresMap[Number(a.sector_id)]       || '—',
      servicio:     serviciosMap[Number(a.servicio_id)]    || '—',
      reparticion:  reparticionMap[Number(a.reparticion_id)] || '—',
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
    { key: 'legajo',       label: 'Legajo',      mono: true },
    { key: 'dni',          label: 'DNI',         mono: true },
    { key: 'apellido',     label: 'Apellido' },
    { key: 'nombre',       label: 'Nombre' },
    { key: 'reparticion',  label: 'Repartición' },
    { key: 'servicio',     label: 'Servicio' },
    { key: 'sector',       label: 'Sector' },
    { key: 'fecha_ingreso',label: 'Fecha Alta' },
    { key: 'fecha_egreso', label: 'Fecha Baja' },
    { key: 'estado_empleo',label: 'Estado',
      badge: (v: string) => v === 'BAJA' ? { text: 'BAJA', color: '#ef4444' } : { text: v || '?', color: '#94a3b8' } },
  ];

  const colsAltas = [
    { key: 'legajo',        label: 'Legajo',      mono: true },
    { key: 'dni',           label: 'DNI',         mono: true },
    { key: 'apellido',      label: 'Apellido' },
    { key: 'nombre',        label: 'Nombre' },
    { key: 'reparticion',   label: 'Repartición' },
    { key: 'servicio',      label: 'Servicio' },
    { key: 'sector',        label: 'Sector' },
    { key: 'fecha_ingreso', label: 'Fecha Alta' },
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

  // Totales por servicio (agentes activos con servicio_id asignado)
  const servicioRows = Object.entries(servicioTotales)
    .sort(([, a], [, b]) => b - a)
    .map(([servicio, total]) => ({ Servicio: servicio, Total: total }));

  // ── Artículo 26 ────────────────────────────────────────────────────────────
  const art26Filtradas = useMemo(() =>
    art26.filter(r => enMesAño(r.fecha, mesFiltro, AÑO_ACTUAL)),
    [art26, mesFiltro]
  );

  const art26Rows = art26Filtradas.map(r => ({
    ...r,
    apellido:   personalMap[String(r.dni)]?.apellido || '—',
    nombre:     personalMap[String(r.dni)]?.nombre   || '—',
    servicio:   serviciosMap[Number(r.sector_id)]    || '—',
    fecha:      fmt(r.fecha),
  }));

  const colsArt26 = [
    { key: 'dni',           label: 'DNI',      mono: true },
    { key: 'apellido',      label: 'Apellido' },
    { key: 'nombre',        label: 'Nombre' },
    { key: 'fecha',         label: 'Fecha',    mono: true },
    { key: 'dias',          label: 'Días',     mono: true },
    { key: 'motivo',        label: 'Motivo' },
    { key: 'jefe_nombre',   label: 'Jefe' },
    { key: 'estado',        label: 'Estado',
      badge: (v: string) => {
        const MAP: Record<string, string> = { PENDIENTE: '#fbbf24', APROBADO: '#22c55e', RECHAZADO: '#ef4444', ANULADO: '#64748b' };
        return { text: v || '—', color: MAP[v] || '#94a3b8' };
      }
    },
  ];

  // ── Pap/Colpo, Examen, Pre-examen ──────────────────────────────────────────
  const papcolpoFiltradas = useMemo(() =>
    papcolpo.filter(r => enMesAño(r.fecha, mesFiltro, AÑO_ACTUAL)),
    [papcolpo, mesFiltro]
  );
  const examenFiltradas = useMemo(() =>
    examen.filter(r => enMesAño(r.fecha, mesFiltro, AÑO_ACTUAL)),
    [examen, mesFiltro]
  );
  const prexamenFiltradas = useMemo(() =>
    prexamen.filter(r => enMesAño(r.fecha, mesFiltro, AÑO_ACTUAL)),
    [prexamen, mesFiltro]
  );

  const buildMedRows = (data: any[]) => data.map(r => ({
    ...r,
    apellido:    personalMap[String(r.dni)]?.apellido || '—',
    nombre:      personalMap[String(r.dni)]?.nombre   || '—',
    sector:      sectoresMap[Number(r.sector_id)]     || '—',
    fecha:       fmt(r.fecha),
    cargado_el:  r.created_at ? new Date(r.created_at).toLocaleDateString('es-AR') : '—',
  }));

  const papcolpoRows  = buildMedRows(papcolpoFiltradas);
  const examenRows    = buildMedRows(examenFiltradas);
  const prexamenRows  = buildMedRows(prexamenFiltradas);

  const colsMed = [
    { key: 'dni',        label: 'DNI',      mono: true },
    { key: 'apellido',   label: 'Apellido' },
    { key: 'nombre',     label: 'Nombre' },
    { key: 'tipo',       label: 'Tipo' },
    { key: 'fecha',      label: 'Fecha',    mono: true },
    { key: 'resultado',  label: 'Resultado' },
    { key: 'jefe_nombre',label: 'Jefe' },
    { key: 'sector',     label: 'Sector' },
    { key: 'cargado_el', label: 'Cargado el', mono: true },
  ];

  // ── Artículo 48 ────────────────────────────────────────────────────────────
  // Todos los agentes con ley_id = 14 (ART. 48), sin filtro de mes
  const art48Rows = useMemo(() =>
    art48.map(p => {
      const pers = personalMap[String(p.dni)] || {};
      return {
        ...p,
        apellido:    pers.apellido   || p.apellido    || '—',
        nombre:      pers.nombre     || p.nombre      || '—',
        legajo:      pers.legajo     || p.legajo      || '—',
        reparticion: reparticionMap[Number(p.reparticion_id)] || '—',
        servicio:    serviciosMap[Number(p.servicio_id)]      || '—',
        sector:      sectoresMap[Number(p.sector_id)]         || '—',
      };
    }),
    [art48, personalMap, reparticionMap, serviciosMap, sectoresMap]
  );

  const colsArt48 = [
    { key: 'legajo',        label: 'Legajo',      mono: true },
    { key: 'dni',           label: 'DNI',         mono: true },
    { key: 'apellido',      label: 'Apellido' },
    { key: 'nombre',        label: 'Nombre' },
    { key: 'reparticion',   label: 'Repartición' },
    { key: 'servicio',      label: 'Servicio' },
    { key: 'sector',        label: 'Sector' },
    { key: 'fecha_ingreso', label: 'Fecha Ingreso', mono: true },
    { key: 'estado_empleo', label: 'Estado',
      badge: (v: string) => v === 'ACTIVO' ? { text: 'ACTIVO', color: '#10b981' } : { text: v || '—', color: '#94a3b8' } },
  ];

  // ── Exports ────────────────────────────────────────────────────────────────
  const exportar = (tipo: 'excel' | 'pdf') => {
    let rows: any[] = [];
    let file = 'samo';
    if (tab === 'licencias')  { rows = filtrar(licRows);          file = 'samo_licencias'; }
    if (tab === 'bajas')      { rows = filtrar(bajasRows);        file = 'samo_bajas'; }
    if (tab === 'altas')      { rows = filtrar(altasRows);        file = 'samo_altas'; }
    if (tab === 'servicio')   { rows = servicioRows;         file = 'samo_por_servicio'; }
    if (tab === 'articulo26') { rows = filtrar(art26Rows);         file = 'samo_articulo26'; }
    if (tab === 'art48')      { rows = filtrar(art48Rows);         file = 'samo_articulo48'; }
    if (tab === 'papcolpo')   { rows = filtrar(papcolpoRows);      file = 'samo_papcolpo'; }
    if (tab === 'examen')     { rows = filtrar(examenRows);        file = 'samo_examen'; }
    if (tab === 'prexamen')   { rows = filtrar(prexamenRows);      file = 'samo_prexamen'; }
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
          <KpiCard label="Servicios activos"  value={Object.keys(servicioTotales).length} color="#7c3aed" />
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
          📊 Por Servicio ({Object.keys(servicioTotales).length})
        </Tab>
        <Tab active={tab === 'articulo26'} onClick={() => { setTab('articulo26'); setBusqueda(''); }}>
          📋 Art. 26 ({art26Filtradas.length})
        </Tab>
        <Tab active={tab === 'art48'} onClick={() => { setTab('art48'); setBusqueda(''); }}>
          🏅 Art. 48 ({art48Rows.length})
        </Tab>
        <Tab active={tab === 'papcolpo'} onClick={() => { setTab('papcolpo'); setBusqueda(''); }}>
          🔬 Pap/Colpo ({papcolpoFiltradas.length})
        </Tab>
        <Tab active={tab === 'examen'} onClick={() => { setTab('examen'); setBusqueda(''); }}>
          🩺 Examen ({examenFiltradas.length})
        </Tab>
        <Tab active={tab === 'prexamen'} onClick={() => { setTab('prexamen'); setBusqueda(''); }}>
          📋 Pre-examen ({prexamenFiltradas.length})
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
                  Agentes activos agrupados por servicio asignado
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
            {/* Tab: Artículo 48 */}
            {tab === 'art48' && (
              <>
                <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 10 }}>
                  Agentes con designación <strong style={{ color: '#c4b5fd' }}>ART. 48</strong> — {art48Rows.length} registro{art48Rows.length !== 1 ? 's' : ''} (sin filtro de mes)
                </div>
                <Busqueda value={busqueda} onChange={setBusqueda} />
                <MiniTabla rows={filtrar(art48Rows)} cols={colsArt48} />
              </>
            )}

            {/* Tab: Artículo 26 */}
            {tab === 'articulo26' && (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>Filtrando por mes:</div>
                  <select className="input" style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
                    value={mesFiltro} onChange={e => { setMesFiltro(Number(e.target.value)); setBusqueda(''); }}>
                    {mesesDisponibles.map(m => (
                      <option key={m} value={m}>{MESES[m - 1]} {AÑO_ACTUAL}</option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: '0.72rem' }}>
                    {art26Filtradas.length} registro{art26Filtradas.length !== 1 ? 's' : ''} en {MESES[mesFiltro - 1]}
                  </span>
                </div>
                <Busqueda value={busqueda} onChange={setBusqueda} />
                <MiniTabla rows={filtrar(art26Rows)} cols={colsArt26} />
              </>
            )}

            {/* Tabs: Pap/Colpo, Examen, Pre-examen */}
            {(tab === 'papcolpo' || tab === 'examen' || tab === 'prexamen') && (() => {
              const cfg = {
                papcolpo: { rows: papcolpoRows, filtradas: papcolpoFiltradas, label: 'Pap / Colposcopía' },
                examen:   { rows: examenRows,   filtradas: examenFiltradas,   label: 'Examen' },
                prexamen: { rows: prexamenRows, filtradas: prexamenFiltradas, label: 'Pre-examen' },
              }[tab];
              return (
                <>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                    <div className="muted" style={{ fontSize: '0.72rem' }}>Filtrando por mes:</div>
                    <select className="input" style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
                      value={mesFiltro} onChange={e => { setMesFiltro(Number(e.target.value)); setBusqueda(''); }}>
                      {mesesDisponibles.map(m => (
                        <option key={m} value={m}>{MESES[m - 1]} {AÑO_ACTUAL}</option>
                      ))}
                    </select>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>
                      {cfg.filtradas.length} registro{cfg.filtradas.length !== 1 ? 's' : ''} en {MESES[mesFiltro - 1]} — {cfg.label}
                    </span>
                  </div>
                  <Busqueda value={busqueda} onChange={setBusqueda} />
                  <MiniTabla rows={filtrar(cfg.rows)} cols={colsMed} />
                </>
              );
            })()}
          </>
        )}
      </div>
    </Layout>
  );
}

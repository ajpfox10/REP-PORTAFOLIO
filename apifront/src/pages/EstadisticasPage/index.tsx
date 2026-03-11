// src/pages/EstadisticasPage/index.tsx
//
// MODELO DE DATOS (según test.sql):
// - agentes: planta_id, categoria_id, ocupacion_id, regimen_horario_id, ley_id,
//            sector_id, jefatura_id, estado_empleo ENUM('ACTIVO','INACTIVO','BAJA'),
//            fecha_ingreso, fecha_baja, salario_mensual, deleted_at (soft delete)
// - personal: dni, apellido, nombre, fecha_nacimiento, sexo_id, email, telefono,
//             domicilio, localidad_id, cuil, deleted_at
// - agentes_servicios: dni, dependencia_id, servicio_nombre, fecha_desde, fecha_hasta
// - Catálogos: planta(planta_nombre), categoria(CATEGORIA), ley(ley_nombre),
//              regimenhorario(regimen_horario, estado_planta), jefaturas(sector, jefe),
//              reparticiones(reparticion_nombre), sexo(sexo_nombre), ocupacion(nombre_ocupacion)
// - Vista agentexdni1: todo joinado con nombres resueltos
// - Vista agentehistorial: historial de servicios con nombres
//
// PAGINACIÓN: el backend devuelve máx ~200 por página. Hay ~1400 agentes.
// Hay que iterar hasta meta.total o hasta que no haya más datos.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf } from '../../utils/export';

// ─── Paginación completa ───────────────────────────────────────────────────────
async function fetchAll<T = any>(
  endpoint: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<T[]> {
  const PAGE = 200;
  let page = 1;
  let all: T[] = [];
  let total = Infinity;

  while (all.length < total) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await apiFetch<any>(`${endpoint}${sep}limit=${PAGE}&page=${page}`);
    const rows: T[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total);
    else total = all.length; // sin meta → una sola página
    onProgress?.(all.length, total);
    if (rows.length < PAGE) break; // última página
    page++;
  }
  return all;
}

// ─── Formateo ─────────────────────────────────────────────────────────────────
const fmt = (n: number | null) => n === null ? '…' : n.toLocaleString('es-AR');
const pct = (n: number, total: number) =>
  total ? `${Math.round((n / total) * 100)}%` : '0%';

// ─── Componentes visuales ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="card" style={{ padding: '20px 22px', position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 4, height: '100%',
        background: color, borderRadius: '16px 0 0 16px',
      }} />
      <div style={{ paddingLeft: 10 }}>
        <div className="muted" style={{ fontSize: '0.68rem', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <div style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1, color }}>{value}</div>
        {sub && <div className="muted" style={{ fontSize: '0.73rem', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

function BarRow({ label, value, max, color, total }: {
  label: string; value: number; max: number; color: string; total: number;
}) {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
      <div title={label} style={{
        minWidth: 180, maxWidth: 180, fontSize: '0.78rem',
        textAlign: 'right', color: 'rgba(255,255,255,0.72)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label || '(sin dato)'}
      </div>
      <div style={{ flex: 1, height: 22, background: 'rgba(255,255,255,0.06)', borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          width: `${w}%`, height: '100%', background: color,
          borderRadius: 5, transition: 'width 0.7s cubic-bezier(.4,0,.2,1)', minWidth: 2,
        }} />
      </div>
      <div style={{ minWidth: 48, textAlign: 'right', fontSize: '0.82rem', fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ minWidth: 38, fontSize: '0.72rem' }}>{pct(value, total)}</div>
    </div>
  );
}

function Section({
  title, children, rows, filename, loading: sLoading,
}: {
  title: string; children: React.ReactNode;
  rows?: any[]; filename?: string; loading?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: collapsed ? 0 : 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setCollapsed(c => !c)}>
          <strong style={{ fontSize: '0.92rem' }}>{title}</strong>
          <span className="muted" style={{ fontSize: '0.72rem' }}>{collapsed ? '▼ mostrar' : '▲ ocultar'}</span>
        </div>
        {!collapsed && rows && rows.length > 0 && filename && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" style={{ fontSize: '0.7rem', padding: '3px 10px', background: '#16a34a', color: '#fff' }}
              onClick={() => exportToExcel(filename, rows)}>📊 Excel</button>
            <button className="btn" style={{ fontSize: '0.7rem', padding: '3px 10px', background: '#dc2626', color: '#fff' }}
              onClick={() => exportToPdf(filename, rows)}>📕 PDF</button>
          </div>
        )}
      </div>
      {!collapsed && (sLoading
        ? <div className="muted" style={{ fontSize: '0.8rem' }}>Cargando…</div>
        : children
      )}
    </div>
  );
}

function MiniTable({ rows, cols }: {
  rows: any[];
  cols: { key: string; label: string; date?: boolean }[];
}) {
  if (!rows.length) return <div className="muted" style={{ fontSize: '0.8rem' }}>Sin datos.</div>;
  const fmtCell = (col: typeof cols[0], val: any) => {
    if (val === null || val === undefined || val === '') return '—';
    if (col.date) try { return new Date(val).toLocaleDateString('es-AR'); } catch { return String(val); }
    return String(val);
  };
  return (
    <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
      <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0 }}>
            {cols.map(c => (
              <th key={c.key} style={{ padding: '5px 9px', textAlign: 'left', color: '#94a3b8', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {cols.map(c => (
                <td key={c.key} style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>
                  {fmtCell(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Agrupación ───────────────────────────────────────────────────────────────
function agrupar(
  arr: any[],
  campo: string,
  mapaIds?: Record<string | number, string>
): { nombre: string; total: number }[] {
  const map: Record<string, number> = {};
  for (const r of arr) {
    let k = r[campo];
    if (k === null || k === undefined || k === '') {
      k = '(sin dato)';
    } else if (mapaIds) {
      const resuelto = mapaIds[Number(k)];
      k = resuelto != null ? resuelto : `#${k}`;
    } else {
      k = String(k);
    }
    map[k] = (map[k] || 0) + 1;
  }
  return Object.entries(map)
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total);
}

function agruparPorAnio(arr: any[], campo: string): { anio: string; total: number }[] {
  const map: Record<string, number> = {};
  for (const r of arr) {
    if (!r[campo]) continue;
    const d = new Date(r[campo]);
    if (isNaN(d.getTime())) continue;
    const anio = String(d.getFullYear());
    map[anio] = (map[anio] || 0) + 1;
  }
  return Object.entries(map)
    .map(([anio, total]) => ({ anio, total }))
    .sort((a, b) => Number(a.anio) - Number(b.anio));
}

// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
interface Stats {
  agentes: any[];
  personal: any[];
  servicios: any[];
  catalogos: {
    planta: Record<number, string>;
    categoria: Record<number, string>;
    ley: Record<number, string>;
    regimen: Record<number, string>;
    jefaturas: Record<number, string>;
    reparticiones: Record<number, string>;
    sexo: Record<number, string>;
    ocupacion: Record<number, string>;
  };
  pedidosTotal: number | null;
  lastUpdate: string;
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export function EstadisticasPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ loaded: 0, total: 0, step: '' });
  const [stats, setStats] = useState<Stats | null>(null);
  const loaded = useRef(false);

  const cargar = useCallback(async (force = false) => {
    if (loaded.current && !force) return;
    loaded.current = true;
    setLoading(true);
    setProgress({ loaded: 0, total: 0, step: '' });

    try {
      // ── Catálogos (sin paginación, son pequeños) ──
      setProgress(p => ({ ...p, step: 'Cargando catálogos…' }));
      // Nombres CORRECTOS de las tablas según el schema de la BD:
      //   plantas, sexos, categorias (PK=ID), regimenes_horarios, ocupaciones
      //   ley (campo nombre), jefaturas (campo sector), reparticiones
      const [
        rPlanta, rSexo, rCategoria, rRegimen, rOcupacion,
        rLey, rJefaturas, rReparticiones,
      ] = await Promise.allSettled([
        apiFetch<any>('/plantas?limit=500&page=1'),
        apiFetch<any>('/sexos?limit=500&page=1'),
        apiFetch<any>('/categorias?limit=500&page=1'),
        apiFetch<any>('/regimenes_horarios?limit=500&page=1'),
        apiFetch<any>('/ocupaciones?limit=500&page=1'),
        apiFetch<any>('/ley?limit=500&page=1'),
        apiFetch<any>('/jefaturas?limit=500&page=1'),
        apiFetch<any>('/reparticiones?limit=500&page=1'),
      ]);

      const buildMap = (
        res: PromiseSettledResult<any>,
        idKey: string,
        nameKey: string
      ): Record<number, string> => {
        if (res.status !== 'fulfilled') return {};
        const rows = res.value?.data || res.value || [];
        const m: Record<number, string> = {};
        for (const r of rows) {
          if (r[idKey] != null) m[Number(r[idKey])] = String(r[nameKey] ?? r[idKey]);
        }
        return m;
      };

      const catalogos = {
        planta:       buildMap(rPlanta,       'id',  'nombre'),
        sexo:         buildMap(rSexo,         'id',  'nombre'),
        categoria:    buildMap(rCategoria,    'ID',  'nombre'),   // PK es ID mayúscula
        regimen:      buildMap(rRegimen,      'id',  'nombre'),
        ocupacion:    buildMap(rOcupacion,    'id',  'nombre'),
        ley:          buildMap(rLey,          'id',  'nombre'),   // campo es 'nombre' no 'ley_nombre'
        jefaturas:    buildMap(rJefaturas,    'id',  'sector'),
        reparticiones:buildMap(rReparticiones,'id',  'reparticion_nombre'),
      };

      // ── Agentes (PAGINACIÓN COMPLETA) ──
      setProgress(p => ({ ...p, step: 'Cargando agentes…' }));
      const agentes = await fetchAll('/agentes', (loaded, total) => {
        setProgress(p => ({ ...p, loaded, total, step: `Agentes: ${loaded}/${total}` }));
      });

      // ── Personal (PAGINACIÓN COMPLETA) ──
      setProgress(p => ({ ...p, step: 'Cargando personal…' }));
      const personal = await fetchAll('/personal', (loaded, total) => {
        setProgress(p => ({ ...p, loaded, total, step: `Personal: ${loaded}/${total}` }));
      });

      // ── Agentes servicios (PAGINACIÓN COMPLETA) ──
      setProgress(p => ({ ...p, step: 'Cargando servicios…' }));
      const servicios = await fetchAll('/agentes_servicios', (loaded, total) => {
        setProgress(p => ({ ...p, loaded, total, step: `Servicios: ${loaded}/${total}` }));
      });

      // ── Pedidos total ──
      let pedidosTotal: number | null = null;
      try {
        const rP = await apiFetch<any>('/pedidos?limit=1&page=1');
        pedidosTotal = rP?.meta?.total != null ? Number(rP.meta.total) : null;
      } catch { /* ignorar */ }

      setStats({
        agentes,
        personal,
        servicios,
        catalogos,
        pedidosTotal,
        lastUpdate: new Date().toLocaleTimeString('es-AR'),
      });
      toast.ok(`Estadísticas listas — ${agentes.length} agentes, ${personal.length} personas`);
    } catch (e: any) {
      toast.error('Error al cargar estadísticas', e?.message);
      loaded.current = false;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  if (loading || !stats) {
    return (
      <Layout title="Estadísticas" showBack>
        <div className="card" style={{ textAlign: 'center', padding: 56 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>⏳</div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{progress.step || 'Iniciando…'}</div>
          {progress.total > 0 && (
            <>
              <div className="muted" style={{ fontSize: '0.82rem', marginBottom: 10 }}>
                {progress.loaded} / {progress.total} registros
              </div>
              <div style={{ maxWidth: 360, margin: '0 auto', height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 99 }}>
                <div style={{
                  height: '100%', borderRadius: 99, background: '#7c3aed',
                  width: `${Math.min(100, (progress.loaded / progress.total) * 100)}%`,
                  transition: 'width 0.3s',
                }} />
              </div>
            </>
          )}
          <div className="muted" style={{ fontSize: '0.74rem', marginTop: 14 }}>
            Se están cargando TODOS los registros paginando la API…
          </div>
        </div>
      </Layout>
    );
  }

  const { agentes, personal, servicios, catalogos, pedidosTotal, lastUpdate } = stats;
  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;

  // ── Derivados principales ──
  const activos = agentes.filter(a => a.estado_empleo === 'ACTIVO');
  const inactivos = agentes.filter(a => a.estado_empleo === 'INACTIVO');
  const bajas = agentes.filter(a => a.estado_empleo === 'BAJA');
  const conEmail = personal.filter(p => p.email && p.email.trim() !== '');
  const conTelefono = personal.filter(p => p.telefono && p.telefono.trim() !== '');
  const conDomicilio = personal.filter(p => p.domicilio && p.domicilio.trim() !== '');
  const conCuil = personal.filter(p => p.cuil && p.cuil.trim() !== '');

  // Antigüedad
  const calcAnios = (fi: string) => {
    if (!fi) return 0;
    const d = new Date(fi);
    if (isNaN(d.getTime())) return 0;
    return anioActual - d.getFullYear() -
      (hoy < new Date(anioActual, d.getMonth(), d.getDate()) ? 1 : 0);
  };

  const activosConFecha = activos.filter(a => a.fecha_ingreso);
  const antig20plus = activosConFecha.filter(a => calcAnios(a.fecha_ingreso) >= 20);
  const antig10_19 = activosConFecha.filter(a => { const n = calcAnios(a.fecha_ingreso); return n >= 10 && n < 20; });
  const antig5_9 = activosConFecha.filter(a => { const n = calcAnios(a.fecha_ingreso); return n >= 5 && n < 10; });
  const antig0_4 = activosConFecha.filter(a => calcAnios(a.fecha_ingreso) < 5);

  // Ingresos este año
  const ingresosAnioActual = agentes.filter(a => a.fecha_ingreso && new Date(a.fecha_ingreso).getFullYear() === anioActual);

  // Cumpleaños este mes
  const cumpleMes = personal.filter(p => {
    if (!p.fecha_nacimiento) return false;
    return new Date(p.fecha_nacimiento).getMonth() + 1 === mesActual;
  });

  // Aniversarios de ingreso este mes
  const antigMes = agentes.filter(a => {
    if (!a.fecha_ingreso) return false;
    return new Date(a.fecha_ingreso).getMonth() + 1 === mesActual;
  });

  // Salarios
  const conSalario = agentes.filter(a => a.salario_mensual && Number(a.salario_mensual) > 0);
  const salarios = conSalario.map(a => Number(a.salario_mensual));
  const salarioPromedio = salarios.length ? Math.round(salarios.reduce((s, n) => s + n, 0) / salarios.length) : 0;
  const salarioMax = salarios.length ? Math.max(...salarios) : 0;
  const salarioMin = salarios.length ? Math.min(...salarios) : 0;

  // ── Agrupaciones con nombres resueltos ──
  const porEstado = agrupar(agentes, 'estado_empleo');
  const porLey = agrupar(agentes, 'ley_id', catalogos.ley);
  const porPlanta = agrupar(agentes, 'planta_id', catalogos.planta);
  const porCategoria = agrupar(agentes, 'categoria_id', catalogos.categoria);
  const porRegimen = agrupar(agentes, 'regimen_horario_id', catalogos.regimen);
  const porJefatura = agrupar(agentes, 'jefatura_id', catalogos.jefaturas);
  const porSector = agrupar(agentes, 'sector_id', catalogos.reparticiones);
  const porOcupacion = agrupar(agentes, 'ocupacion_id', catalogos.ocupacion);
  const porSexo = agrupar(personal, 'sexo_id', catalogos.sexo);

  // Servicios: agrupación por servicio_nombre y por dependencia
  const porServicio = agrupar(servicios, 'servicio_nombre').slice(0, 30);
  const porDependencia = agrupar(servicios, 'dependencia_id', catalogos.reparticiones).slice(0, 20);
  // Solo servicios ACTUALES (sin fecha_hasta o fecha_hasta null = destino actual)
  const serviciosActuales = servicios.filter(s => !s.fecha_hasta);
  const porServicioActual = agrupar(serviciosActuales, 'servicio_nombre').slice(0, 30);

  // Ingresos por año
  const ingresosPorAnio = agruparPorAnio(agentes, 'fecha_ingreso');
  const bajasPorAnio = agruparPorAnio(bajas, 'fecha_baja');

  // Nacimientos por mes
  const cumplePorMes = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const count = personal.filter(p => p.fecha_nacimiento && new Date(p.fecha_nacimiento).getMonth() + 1 === m).length;
    return { nombre: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][i], total: count };
  });

  // Aniversarios por mes
  const antigPorMes = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const count = agentes.filter(a => a.fecha_ingreso && new Date(a.fecha_ingreso).getMonth() + 1 === m).length;
    return { nombre: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][i], total: count };
  });

  // Antigüedad por tramos
  const tramos = [
    { nombre: 'Menos de 1 año', total: activosConFecha.filter(a => calcAnios(a.fecha_ingreso) < 1).length },
    { nombre: '1 a 4 años', total: activosConFecha.filter(a => { const n = calcAnios(a.fecha_ingreso); return n >= 1 && n < 5; }).length },
    { nombre: '5 a 9 años', total: antig5_9.length },
    { nombre: '10 a 19 años', total: antig10_19.length },
    { nombre: '20 a 29 años', total: activosConFecha.filter(a => { const n = calcAnios(a.fecha_ingreso); return n >= 20 && n < 30; }).length },
    { nombre: '30+ años', total: activosConFecha.filter(a => calcAnios(a.fecha_ingreso) >= 30).length },
  ];

  const COLORES = ['#7c3aed','#2563eb','#10b981','#f59e0b','#ec4899','#06b6d4','#a3e635','#fb923c','#ef4444','#8b5cf6'];

  // ── Listados exportables ──
  const cumpleMesExport = cumpleMes.map(p => ({
    DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre,
    Nacimiento: p.fecha_nacimiento ? new Date(p.fecha_nacimiento).toLocaleDateString('es-AR') : '',
    Día: p.fecha_nacimiento ? new Date(p.fecha_nacimiento).getDate() : '',
    Email: p.email || '', Telefono: p.telefono || '',
  })).sort((a, b) => Number(a.Día) - Number(b.Día));

  const antigMesExport = antigMes.map(a => ({
    DNI: a.dni, Estado: a.estado_empleo,
    'Fecha Ingreso': a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '',
    'Años Antigüedad': calcAnios(a.fecha_ingreso),
    Ley: catalogos.ley[a.ley_id] || a.ley_id || '',
    Planta: catalogos.planta[a.planta_id] || a.planta_id || '',
  })).sort((a, b) => b['Años Antigüedad'] - a['Años Antigüedad']);

  const antig20Export = antig20plus.map(a => ({
    DNI: a.dni, Estado: a.estado_empleo,
    'Fecha Ingreso': a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '',
    'Años Antigüedad': calcAnios(a.fecha_ingreso),
    Ley: catalogos.ley[a.ley_id] || a.ley_id || '',
    Planta: catalogos.planta[a.planta_id] || a.planta_id || '',
    Sector: catalogos.reparticiones[a.sector_id] || a.sector_id || '',
    Jefatura: catalogos.jefaturas[a.jefatura_id] || a.jefatura_id || '',
  }));

  const ingresosAnioExport = ingresosAnioActual.map(a => ({
    DNI: a.dni, Estado: a.estado_empleo,
    'Fecha Ingreso': a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '',
    Ley: catalogos.ley[a.ley_id] || a.ley_id || '',
    Planta: catalogos.planta[a.planta_id] || a.planta_id || '',
    Jefatura: catalogos.jefaturas[a.jefatura_id] || a.jefatura_id || '',
  }));

  const sinEmailExport = personal.filter(p => !p.email || !p.email.trim()).map(p => ({
    DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre, Teléfono: p.telefono || '',
  }));

  return (
    <Layout title="Estadísticas" showBack>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: '1.1rem' }}>📊 Panel de estadísticas del personal</strong>
          <div className="muted" style={{ fontSize: '0.73rem', marginTop: 2 }}>
            Última actualización: {lastUpdate} · {agentes.length} agentes · {personal.length} personas
          </div>
        </div>
        <button className="btn" onClick={() => { loaded.current = false; cargar(true); }}
          style={{ fontSize: '0.82rem' }}>🔄 Actualizar</button>
      </div>

      {/* ── KPIs estado ── */}
      <Section title="👥 Resumen general"
        rows={[
          { Indicador: 'Total agentes en sistema', Cantidad: agentes.length },
          { Indicador: 'ACTIVOS', Cantidad: activos.length, Porcentaje: pct(activos.length, agentes.length) },
          { Indicador: 'INACTIVOS', Cantidad: inactivos.length, Porcentaje: pct(inactivos.length, agentes.length) },
          { Indicador: 'BAJA', Cantidad: bajas.length, Porcentaje: pct(bajas.length, agentes.length) },
          { Indicador: 'Personal (tabla personal)', Cantidad: personal.length },
          { Indicador: 'Con e-mail registrado', Cantidad: conEmail.length, Porcentaje: pct(conEmail.length, personal.length) },
          { Indicador: 'Con teléfono registrado', Cantidad: conTelefono.length, Porcentaje: pct(conTelefono.length, personal.length) },
          { Indicador: 'Con domicilio registrado', Cantidad: conDomicilio.length, Porcentaje: pct(conDomicilio.length, personal.length) },
          { Indicador: 'Con CUIL registrado', Cantidad: conCuil.length, Porcentaje: pct(conCuil.length, personal.length) },
          { Indicador: 'Ingresos este año', Cantidad: ingresosAnioActual.length },
          { Indicador: 'Cumpleaños este mes', Cantidad: cumpleMes.length },
          { Indicador: 'Aniversarios de ingreso este mes', Cantidad: antigMes.length },
          { Indicador: 'Antigüedad +20 años (activos)', Cantidad: antig20plus.length },
          { Indicador: 'Pedidos totales', Cantidad: pedidosTotal ?? '' },
        ]}
        filename="estadisticas_resumen_general">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 8 }}>
          <StatCard label="Total agentes" value={fmt(agentes.length)} color="#7c3aed" />
          <StatCard label="ACTIVOS" value={fmt(activos.length)} sub={pct(activos.length, agentes.length)} color="#10b981" />
          <StatCard label="INACTIVOS" value={fmt(inactivos.length)} sub={pct(inactivos.length, agentes.length)} color="#f59e0b" />
          <StatCard label="BAJA" value={fmt(bajas.length)} sub={pct(bajas.length, agentes.length)} color="#ef4444" />
          <StatCard label="Personal" value={fmt(personal.length)} color="#2563eb" />
          <StatCard label="Antigüedad +20 años" value={fmt(antig20plus.length)} sub="activos" color="#f97316" />
          <StatCard label="Ingresos este año" value={fmt(ingresosAnioActual.length)} color="#8b5cf6" />
          <StatCard label="Pedidos totales" value={pedidosTotal !== null ? fmt(pedidosTotal) : '—'} color="#ec4899" />
          <StatCard label="Cumpleaños este mes" value={fmt(cumpleMes.length)} color="#06b6d4" />
          <StatCard label="Aniversarios este mes" value={fmt(antigMes.length)} color="#a3e635" />
          <StatCard label="Con e-mail" value={fmt(conEmail.length)} sub={pct(conEmail.length, personal.length)} color="#22d3ee" />
          <StatCard label="Con teléfono" value={fmt(conTelefono.length)} sub={pct(conTelefono.length, personal.length)} color="#fb923c" />
        </div>
      </Section>

      {/* ── Por estado de empleo ── */}
      <Section title="🟢 Agentes por estado de empleo" rows={porEstado} filename="estadisticas_estado_empleo">
        {porEstado.map((d, i) => (
          <BarRow key={d.nombre} label={d.nombre} value={d.total}
            max={porEstado[0]?.total || 1} color={['#10b981','#f59e0b','#ef4444'][i] || COLORES[i]}
            total={agentes.length} />
        ))}
      </Section>

      {/* ── Por ley ── */}
      {porLey.length > 0 && (
        <Section title="📜 Agentes por ley" rows={porLey} filename="estadisticas_por_ley">
          {porLey.map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porLey[0]?.total || 1} color={COLORES[i % COLORES.length]} total={agentes.length} />
          ))}
        </Section>
      )}

      {/* ── Por planta ── */}
      {porPlanta.length > 0 && (
        <Section title="🌱 Agentes por planta" rows={porPlanta} filename="estadisticas_por_planta">
          {porPlanta.map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porPlanta[0]?.total || 1} color={COLORES[i % COLORES.length]} total={agentes.length} />
          ))}
        </Section>
      )}

      {/* ── Por régimen horario ── */}
      {porRegimen.length > 0 && (
        <Section title="🕐 Agentes por régimen horario" rows={porRegimen} filename="estadisticas_por_regimen">
          {porRegimen.map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porRegimen[0]?.total || 1} color={COLORES[i % COLORES.length]} total={agentes.length} />
          ))}
        </Section>
      )}

      {/* ── Por categoría ── */}
      {porCategoria.length > 0 && (
        <Section title="🏷️ Agentes por categoría" rows={porCategoria} filename="estadisticas_por_categoria">
          {porCategoria.slice(0, 30).map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porCategoria[0]?.total || 1} color={COLORES[i % COLORES.length]} total={agentes.length} />
          ))}
        </Section>
      )}

      {/* ── Por jefatura ── */}
      {porJefatura.length > 0 && (
        <Section title="👤 Agentes por jefatura" rows={porJefatura} filename="estadisticas_por_jefatura">
          {porJefatura.slice(0, 25).map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porJefatura[0]?.total || 1} color={COLORES[i % COLORES.length]} total={agentes.length} />
          ))}
        </Section>
      )}

      {/* ── Por sector (reparticion) ── */}
      {porSector.length > 0 && (
        <Section title="📍 Agentes por sector / repartición" rows={porSector} filename="estadisticas_por_sector">
          {porSector.slice(0, 25).map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porSector[0]?.total || 1} color={COLORES[i % COLORES.length]} total={agentes.length} />
          ))}
        </Section>
      )}

      {/* ── Por ocupación ── */}
      {porOcupacion.length > 0 && (
        <Section title="💼 Agentes por ocupación" rows={porOcupacion} filename="estadisticas_por_ocupacion">
          {porOcupacion.slice(0, 25).map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porOcupacion[0]?.total || 1} color={COLORES[i % COLORES.length]} total={agentes.length} />
          ))}
        </Section>
      )}

      {/* ── Por servicio ACTUAL (agentes_servicios sin fecha_hasta) ── */}
      {porServicioActual.length > 0 && (
        <Section title="🏢 Agentes por servicio actual (sin fecha de baja)" rows={porServicioActual} filename="estadisticas_por_servicio_actual">
          {porServicioActual.map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porServicioActual[0]?.total || 1} color={COLORES[i % COLORES.length]} total={serviciosActuales.length} />
          ))}
        </Section>
      )}

      {/* ── Por servicio HISTÓRICO ── */}
      {porServicio.length > 0 && (
        <Section title="🗂️ Agentes por servicio (historial completo)" rows={porServicio} filename="estadisticas_por_servicio_historial">
          {porServicio.map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porServicio[0]?.total || 1} color={COLORES[i % COLORES.length]} total={servicios.length} />
          ))}
        </Section>
      )}

      {/* ── Por dependencia ── */}
      {porDependencia.length > 0 && (
        <Section title="🏛️ Agentes por dependencia" rows={porDependencia} filename="estadisticas_por_dependencia">
          {porDependencia.map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porDependencia[0]?.total || 1} color={COLORES[i % COLORES.length]} total={servicios.length} />
          ))}
        </Section>
      )}

      {/* ── Por sexo ── */}
      {porSexo.length > 0 && (
        <Section title="⚥ Personal por sexo" rows={porSexo} filename="estadisticas_por_sexo">
          {porSexo.map((d, i) => (
            <BarRow key={d.nombre} label={d.nombre} value={d.total}
              max={porSexo[0]?.total || 1} color={COLORES[i % COLORES.length]} total={personal.length} />
          ))}
        </Section>
      )}

      {/* ── Tramos de antigüedad ── */}
      <Section title="🕰️ Antigüedad por tramos (activos con fecha de ingreso)"
        rows={tramos} filename="estadisticas_tramos_antiguedad">
        {tramos.map((d, i) => (
          <BarRow key={d.nombre} label={d.nombre} value={d.total}
            max={Math.max(...tramos.map(t => t.total), 1)} color={COLORES[i]} total={activosConFecha.length} />
        ))}
      </Section>

      {/* ── Ingresos por año ── */}
      {ingresosPorAnio.length > 0 && (
        <Section title="📅 Ingresos por año" rows={ingresosPorAnio} filename="estadisticas_ingresos_por_anio">
          {ingresosPorAnio.map((d, i) => (
            <BarRow key={d.anio} label={d.anio} value={d.total}
              max={Math.max(...ingresosPorAnio.map(x => x.total), 1)} color="#2563eb" total={agentes.length} />
          ))}
        </Section>
      )}

      {/* ── Bajas por año ── */}
      {bajasPorAnio.length > 0 && (
        <Section title="📉 Bajas por año" rows={bajasPorAnio} filename="estadisticas_bajas_por_anio">
          {bajasPorAnio.map((d, i) => (
            <BarRow key={d.anio} label={d.anio} value={d.total}
              max={Math.max(...bajasPorAnio.map(x => x.total), 1)} color="#ef4444" total={bajas.length} />
          ))}
        </Section>
      )}

      {/* ── Cumpleaños por mes ── */}
      <Section title="🎂 Cumpleaños por mes" rows={cumplePorMes} filename="estadisticas_cumpleanos_por_mes">
        {cumplePorMes.map((d, i) => (
          <BarRow key={d.nombre} label={d.nombre} value={d.total}
            max={Math.max(...cumplePorMes.map(x => x.total), 1)}
            color={i === mesActual - 1 ? '#f97316' : '#06b6d4'} total={personal.filter(p => p.fecha_nacimiento).length} />
        ))}
      </Section>

      {/* ── Aniversarios de ingreso por mes ── */}
      <Section title="🏅 Aniversarios de ingreso por mes" rows={antigPorMes} filename="estadisticas_aniversarios_por_mes">
        {antigPorMes.map((d, i) => (
          <BarRow key={d.nombre} label={d.nombre} value={d.total}
            max={Math.max(...antigPorMes.map(x => x.total), 1)}
            color={i === mesActual - 1 ? '#a3e635' : '#8b5cf6'} total={activosConFecha.length} />
        ))}
      </Section>

      {/* ── Salarios ── */}
      {conSalario.length > 0 && (
        <Section title="💰 Salarios"
          rows={[
            { Indicador: 'Con salario registrado', Cantidad: conSalario.length },
            { Indicador: 'Salario promedio', Cantidad: `$${salarioPromedio.toLocaleString('es-AR')}` },
            { Indicador: 'Salario máximo', Cantidad: `$${salarioMax.toLocaleString('es-AR')}` },
            { Indicador: 'Salario mínimo', Cantidad: `$${salarioMin.toLocaleString('es-AR')}` },
          ]}
          filename="estadisticas_salarios">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            <StatCard label="Con salario registrado" value={fmt(conSalario.length)} color="#10b981" />
            <StatCard label="Promedio mensual" value={`$${salarioPromedio.toLocaleString('es-AR')}`} color="#2563eb" />
            <StatCard label="Máximo" value={`$${salarioMax.toLocaleString('es-AR')}`} color="#f59e0b" />
            <StatCard label="Mínimo" value={`$${salarioMin.toLocaleString('es-AR')}`} color="#7c3aed" />
          </div>
        </Section>
      )}

      {/* ── Listado: cumpleaños este mes ── */}
      {cumpleMes.length > 0 && (
        <Section title={`🎂 Listado cumpleaños ${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][mesActual-1]} (${cumpleMes.length})`}
          rows={cumpleMesExport} filename={`cumpleanos_${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][mesActual-1]}`}>
          <MiniTable rows={cumpleMesExport} cols={[
            { key: 'Día', label: 'Día' },
            { key: 'DNI', label: 'DNI' },
            { key: 'Apellido', label: 'Apellido' },
            { key: 'Nombre', label: 'Nombre' },
            { key: 'Email', label: 'Email' },
            { key: 'Telefono', label: 'Teléfono' },
          ]} />
        </Section>
      )}

      {/* ── Listado: aniversarios ingreso este mes ── */}
      {antigMes.length > 0 && (
        <Section title={`🏅 Aniversarios de ingreso este mes (${antigMes.length})`}
          rows={antigMesExport} filename="aniversarios_ingreso_mes_actual">
          <MiniTable rows={antigMesExport} cols={[
            { key: 'DNI', label: 'DNI' },
            { key: 'Fecha Ingreso', label: 'Ingreso', date: false },
            { key: 'Años Antigüedad', label: 'Años' },
            { key: 'Estado', label: 'Estado' },
            { key: 'Ley', label: 'Ley' },
          ]} />
        </Section>
      )}

      {/* ── Listado: antigüedad 20+ años ── */}
      {antig20plus.length > 0 && (
        <Section title={`🎖️ Agentes con 20+ años de antigüedad (${antig20plus.length})`}
          rows={antig20Export} filename="agentes_20_anios_o_mas">
          <MiniTable rows={antig20Export} cols={[
            { key: 'DNI', label: 'DNI' },
            { key: 'Años Antigüedad', label: 'Años' },
            { key: 'Fecha Ingreso', label: 'Ingreso' },
            { key: 'Estado', label: 'Estado' },
            { key: 'Ley', label: 'Ley' },
            { key: 'Planta', label: 'Planta' },
            { key: 'Sector', label: 'Sector' },
          ]} />
        </Section>
      )}

      {/* ── Listado: ingresos este año ── */}
      {ingresosAnioActual.length > 0 && (
        <Section title={`🟢 Ingresos en ${anioActual} (${ingresosAnioActual.length})`}
          rows={ingresosAnioExport} filename={`ingresos_${anioActual}`}>
          <MiniTable rows={ingresosAnioExport} cols={[
            { key: 'DNI', label: 'DNI' },
            { key: 'Fecha Ingreso', label: 'Fecha Ingreso' },
            { key: 'Estado', label: 'Estado' },
            { key: 'Ley', label: 'Ley' },
            { key: 'Planta', label: 'Planta' },
            { key: 'Jefatura', label: 'Jefatura' },
          ]} />
        </Section>
      )}

      {/* ── Sin email ── */}
      {sinEmailExport.length > 0 && (
        <Section title={`📧 Sin email registrado (${sinEmailExport.length})`}
          rows={sinEmailExport} filename="agentes_sin_email">
          <div className="muted" style={{ fontSize: '0.82rem' }}>
            {sinEmailExport.length} personas sin e-mail. Exportá a Excel para trabajar la lista.
          </div>
        </Section>
      )}
    </Layout>
  );
}

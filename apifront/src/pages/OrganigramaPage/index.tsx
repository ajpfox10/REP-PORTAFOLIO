// src/pages/OrganigramaPage/index.tsx
// Jerarquía: Servicio → Sector
// - Admin/usuario: ve todos los servicios y sectores
// - Jefe de servicio: ve solo su servicio (filtrado por session.user.servicio_id)

import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { useAuth } from '../../auth/AuthProvider';
import { hasPermission } from '../../auth/permissions';
import { exportToExcel } from '../../utils/export';

async function fetchAll<T = any>(endpoint: string): Promise<T[]> {
  const PAGE = 200;
  let page = 1, all: T[] = [], total = Infinity;
  while (all.length < total) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await apiFetch<any>(`${endpoint}${sep}limit=${PAGE}&page=${page}`);
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

function buildMap(rows: any[], idKey: string, nameKey: string): Record<number, string> {
  const m: Record<number, string> = {};
  for (const r of rows) m[Number(r[idKey])] = String(r[nameKey] ?? r[idKey]);
  return m;
}

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Grupo { id: string; label: string; count: number; agentes: any[] }

interface GrupoJerarquico {
  id: string;
  label: string;
  count: number;           // total del servicio
  sectores: Grupo[];       // sub-grupos por sector dentro del servicio
}

// ── Funciones de agrupación ───────────────────────────────────────────────────

function agrupar(
  agentes: any[], campo: string, mapaIds?: Record<number, string>
): Grupo[] {
  const map: Record<string, Grupo> = {};
  for (const a of agentes) {
    let k = a[campo];
    const rawK = k;
    if (k === null || k === undefined || k === '') k = '(sin asignar)';
    else if (mapaIds) k = mapaIds[Number(rawK)] ?? `ID ${rawK}`;
    if (!map[String(k)]) map[String(k)] = { id: String(rawK ?? ''), label: String(k), count: 0, agentes: [] };
    map[String(k)].count++;
    map[String(k)].agentes.push(a);
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

/**
 * Agrupa por servicio y dentro de cada servicio por sector.
 *
 * - pasesServicio: registros activos de agentes_servicios (fuente de quién está en qué servicio)
 * - pasesSector:  registros activos de agentes_sectores   (fuente del sector actual de cada agente)
 *
 * Cada registro de pasesServicio representa UN agente en UN servicio.
 * Buscamos su sector activo en pasesSector (mismo dni, mismo servicio_id, sin fecha_hasta).
 */
function agruparJerarquico(
  pasesServicio: any[],
  pasesSector: any[],
  mapaServicios: Record<number, string>,
  mapaSectores: Record<number, string>,
): GrupoJerarquico[] {
  // Mapa dni+servicio → sector_id activo (de agentes_sectores)
  // Clave: "dni_servicioId"
  const sectorActivo: Record<string, number | null> = {};
  for (const ps of pasesSector) {
    if (ps.fecha_hasta) continue; // solo activos
    const key = `${ps.dni}_${ps.servicio_id ?? ''}`;
    sectorActivo[key] = Number(ps.sector_id);
  }

  // Agrupar por servicio
  const porServicio: Record<string, { label: string; registros: Array<any & { _sector_id: number | null }> }> = {};
  for (const r of pasesServicio) {
    const srvRaw = r.servicio_id;
    const srvKey = srvRaw != null && srvRaw !== '' ? String(srvRaw) : '__sin__';
    const srvLabel = srvRaw != null && srvRaw !== ''
      ? (mapaServicios[Number(srvRaw)] ?? `Servicio #${srvRaw}`)
      : '(sin servicio)';
    if (!porServicio[srvKey]) porServicio[srvKey] = { label: srvLabel, registros: [] };
    // Inyectar sector activo del agente en este servicio
    const secKey = `${r.dni}_${srvRaw ?? ''}`;
    porServicio[srvKey].registros.push({ ...r, _sector_id: sectorActivo[secKey] ?? null });
  }

  // Para cada servicio, agrupar por sector (usando _sector_id)
  const resultado: GrupoJerarquico[] = Object.entries(porServicio).map(([srvKey, srv]) => {
    const sectores = agrupar(srv.registros, '_sector_id', mapaSectores);
    return {
      id: srvKey,
      label: srv.label,
      count: srv.registros.length,
      sectores,
    };
  });

  return resultado.sort((a, b) => b.count - a.count);
}

// ── Colores ───────────────────────────────────────────────────────────────────

const COLORES = ['#7c3aed','#2563eb','#10b981','#f59e0b','#ec4899','#06b6d4','#a3e635','#fb923c','#ef4444','#8b5cf6','#22d3ee','#f472b6'];

// ── Card de sector (sub-grupo dentro de un servicio) ──────────────────────────

function SectorCard({ sector, color, mapaPersonal }: {
  sector: Grupo; color: string; mapaPersonal: Record<number, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        borderRadius: 8, background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${color}22`, cursor: 'pointer', userSelect: 'none',
      }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: '0.82rem', color: '#cbd5e1' }}>{sector.label}</div>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', minWidth: 32, textAlign: 'right' }}>{sector.count}</div>
        <span className="muted" style={{ fontSize: '0.68rem', marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginLeft: 24, marginTop: 2, maxHeight: 200, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th style={{ padding: '2px 6px', textAlign: 'left', color: '#94a3b8' }}>DNI</th>
                <th style={{ padding: '2px 6px', textAlign: 'left', color: '#94a3b8' }}>Apellido y Nombre</th>
                <th style={{ padding: '2px 6px', textAlign: 'left', color: '#94a3b8' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {sector.agentes.slice(0, 100).map((a, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '2px 6px' }}>{a.dni}</td>
                  <td style={{ padding: '2px 6px' }}>{mapaPersonal[Number(a.dni)] || '—'}</td>
                  <td style={{ padding: '2px 6px' }}>{a.estado_empleo || a.estado || '—'}</td>
                </tr>
              ))}
              {sector.agentes.length > 100 && (
                <tr><td colSpan={3} style={{ padding: '3px 6px', color: '#94a3b8', fontSize: '0.7rem' }}>
                  + {sector.agentes.length - 100} más…
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Card de servicio (con sectores anidados) ──────────────────────────────────

function ServicioCard({ grupo, color, totalGlobal, mapaPersonal }: {
  grupo: GrupoJerarquico; color: string; totalGlobal: number;
  mapaPersonal: Record<number, string>;
}) {
  const [open, setOpen] = useState(false);
  const pct = totalGlobal ? Math.round((grupo.count / totalGlobal) * 100) : 0;

  const exportRows = grupo.sectores.flatMap(s =>
    s.agentes.map(a => ({
      DNI: a.dni,
      Apellido_Nombre: mapaPersonal[Number(a.dni)] || '',
      Sector: s.label,
      Estado: a.estado_empleo || a.estado || '',
      'Fecha Desde': a.fecha_desde ? new Date(a.fecha_desde).toLocaleDateString('es-AR') : '',
    }))
  );

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderRadius: 10, background: 'rgba(255,255,255,0.05)',
        border: `1px solid ${color}44`, cursor: 'pointer', userSelect: 'none',
      }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {grupo.label}
          </div>
          <div className="muted" style={{ fontSize: '0.7rem', marginTop: 1 }}>
            {grupo.sectores.length} sector{grupo.sectores.length !== 1 ? 'es' : ''}
          </div>
        </div>
        <div style={{ width: 120, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, minWidth: 2 }} />
        </div>
        <div style={{ minWidth: 40, textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>{grupo.count}</div>
        <div className="muted" style={{ minWidth: 36, fontSize: '0.72rem' }}>{pct}%</div>
        <button onClick={e => { e.stopPropagation(); exportToExcel(`servicio_${grupo.label.substring(0,20)}`, exportRows); }}
          style={{ background: '#16a34a33', color: '#16a34a', border: '1px solid #16a34a55', borderRadius: 6, padding: '2px 8px', fontSize: '0.68rem', cursor: 'pointer' }}>
          Excel
        </button>
        <span className="muted" style={{ fontSize: '0.72rem' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginLeft: 24, marginTop: 4 }}>
          {grupo.sectores.map((s, i) => (
            <SectorCard key={s.id} sector={s} color={COLORES[(i + 1) % COLORES.length]} mapaPersonal={mapaPersonal} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card plana (para vistas no jerárquicas) ───────────────────────────────────

function GrupoCard({ grupo, color, total, mapaPersonal }: {
  grupo: Grupo; color: string; total: number;
  mapaPersonal: Record<number, string>;
}) {
  const [open, setOpen] = useState(false);
  const pct = total ? Math.round((grupo.count / total) * 100) : 0;
  const exportRows = grupo.agentes.map(a => ({
    DNI: a.dni,
    Apellido_Nombre: mapaPersonal[Number(a.dni)] || '',
    Estado: a.estado_empleo || a.estado || '',
    'Fecha Ingreso': a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '',
  }));

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderRadius: 10, background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${color}33`, cursor: 'pointer', userSelect: 'none',
      }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {grupo.label}
          </div>
        </div>
        <div style={{ width: 120, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, minWidth: 2 }} />
        </div>
        <div style={{ minWidth: 40, textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>{grupo.count}</div>
        <div className="muted" style={{ minWidth: 36, fontSize: '0.72rem' }}>{pct}%</div>
        <button onClick={e => { e.stopPropagation(); exportToExcel(`grupo_${grupo.label.substring(0,20)}`, exportRows); }}
          style={{ background: '#16a34a33', color: '#16a34a', border: '1px solid #16a34a55', borderRadius: 6, padding: '2px 8px', fontSize: '0.68rem', cursor: 'pointer' }}>
          Excel
        </button>
        <span className="muted" style={{ fontSize: '0.72rem' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginLeft: 32, marginTop: 4, maxHeight: 250, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th style={{ padding: '3px 8px', textAlign: 'left', color: '#94a3b8' }}>DNI</th>
                <th style={{ padding: '3px 8px', textAlign: 'left', color: '#94a3b8' }}>Apellido y Nombre</th>
                <th style={{ padding: '3px 8px', textAlign: 'left', color: '#94a3b8' }}>Estado</th>
                <th style={{ padding: '3px 8px', textAlign: 'left', color: '#94a3b8' }}>Ingreso</th>
              </tr>
            </thead>
            <tbody>
              {grupo.agentes.slice(0, 100).map((a, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '3px 8px' }}>{a.dni}</td>
                  <td style={{ padding: '3px 8px' }}>{mapaPersonal[Number(a.dni)] || '—'}</td>
                  <td style={{ padding: '3px 8px' }}>{a.estado_empleo || a.estado || '—'}</td>
                  <td style={{ padding: '3px 8px' }}>{a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '—'}</td>
                </tr>
              ))}
              {grupo.agentes.length > 100 && (
                <tr><td colSpan={4} style={{ padding: '4px 8px', color: '#94a3b8', fontSize: '0.72rem' }}>
                  + {grupo.agentes.length - 100} más…
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tipos de vista ────────────────────────────────────────────────────────────

type Vista = 'ley' | 'jefatura' | 'sector' | 'planta' | 'regimen' | 'servicio';

// ── Componente principal ──────────────────────────────────────────────────────

export function OrganigramaPage() {
  const toast = useToast();
  const { session } = useAuth();
  const u: any = session?.user || {};
  const perms: string[] = session?.permissions ?? [];

  // admin (crud:*:*) ve TODO; jefe ve solo su servicio
  const isGlobal = hasPermission(perms, 'crud:*:*');
  const miServicioId: number | null = u?.servicio_id ?? null;

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState('');
  const [agentes, setAgentes] = useState<any[]>([]);
  const [serviciosAsignados, setServiciosAsignados] = useState<any[]>([]);
  const [sectoresAsignados, setSectoresAsignados] = useState<any[]>([]);
  const [mapaPersonal, setMapaPersonal] = useState<Record<number, string>>({});
  const [catalogos, setCatalogos] = useState<{
    ley: Record<number,string>; jefaturas: Record<number,string>;
    reparticiones: Record<number,string>; planta: Record<number,string>;
    regimen: Record<number,string>; servicios: Record<number,string>;
    sectores: Record<number,string>;
  }>({ ley: {}, jefaturas: {}, reparticiones: {}, planta: {}, regimen: {}, servicios: {}, sectores: {} });
  const [vista, setVista] = useState<Vista>('servicio');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setStep('Catálogos…');
      const [rLey, rJef, rRep, rPlanta, rReg, rSrv, rSec] = await Promise.allSettled([
        apiFetch<any>('/ley?limit=200&page=1'),
        apiFetch<any>('/jefaturas?limit=200&page=1'),
        apiFetch<any>('/reparticiones?limit=200&page=1'),
        apiFetch<any>('/plantas?limit=200&page=1'),
        apiFetch<any>('/regimenes_horarios?limit=200&page=1'),
        apiFetch<any>('/servicios?limit=200&page=1'),
        apiFetch<any>('/sectores?limit=500&page=1'),
      ]);
      setCatalogos({
        ley:          rLey.status    === 'fulfilled' ? buildMap(rLey.value?.data    || [], 'id', 'nombre') : {},
        jefaturas:    rJef.status    === 'fulfilled' ? buildMap(rJef.value?.data    || [], 'id', 'sector') : {},
        reparticiones:rRep.status    === 'fulfilled' ? buildMap(rRep.value?.data    || [], 'id', 'reparticion_nombre') : {},
        planta:       rPlanta.status === 'fulfilled' ? buildMap(rPlanta.value?.data || [], 'id', 'nombre') : {},
        regimen:      rReg.status    === 'fulfilled' ? buildMap(rReg.value?.data    || [], 'id', 'nombre') : {},
        servicios:    rSrv.status    === 'fulfilled' ? buildMap(rSrv.value?.data    || [], 'id', 'nombre') : {},
        sectores:     rSec.status    === 'fulfilled' ? buildMap(rSec.value?.data    || [], 'id', 'nombre') : {},
      });

      setStep('Agentes…');
      const a = await fetchAll('/agentes');
      setAgentes(a);

      setStep('Servicios asignados…');
      const s = await fetchAll('/agentes_servicios');
      setServiciosAsignados(s);

      setStep('Sectores asignados…');
      const sec = await fetchAll('/agentes_sectores');
      setSectoresAsignados(sec);

      setStep('Nombres…');
      const p = await fetchAll('/personal?fields=dni,apellido,nombre');
      const mapa: Record<number, string> = {};
      for (const r of p) {
        const dni = Number(r.dni);
        if (dni) mapa[dni] = `${r.apellido || ''}, ${r.nombre || ''}`.trim().replace(/^,\s*/, '');
      }
      setMapaPersonal(mapa);

      toast.ok(`${a.length} agentes cargados`);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
      setStep('');
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  // Pases activos: los que no tienen fecha de cierre
  const pasesActivos = serviciosAsignados.filter(s => !s.fecha_hasta);

  // Si es jefe (no global), filtrar solo su servicio
  const pasesVisibles = isGlobal
    ? pasesActivos
    : pasesActivos.filter(s => miServicioId != null && Number(s.servicio_id) === miServicioId);

  // Sectores activos (agentes_sectores sin fecha_hasta), filtrados por servicio si es jefe
  const sectoresActivos = sectoresAsignados.filter(s => {
    if (s.fecha_hasta) return false;
    if (!isGlobal && miServicioId != null) return Number(s.servicio_id) === miServicioId;
    return true;
  });

  // Grupos jerárquicos para la vista "Por Servicio"
  // Fuente servicio: agentes_servicios activos; fuente sector: agentes_sectores activos
  const gruposJerarquicos: GrupoJerarquico[] = vista === 'servicio'
    ? agruparJerarquico(pasesVisibles, sectoresActivos, catalogos.servicios, catalogos.sectores)
    : [];

  // Grupos planos para otras vistas (usan agentes directamente)
  const grupos: Grupo[] = (() => {
    if (vista === 'ley')      return agrupar(agentes, 'ley_id', catalogos.ley);
    if (vista === 'jefatura') return agrupar(agentes, 'jefatura_id', catalogos.jefaturas);
    // Por Sector: usa agentes_sectores activos (historial real de sectores)
    if (vista === 'sector')   return agrupar(sectoresActivos, 'sector_id', catalogos.sectores);
    if (vista === 'planta')   return agrupar(agentes, 'planta_id', catalogos.planta);
    if (vista === 'regimen')  return agrupar(agentes, 'regimen_horario_id', catalogos.regimen);
    return [];
  })();

  const totalJerarquico = gruposJerarquicos.reduce((s, g) => s + g.count, 0);
  const totalPlano = grupos.reduce((s, g) => s + g.count, 0);

  const exportTodo = () => {
    if (vista === 'servicio') {
      const rows = gruposJerarquicos.flatMap(g =>
        g.sectores.map(s => ({
          Servicio: g.label,
          Sector: s.label,
          Cantidad: s.count,
          Porcentaje: `${totalJerarquico ? Math.round(s.count / totalJerarquico * 100) : 0}%`,
        }))
      );
      exportToExcel('organigrama_servicio_sector', rows);
    } else {
      const rows = grupos.map(g => ({
        Grupo: g.label,
        Cantidad: g.count,
        Porcentaje: `${totalPlano ? Math.round(g.count / totalPlano * 100) : 0}%`,
      }));
      exportToExcel(`organigrama_${vista}`, rows);
    }
  };

  const VISTAS: { key: Vista; label: string }[] = [
    { key: 'servicio', label: '🏢 Por Servicio' },
    { key: 'sector',   label: '📍 Por Sector' },
    { key: 'ley',      label: '📜 Por Ley' },
    { key: 'jefatura', label: '👤 Por Jefatura' },
    { key: 'planta',   label: '🌱 Por Planta' },
    { key: 'regimen',  label: '🕐 Por Régimen Horario' },
  ];

  const hayDatos = vista === 'servicio' ? gruposJerarquicos.length > 0 : grupos.length > 0;
  const totalMostrado = vista === 'servicio' ? totalJerarquico : totalPlano;
  const cantGrupos = vista === 'servicio' ? gruposJerarquicos.length : grupos.length;

  return (
    <Layout title="Organigrama" showBack>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>🏗️ Distribución del personal</strong>
          <div className="muted" style={{ fontSize: '0.74rem', marginTop: 2 }}>
            {loading
              ? step
              : `${totalMostrado} asignaciones en ${cantGrupos} grupo${cantGrupos !== 1 ? 's' : ''}${!isGlobal && miServicioId ? ` · Servicio #${miServicioId}` : ''}`
            }
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!loading && <button className="btn" onClick={exportTodo} style={{ fontSize: '0.8rem', background: '#16a34a', color: '#fff' }}>📊 Excel resumen</button>}
          <button className="btn" onClick={cargar} disabled={loading}>{loading ? '⏳' : '🔄'}</button>
        </div>
      </div>

      {/* Selector de vista */}
      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {VISTAS.map(v => (
          <button key={v.key} className="btn" onClick={() => setVista(v.key)}
            style={{
              fontSize: '0.8rem', padding: '6px 12px',
              background: vista === v.key ? '#7c3aed' : undefined,
              color: vista === v.key ? '#fff' : undefined,
            }}>
            {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏳</div>
          <div>{step}</div>
        </div>
      ) : !hayDatos ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="muted">Sin datos para esta vista.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          {/* Resumen visual de totales */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {(vista === 'servicio' ? gruposJerarquicos : grupos).slice(0, 12).map((g, i) => (
              <div key={g.id} style={{
                background: COLORES[i % COLORES.length] + '22',
                border: `1px solid ${COLORES[i % COLORES.length]}44`,
                borderRadius: 8, padding: '4px 12px', fontSize: '0.76rem',
              }}>
                <span style={{ color: COLORES[i % COLORES.length], fontWeight: 700 }}>{g.count}</span>
                <span className="muted" style={{ marginLeft: 5 }}>{g.label.substring(0, 22)}</span>
              </div>
            ))}
            {cantGrupos > 12 && (
              <div className="muted" style={{ fontSize: '0.74rem', alignSelf: 'center' }}>
                + {cantGrupos - 12} grupos más
              </div>
            )}
          </div>

          {/* Vista jerárquica: Servicio → Sector */}
          {vista === 'servicio' && gruposJerarquicos.map((g, i) => (
            <ServicioCard
              key={g.id}
              grupo={g}
              color={COLORES[i % COLORES.length]}
              totalGlobal={totalJerarquico}
              mapaPersonal={mapaPersonal}
            />
          ))}

          {/* Vistas planas */}
          {vista !== 'servicio' && grupos.map((g, i) => (
            <GrupoCard key={g.id} grupo={g} color={COLORES[i % COLORES.length]} total={totalPlano} mapaPersonal={mapaPersonal} />
          ))}
        </div>
      )}
    </Layout>
  );
}

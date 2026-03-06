// src/pages/OrganigramaPage/index.tsx
// Paginación completa + resolución de nombres desde tablas catálogo

import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
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

interface Grupo { id: string; label: string; count: number; agentes: any[] }

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

const COLORES = ['#7c3aed','#2563eb','#10b981','#f59e0b','#ec4899','#06b6d4','#a3e635','#fb923c','#ef4444','#8b5cf6','#22d3ee','#f472b6'];

function GrupoCard({ grupo, color, total }: { grupo: Grupo; color: string; total: number }) {
  const [open, setOpen] = useState(false);
  const pct = total ? Math.round((grupo.count / total) * 100) : 0;
  const exportRows = grupo.agentes.map(a => ({
    DNI: a.dni, Estado: a.estado_empleo,
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
        {/* Barra mini */}
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
                <th style={{ padding: '3px 8px', textAlign: 'left', color: '#94a3b8' }}>Estado</th>
                <th style={{ padding: '3px 8px', textAlign: 'left', color: '#94a3b8' }}>Ingreso</th>
              </tr>
            </thead>
            <tbody>
              {grupo.agentes.slice(0, 100).map((a, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '3px 8px' }}>{a.dni}</td>
                  <td style={{ padding: '3px 8px' }}>{a.estado_empleo}</td>
                  <td style={{ padding: '3px 8px' }}>{a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '—'}</td>
                </tr>
              ))}
              {grupo.agentes.length > 100 && (
                <tr><td colSpan={3} style={{ padding: '4px 8px', color: '#94a3b8', fontSize: '0.72rem' }}>
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

type Vista = 'ley' | 'jefatura' | 'sector' | 'planta' | 'regimen' | 'servicio';

export function OrganigramaPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState('');
  const [agentes, setAgentes] = useState<any[]>([]);
  const [servicios, setServicios] = useState<any[]>([]);
  const [catalogos, setCatalogos] = useState<{
    ley: Record<number,string>; jefaturas: Record<number,string>;
    reparticiones: Record<number,string>; planta: Record<number,string>;
    regimen: Record<number,string>;
  }>({ ley: {}, jefaturas: {}, reparticiones: {}, planta: {}, regimen: {} });
  const [vista, setVista] = useState<Vista>('ley');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setStep('Catálogos…');
      const [rLey, rJef, rRep, rPlanta, rReg] = await Promise.allSettled([
        apiFetch<any>('/ley?limit=200&page=1'),
        apiFetch<any>('/jefaturas?limit=200&page=1'),
        apiFetch<any>('/reparticiones?limit=200&page=1'),
        apiFetch<any>('/plantas?limit=200&page=1'),         // plural correcto
        apiFetch<any>('/regimenes_horarios?limit=200&page=1'), // plural correcto
      ]);
      setCatalogos({
        ley:          rLey.status    === 'fulfilled' ? buildMap(rLey.value?.data    || [], 'id', 'nombre') : {},
        jefaturas:    rJef.status    === 'fulfilled' ? buildMap(rJef.value?.data    || [], 'id', 'sector') : {},
        reparticiones:rRep.status    === 'fulfilled' ? buildMap(rRep.value?.data    || [], 'id', 'reparticion_nombre') : {},
        planta:       rPlanta.status === 'fulfilled' ? buildMap(rPlanta.value?.data || [], 'id', 'nombre') : {},
        regimen:      rReg.status    === 'fulfilled' ? buildMap(rReg.value?.data    || [], 'id', 'nombre') : {},
      });

      setStep('Agentes…');
      const a = await fetchAll('/agentes');
      setAgentes(a);

      setStep('Servicios…');
      const s = await fetchAll('/agentes_servicios');
      setServicios(s);

      toast.ok(`${a.length} agentes cargados`);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
      setStep('');
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const grupos: Grupo[] = (() => {
    if (vista === 'ley') return agrupar(agentes, 'ley_id', catalogos.ley);
    if (vista === 'jefatura') return agrupar(agentes, 'jefatura_id', catalogos.jefaturas);
    if (vista === 'sector') return agrupar(agentes, 'sector_id', catalogos.reparticiones);
    if (vista === 'planta') return agrupar(agentes, 'planta_id', catalogos.planta);
    if (vista === 'regimen') return agrupar(agentes, 'regimen_horario_id', catalogos.regimen);
    if (vista === 'servicio') return agrupar(servicios, 'servicio_nombre');
    return [];
  })();

  const total = grupos.reduce((s, g) => s + g.count, 0);

  const exportTodo = () => {
    const rows = grupos.map(g => ({
      Grupo: g.label,
      Cantidad: g.count,
      Porcentaje: `${total ? Math.round(g.count/total*100) : 0}%`,
    }));
    exportToExcel(`organigrama_${vista}`, rows);
  };

  const VISTAS: { key: Vista; label: string }[] = [
    { key: 'ley', label: '📜 Por Ley' },
    { key: 'jefatura', label: '👤 Por Jefatura' },
    { key: 'sector', label: '📍 Por Sector' },
    { key: 'planta', label: '🌱 Por Planta' },
    { key: 'regimen', label: '🕐 Por Régimen Horario' },
    { key: 'servicio', label: '🏢 Por Servicio' },
  ];

  return (
    <Layout title="Organigrama" showBack>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>🏗️ Distribución del personal</strong>
          <div className="muted" style={{ fontSize: '0.74rem', marginTop: 2 }}>
            {loading ? step : `${agentes.length} agentes en ${grupos.length} grupos`}
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
      ) : grupos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="muted">Sin datos para esta vista.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          {/* Resumen visual de totales */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {grupos.slice(0, 12).map((g, i) => (
              <div key={g.id} style={{
                background: COLORES[i % COLORES.length] + '22',
                border: `1px solid ${COLORES[i % COLORES.length]}44`,
                borderRadius: 8, padding: '4px 12px', fontSize: '0.76rem',
              }}>
                <span style={{ color: COLORES[i % COLORES.length], fontWeight: 700 }}>{g.count}</span>
                <span className="muted" style={{ marginLeft: 5 }}>{g.label.substring(0, 22)}</span>
              </div>
            ))}
            {grupos.length > 12 && (
              <div className="muted" style={{ fontSize: '0.74rem', alignSelf: 'center' }}>
                + {grupos.length - 12} grupos más
              </div>
            )}
          </div>

          {grupos.map((g, i) => (
            <GrupoCard key={g.id} grupo={g} color={COLORES[i % COLORES.length]} total={total} />
          ))}
        </div>
      )}
    </Layout>
  );
}

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
  count: number;
  sectores: Grupo[];
}

interface GrupoTresNiveles {
  id: string;
  label: string;
  count: number;
  sub: Array<{ id: string; label: string; count: number; sub: Grupo[] }>;
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

function agruparJerarquico(
  pasesServicio: any[],
  pasesSector: any[],
  mapaServicios: Record<number, string>,
  mapaSectores: Record<number, string>,
): GrupoJerarquico[] {
  const sectorActivo: Record<string, number | null> = {};
  for (const ps of pasesSector) {
    if (ps.fecha_hasta) continue;
    const key = `${ps.dni}_${ps.servicio_id ?? ''}`;
    sectorActivo[key] = Number(ps.sector_id);
  }
  const porServicio: Record<string, { label: string; registros: Array<any & { _sector_id: number | null }> }> = {};
  for (const r of pasesServicio) {
    const srvRaw = r.servicio_id;
    const srvKey = srvRaw != null && srvRaw !== '' ? String(srvRaw) : '__sin__';
    const srvLabel = srvRaw != null && srvRaw !== ''
      ? (mapaServicios[Number(srvRaw)] ?? `Servicio #${srvRaw}`)
      : '(sin servicio)';
    if (!porServicio[srvKey]) porServicio[srvKey] = { label: srvLabel, registros: [] };
    const secKey = `${r.dni}_${srvRaw ?? ''}`;
    porServicio[srvKey].registros.push({ ...r, _sector_id: sectorActivo[secKey] ?? null });
  }
  const resultado: GrupoJerarquico[] = Object.entries(porServicio).map(([srvKey, srv]) => ({
    id: srvKey,
    label: srv.label,
    count: srv.registros.length,
    sectores: agrupar(srv.registros, '_sector_id', mapaSectores),
  }));
  return resultado.sort((a, b) => b.count - a.count);
}

function agruparPorLeySexo(
  agentes: any[],
  mapaDniSexo: Record<number, number>,
  mapaSexos: Record<number, string>,
  mapaLey: Record<number, string>,
): GrupoJerarquico[] {
  const porLey: Record<string, { label: string; registros: any[] }> = {};
  for (const a of agentes) {
    const rawLey = a.ley_id;
    const k = rawLey != null && rawLey !== '' ? String(rawLey) : '__sin__';
    const label = rawLey != null && rawLey !== ''
      ? (mapaLey[Number(rawLey)] ?? `Ley #${rawLey}`)
      : '(sin ley)';
    if (!porLey[k]) porLey[k] = { label, registros: [] };
    porLey[k].registros.push({ ...a, _sexo_id: mapaDniSexo[Number(a.dni)] ?? null });
  }
  return Object.entries(porLey).map(([k, v]) => ({
    id: k,
    label: v.label,
    count: v.registros.length,
    sectores: agrupar(v.registros, '_sexo_id', mapaSexos),
  })).sort((a, b) => b.count - a.count);
}

function agruparPorLeySexoOcu(
  agentes: any[],
  mapaDniSexo: Record<number, number>,
  mapaSexos: Record<number, string>,
  mapaLey: Record<number, string>,
  mapaOcu: Record<number, string>,
): GrupoTresNiveles[] {
  const porLey: Record<string, { label: string; registros: any[] }> = {};
  for (const a of agentes) {
    const rawLey = a.ley_id;
    const k = rawLey != null && rawLey !== '' ? String(rawLey) : '__sin__';
    const label = rawLey != null && rawLey !== ''
      ? (mapaLey[Number(rawLey)] ?? `Ley #${rawLey}`)
      : '(sin ley)';
    if (!porLey[k]) porLey[k] = { label, registros: [] };
    porLey[k].registros.push({ ...a, _sexo_id: mapaDniSexo[Number(a.dni)] ?? null });
  }
  return Object.entries(porLey).map(([k, v]) => {
    const porSexo: Record<string, { label: string; registros: any[] }> = {};
    for (const a of v.registros) {
      const rawSexo = a._sexo_id;
      const sk = rawSexo != null ? String(rawSexo) : '__sin__';
      const slabel = rawSexo != null
        ? (mapaSexos[Number(rawSexo)] ?? `Sexo #${rawSexo}`)
        : '(sin asignar)';
      if (!porSexo[sk]) porSexo[sk] = { label: slabel, registros: [] };
      porSexo[sk].registros.push(a);
    }
    const sub = Object.entries(porSexo).map(([sk, sv]) => ({
      id: sk,
      label: sv.label,
      count: sv.registros.length,
      sub: agrupar(sv.registros, 'ocupacion_id', mapaOcu),
    })).sort((a, b) => b.count - a.count);
    return { id: k, label: v.label, count: v.registros.length, sub };
  }).sort((a, b) => b.count - a.count);
}

function agruparServicioLey(
  pasesServicio: any[],
  agentes: any[],
  mapaServicios: Record<number, string>,
  mapaLey: Record<number, string>,
): GrupoJerarquico[] {
  // Mapa dni → ley_id para lookup rápido
  const dniLey: Record<number, number | null> = {};
  for (const a of agentes) dniLey[Number(a.dni)] = a.ley_id != null ? Number(a.ley_id) : null;

  const porServicio: Record<string, { label: string; registros: any[] }> = {};
  for (const r of pasesServicio) {
    const srvRaw = r.servicio_id;
    const k = srvRaw != null && srvRaw !== '' ? String(srvRaw) : '__sin__';
    const label = srvRaw != null && srvRaw !== ''
      ? (mapaServicios[Number(srvRaw)] ?? `Servicio #${srvRaw}`)
      : '(sin servicio)';
    if (!porServicio[k]) porServicio[k] = { label, registros: [] };
    porServicio[k].registros.push({ ...r, _ley_id: dniLey[Number(r.dni)] ?? null });
  }

  return Object.entries(porServicio).map(([k, v]) => ({
    id: k,
    label: v.label,
    count: v.registros.length,
    sectores: agrupar(v.registros, '_ley_id', mapaLey),
  })).sort((a, b) => b.count - a.count);
}

// ── Colores ───────────────────────────────────────────────────────────────────

const COLORES = ['#7c3aed','#2563eb','#10b981','#f59e0b','#ec4899','#06b6d4','#a3e635','#fb923c','#ef4444','#8b5cf6','#22d3ee','#f472b6'];

// ── Card de sector / ocupación (hoja: muestra agentes) ───────────────────────

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

// ── Card de servicio (Servicio → Sector) ─────────────────────────────────────

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

// ── Card Ley → Sexo ───────────────────────────────────────────────────────────

function LeySexoCard({ grupo, color, totalGlobal, mapaPersonal }: {
  grupo: GrupoJerarquico; color: string; totalGlobal: number;
  mapaPersonal: Record<number, string>;
}) {
  const [open, setOpen] = useState(false);
  const pct = totalGlobal ? Math.round((grupo.count / totalGlobal) * 100) : 0;

  const exportRows = grupo.sectores.flatMap(s =>
    s.agentes.map(a => ({
      Ley: grupo.label,
      Sexo: s.label,
      DNI: a.dni,
      Apellido_Nombre: mapaPersonal[Number(a.dni)] || '',
      Estado: a.estado_empleo || a.estado || '',
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
            {grupo.sectores.map(s => `${s.label}: ${s.count}`).join(' · ')}
          </div>
        </div>
        <div style={{ width: 120, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, minWidth: 2 }} />
        </div>
        <div style={{ minWidth: 40, textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>{grupo.count}</div>
        <div className="muted" style={{ minWidth: 36, fontSize: '0.72rem' }}>{pct}%</div>
        <button onClick={e => { e.stopPropagation(); exportToExcel(`ley_sexo_${grupo.label.substring(0,20)}`, exportRows); }}
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

// ── Card Ley → Sexo → Ocupación ───────────────────────────────────────────────

function OcuCard({ grupo, color, mapaPersonal }: {
  grupo: Grupo; color: string; mapaPersonal: Record<number, string>;
}) {
  return <SectorCard sector={grupo} color={color} mapaPersonal={mapaPersonal} />;
}

function SexoCard({ sexo, color, mapaPersonal }: {
  sexo: { id: string; label: string; count: number; sub: Grupo[] };
  color: string; mapaPersonal: Record<number, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
        borderRadius: 8, background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${color}33`, cursor: 'pointer', userSelect: 'none',
      }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: '0.83rem', color: '#cbd5e1', fontWeight: 600 }}>{sexo.label}</div>
        <div className="muted" style={{ fontSize: '0.72rem', marginRight: 8 }}>
          {sexo.sub.length} ocupación{sexo.sub.length !== 1 ? 'es' : ''}
        </div>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', minWidth: 32, textAlign: 'right' }}>{sexo.count}</div>
        <span className="muted" style={{ fontSize: '0.68rem', marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginLeft: 20, marginTop: 2 }}>
          {sexo.sub.map((o, i) => (
            <OcuCard key={o.id} grupo={o} color={COLORES[(i + 3) % COLORES.length]} mapaPersonal={mapaPersonal} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeySexoOcuCard({ grupo, color, totalGlobal, mapaPersonal }: {
  grupo: GrupoTresNiveles; color: string; totalGlobal: number;
  mapaPersonal: Record<number, string>;
}) {
  const [open, setOpen] = useState(false);
  const pct = totalGlobal ? Math.round((grupo.count / totalGlobal) * 100) : 0;

  const exportRows = grupo.sub.flatMap(sexo =>
    sexo.sub.flatMap(ocu =>
      ocu.agentes.map(a => ({
        Ley: grupo.label,
        Sexo: sexo.label,
        Ocupacion: ocu.label,
        DNI: a.dni,
        Apellido_Nombre: mapaPersonal[Number(a.dni)] || '',
        Estado: a.estado_empleo || a.estado || '',
      }))
    )
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
            {grupo.sub.map(s => `${s.label}: ${s.count}`).join(' · ')}
          </div>
        </div>
        <div style={{ width: 120, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, minWidth: 2 }} />
        </div>
        <div style={{ minWidth: 40, textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>{grupo.count}</div>
        <div className="muted" style={{ minWidth: 36, fontSize: '0.72rem' }}>{pct}%</div>
        <button onClick={e => { e.stopPropagation(); exportToExcel(`ley_sexo_ocu_${grupo.label.substring(0,20)}`, exportRows); }}
          style={{ background: '#16a34a33', color: '#16a34a', border: '1px solid #16a34a55', borderRadius: 6, padding: '2px 8px', fontSize: '0.68rem', cursor: 'pointer' }}>
          Excel
        </button>
        <span className="muted" style={{ fontSize: '0.72rem' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginLeft: 24, marginTop: 4 }}>
          {grupo.sub.map((s, i) => (
            <SexoCard key={s.id} sexo={s} color={COLORES[(i + 1) % COLORES.length]} mapaPersonal={mapaPersonal} />
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

type Vista = 'ley' | 'jefatura' | 'sector' | 'planta' | 'regimen' | 'servicio' | 'servicio_ley' | 'ley_sexo' | 'ley_sexo_ocu';
type FiltroEstado = 'todos' | 'activo' | 'baja';

// ── Componente principal ──────────────────────────────────────────────────────

export function OrganigramaPage() {
  const toast = useToast();
  const { session } = useAuth();
  const u: any = session?.user || {};
  const perms: string[] = session?.permissions ?? [];

  const isGlobal = hasPermission(perms, 'crud:*:*');
  const miServicioId: number | null = u?.servicio_id ?? null;

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState('');
  const [agentes, setAgentes] = useState<any[]>([]);
  const [serviciosAsignados, setServiciosAsignados] = useState<any[]>([]);
  const [sectoresAsignados, setSectoresAsignados] = useState<any[]>([]);
  const [mapaPersonal, setMapaPersonal] = useState<Record<number, string>>({});
  const [mapaDniSexo, setMapaDniSexo] = useState<Record<number, number>>({});
  const [catalogos, setCatalogos] = useState<{
    ley: Record<number,string>; jefaturas: Record<number,string>;
    reparticiones: Record<number,string>; planta: Record<number,string>;
    regimen: Record<number,string>; servicios: Record<number,string>;
    sectores: Record<number,string>; sexos: Record<number,string>;
    ocupaciones: Record<number,string>;
  }>({ ley: {}, jefaturas: {}, reparticiones: {}, planta: {}, regimen: {}, servicios: {}, sectores: {}, sexos: {}, ocupaciones: {} });
  const [vista, setVista] = useState<Vista>('servicio');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setStep('Catálogos…');
      const [rLey, rJef, rRep, rPlanta, rReg, rSrv, rSec, rSexo, rOcu] = await Promise.allSettled([
        apiFetch<any>('/ley?limit=200&page=1'),
        apiFetch<any>('/jefaturas?limit=200&page=1'),
        apiFetch<any>('/reparticiones?limit=200&page=1'),
        apiFetch<any>('/plantas?limit=200&page=1'),
        apiFetch<any>('/regimenes_horarios?limit=200&page=1'),
        apiFetch<any>('/servicios?limit=200&page=1'),
        apiFetch<any>('/sectores?limit=500&page=1'),
        apiFetch<any>('/sexos?limit=200&page=1'),
        apiFetch<any>('/ocupaciones?limit=200&page=1'),
      ]);
      setCatalogos({
        ley:          rLey.status    === 'fulfilled' ? buildMap(rLey.value?.data    || [], 'id', 'nombre') : {},
        jefaturas:    rJef.status    === 'fulfilled' ? buildMap(rJef.value?.data    || [], 'id', 'sector') : {},
        reparticiones:rRep.status    === 'fulfilled' ? buildMap(rRep.value?.data    || [], 'id', 'reparticion_nombre') : {},
        planta:       rPlanta.status === 'fulfilled' ? buildMap(rPlanta.value?.data || [], 'id', 'nombre') : {},
        regimen:      rReg.status    === 'fulfilled' ? buildMap(rReg.value?.data    || [], 'id', 'nombre') : {},
        servicios:    rSrv.status    === 'fulfilled' ? buildMap(rSrv.value?.data    || [], 'id', 'nombre') : {},
        sectores:     rSec.status    === 'fulfilled' ? buildMap(rSec.value?.data    || [], 'id', 'nombre') : {},
        sexos:        rSexo.status   === 'fulfilled' ? buildMap(rSexo.value?.data   || [], 'id', 'nombre') : {},
        ocupaciones:  rOcu.status    === 'fulfilled' ? buildMap(rOcu.value?.data    || [], 'id', 'nombre') : {},
      });

      // Ocupaciones tiene 800+ registros — paginar completo para el mapa de nombres
      setStep('Ocupaciones…');
      const ocupRows = await fetchAll('/ocupaciones');
      if (ocupRows.length > 0) {
        setCatalogos(prev => ({ ...prev, ocupaciones: buildMap(ocupRows, 'id', 'nombre') }));
      }

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
      const p = await fetchAll('/personal?fields=dni,apellido,nombre,sexo_id');
      const mapa: Record<number, string> = {};
      const mapaSexo: Record<number, number> = {};
      for (const r of p) {
        const dni = Number(r.dni);
        if (dni) {
          mapa[dni] = `${r.apellido || ''}, ${r.nombre || ''}`.trim().replace(/^,\s*/, '');
          if (r.sexo_id != null) mapaSexo[dni] = Number(r.sexo_id);
        }
      }
      setMapaPersonal(mapa);
      setMapaDniSexo(mapaSexo);

      toast.ok(`${a.length} agentes cargados`);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
      setStep('');
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  // Filtro de estado: activos / bajas / todos
  const agentesFiltrados = agentes.filter(a => {
    if (filtroEstado === 'activo') return (a.estado_empleo || '').toUpperCase() === 'ACTIVO';
    if (filtroEstado === 'baja')   return (a.estado_empleo || '').toUpperCase() === 'BAJA';
    return true;
  });
  const dniFiltrados = new Set(agentesFiltrados.map(a => Number(a.dni)));

  const pasesActivos = serviciosAsignados.filter(s => !s.fecha_hasta && (filtroEstado === 'todos' || dniFiltrados.has(Number(s.dni))));
  const pasesVisibles = isGlobal
    ? pasesActivos
    : pasesActivos.filter(s => miServicioId != null && Number(s.servicio_id) === miServicioId);
  const sectoresActivos = sectoresAsignados.filter(s => {
    if (s.fecha_hasta) return false;
    if (filtroEstado !== 'todos' && !dniFiltrados.has(Number(s.dni))) return false;
    if (!isGlobal && miServicioId != null) return Number(s.servicio_id) === miServicioId;
    return true;
  });

  const gruposJerarquicos: GrupoJerarquico[] = vista === 'servicio'
    ? agruparJerarquico(pasesVisibles, sectoresActivos, catalogos.servicios, catalogos.sectores)
    : vista === 'servicio_ley'
    ? agruparServicioLey(pasesVisibles, agentesFiltrados, catalogos.servicios, catalogos.ley)
    : vista === 'ley_sexo'
    ? agruparPorLeySexo(agentesFiltrados, mapaDniSexo, catalogos.sexos, catalogos.ley)
    : [];

  const gruposTresNiveles: GrupoTresNiveles[] = vista === 'ley_sexo_ocu'
    ? agruparPorLeySexoOcu(agentesFiltrados, mapaDniSexo, catalogos.sexos, catalogos.ley, catalogos.ocupaciones)
    : [];

  const grupos: Grupo[] = (() => {
    if (vista === 'ley')      return agrupar(agentesFiltrados, 'ley_id', catalogos.ley);
    if (vista === 'jefatura') return agrupar(agentesFiltrados, 'jefatura_id', catalogos.jefaturas);
    if (vista === 'sector')   return agrupar(sectoresActivos, 'sector_id', catalogos.sectores);
    if (vista === 'planta')   return agrupar(agentesFiltrados, 'planta_id', catalogos.planta);
    if (vista === 'regimen')  return agrupar(agentesFiltrados, 'regimen_horario_id', catalogos.regimen);
    return [];
  })();

  const totalJerarquico = vista === 'ley_sexo_ocu'
    ? gruposTresNiveles.reduce((s, g) => s + g.count, 0)
    : gruposJerarquicos.reduce((s, g) => s + g.count, 0);
  const totalPlano = grupos.reduce((s, g) => s + g.count, 0);

  const isJerarquico = vista === 'servicio' || vista === 'servicio_ley' || vista === 'ley_sexo';
  const isTresNiveles = vista === 'ley_sexo_ocu';
  const hayDatos = isTresNiveles
    ? gruposTresNiveles.length > 0
    : isJerarquico
    ? gruposJerarquicos.length > 0
    : grupos.length > 0;
  const totalMostrado = (isJerarquico || isTresNiveles) ? totalJerarquico : totalPlano;
  const cantGrupos = isTresNiveles
    ? gruposTresNiveles.length
    : isJerarquico
    ? gruposJerarquicos.length
    : grupos.length;

  const resumenGrupos = isTresNiveles
    ? gruposTresNiveles
    : isJerarquico
    ? gruposJerarquicos
    : grupos;

  const exportConteos = () => {
    if (vista === 'servicio_ley') {
      const rows = gruposJerarquicos.flatMap(g =>
        g.sectores.map(s => ({
          Servicio: g.label, Ley: s.label, Cantidad: s.count,
          Porcentaje: `${totalJerarquico ? Math.round(s.count / totalJerarquico * 100) : 0}%`,
        }))
      );
      exportToExcel('resumen_servicio_ley', rows);
    } else if (vista === 'ley_sexo') {
      const rows = gruposJerarquicos.flatMap(g =>
        g.sectores.map(s => ({
          Ley: g.label, Sexo: s.label, Cantidad: s.count,
          Porcentaje: `${totalJerarquico ? Math.round(s.count / totalJerarquico * 100) : 0}%`,
        }))
      );
      exportToExcel('resumen_ley_sexo', rows);
    } else if (vista === 'ley_sexo_ocu') {
      const rows = gruposTresNiveles.flatMap(g =>
        g.sub.flatMap(sexo =>
          sexo.sub.map(ocu => ({
            Ley: g.label, Sexo: sexo.label, Ocupacion: ocu.label, Cantidad: ocu.count,
            Porcentaje: `${totalJerarquico ? Math.round(ocu.count / totalJerarquico * 100) : 0}%`,
          }))
        )
      );
      exportToExcel('resumen_ley_sexo_ocupacion', rows);
    }
  };

  const exportTodo = () => {
    if (vista === 'servicio_ley') {
      const rows = gruposJerarquicos.flatMap(g =>
        g.sectores.flatMap(s =>
          s.agentes.map(a => ({
            Servicio: g.label, Ley: s.label,
            DNI: a.dni,
            Apellido_Nombre: mapaPersonal[Number(a.dni)] || '',
            Estado: a.estado_empleo || a.estado || '',
            Fecha_Desde: a.fecha_desde ? new Date(a.fecha_desde).toLocaleDateString('es-AR') : '',
          }))
        )
      );
      exportToExcel('detalle_servicio_ley', rows);
    } else if (vista === 'servicio') {
      const rows = gruposJerarquicos.flatMap(g =>
        g.sectores.map(s => ({
          Servicio: g.label, Sector: s.label, Cantidad: s.count,
          Porcentaje: `${totalJerarquico ? Math.round(s.count / totalJerarquico * 100) : 0}%`,
        }))
      );
      exportToExcel('organigrama_servicio_sector', rows);
    } else if (vista === 'ley_sexo') {
      const rows = gruposJerarquicos.flatMap(g =>
        g.sectores.flatMap(s =>
          s.agentes.map(a => ({
            Ley: g.label,
            Sexo: s.label,
            DNI: a.dni,
            Apellido_Nombre: mapaPersonal[Number(a.dni)] || '',
            Estado: a.estado_empleo || a.estado || '',
            Fecha_Ingreso: a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '',
          }))
        )
      );
      exportToExcel('organigrama_ley_sexo', rows);
    } else if (vista === 'ley_sexo_ocu') {
      const rows = gruposTresNiveles.flatMap(g =>
        g.sub.flatMap(sexo =>
          sexo.sub.flatMap(ocu =>
            ocu.agentes.map(a => ({
              Ley: g.label,
              Sexo: sexo.label,
              Ocupacion: ocu.label,
              DNI: a.dni,
              Apellido_Nombre: mapaPersonal[Number(a.dni)] || '',
              Estado: a.estado_empleo || a.estado || '',
              Fecha_Ingreso: a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '',
            }))
          )
        )
      );
      exportToExcel('organigrama_ley_sexo_ocupacion', rows);
    } else {
      const rows = grupos.map(g => ({
        Grupo: g.label, Cantidad: g.count,
        Porcentaje: `${totalPlano ? Math.round(g.count / totalPlano * 100) : 0}%`,
      }));
      exportToExcel(`organigrama_${vista}`, rows);
    }
  };

  const VISTAS: { key: Vista; label: string }[] = [
    { key: 'servicio',     label: '🏢 Por Servicio' },
    { key: 'servicio_ley', label: '🏢 Por Servicio y Ley' },
    { key: 'sector',       label: '📍 Por Sector' },
    { key: 'ley',          label: '📜 Por Ley' },
    { key: 'ley_sexo',     label: '📜 Por Ley y Sexo' },
    { key: 'ley_sexo_ocu', label: '📜 Por Ley, Sexo y Ocupación' },
    { key: 'jefatura',     label: '👤 Por Jefatura' },
    { key: 'planta',       label: '🌱 Por Planta' },
    { key: 'regimen',      label: '🕐 Por Régimen Horario' },
  ];

  return (
    <Layout title="Organigrama" showBack>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>🏗️ Distribución del personal</strong>
          <div className="muted" style={{ fontSize: '0.74rem', marginTop: 2 }}>
            {loading
              ? step
              : `${totalMostrado} ${filtroEstado === 'activo' ? 'activos' : filtroEstado === 'baja' ? 'bajas' : 'asignaciones'} en ${cantGrupos} grupo${cantGrupos !== 1 ? 's' : ''}${!isGlobal && miServicioId ? ` · Servicio #${miServicioId}` : ''}`
            }
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!loading && <button className="btn" onClick={exportTodo} style={{ fontSize: '0.8rem', background: '#16a34a', color: '#fff' }}>📊 Excel detalle</button>}
          {!loading && (vista === 'servicio_ley' || vista === 'ley_sexo' || vista === 'ley_sexo_ocu') && (
            <button className="btn" onClick={exportConteos} style={{ fontSize: '0.8rem', background: '#0369a1', color: '#fff' }}>📋 Excel conteos</button>
          )}
          <button className="btn" onClick={cargar} disabled={loading}>{loading ? '⏳' : '🔄'}</button>
        </div>
      </div>

      {/* Filtro de estado */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {([
          { key: 'todos',  label: 'Todos',   color: '#475569' },
          { key: 'activo', label: '✅ Activos', color: '#16a34a' },
          { key: 'baja',   label: '🚫 Bajas',   color: '#dc2626' },
        ] as { key: FiltroEstado; label: string; color: string }[]).map(f => (
          <button key={f.key} className="btn" onClick={() => setFiltroEstado(f.key)}
            style={{
              fontSize: '0.78rem', padding: '5px 14px',
              background: filtroEstado === f.key ? f.color : undefined,
              color: filtroEstado === f.key ? '#fff' : undefined,
              borderColor: filtroEstado === f.key ? f.color : undefined,
            }}>
            {f.label}
          </button>
        ))}
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
            {resumenGrupos.slice(0, 12).map((g, i) => (
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

          {/* Vista: Servicio → Sector */}
          {vista === 'servicio' && gruposJerarquicos.map((g, i) => (
            <ServicioCard key={g.id} grupo={g} color={COLORES[i % COLORES.length]}
              totalGlobal={totalJerarquico} mapaPersonal={mapaPersonal} />
          ))}

          {/* Vista: Servicio → Ley */}
          {vista === 'servicio_ley' && gruposJerarquicos.map((g, i) => (
            <LeySexoCard key={g.id} grupo={g} color={COLORES[i % COLORES.length]}
              totalGlobal={totalJerarquico} mapaPersonal={mapaPersonal} />
          ))}

          {/* Vista: Ley → Sexo */}
          {vista === 'ley_sexo' && gruposJerarquicos.map((g, i) => (
            <LeySexoCard key={g.id} grupo={g} color={COLORES[i % COLORES.length]}
              totalGlobal={totalJerarquico} mapaPersonal={mapaPersonal} />
          ))}

          {/* Vista: Ley → Sexo → Ocupación */}
          {vista === 'ley_sexo_ocu' && gruposTresNiveles.map((g, i) => (
            <LeySexoOcuCard key={g.id} grupo={g} color={COLORES[i % COLORES.length]}
              totalGlobal={totalJerarquico} mapaPersonal={mapaPersonal} />
          ))}

          {/* Vistas planas */}
          {!isJerarquico && !isTresNiveles && grupos.map((g, i) => (
            <GrupoCard key={g.id} grupo={g} color={COLORES[i % COLORES.length]} total={totalPlano} mapaPersonal={mapaPersonal} />
          ))}
        </div>
      )}
    </Layout>
  );
}

// src/pages/ComisionesPage/index.tsx
// Herramientas → Comisiones: control de agentes en comisión (tabla agentes_comisiones).
// Indicadores + gráficos (vigentes por destino, pases/regresos por mes, vencimientos),
// listado con filtros, pase nuevo, regreso, corrección de datos y tramos COMISION viejos
// sin acto/destino para completar.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel } from '../../utils/export';
import {
  PaseComisionModal, RegresoComisionModal, TIPOS_ACTO, fmtFecha, type Comision,
} from '../../components/Comisiones';
import { SERIE_COLORES } from '../HerramientasPage/GraficoEvolucion';

type Pendiente = { agente_id: number; dni: number; apellido: string; nombre: string; fecha_ingreso: string | null; fecha_egreso: string | null };
type FiltroEstado = 'ACTIVAS' | 'VIGENTE' | 'POR_VENCER' | 'VENCIDA' | 'FINALIZADA' | 'TODAS';

const ESTADO_UI: Record<Comision['estado'], { label: string; color: string }> = {
  VIGENTE:    { label: 'Vigente',    color: '#3987e5' },
  POR_VENCER: { label: 'Por vencer', color: '#c98500' },
  VENCIDA:    { label: 'Vencida',    color: '#e66767' },
  FINALIZADA: { label: 'Finalizada', color: '#64748b' },
};
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesKey = (iso: string) => iso.slice(0, 7);
const mesLabel = (k: string) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
function rangoMeses(desde: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(desde.getFullYear(), desde.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const card: React.CSSProperties = { padding: '14px 16px' };
const h3: React.CSSProperties = { fontSize: '0.86rem', fontWeight: 700, margin: '0 0 10px', color: '#e2e8f0' };
const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 8px', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' };

// ─── Gráficos ─────────────────────────────────────────────────────────────────
function BarrasHorizontales({ datos, color }: { datos: { label: string; n: number }[]; color: string }) {
  if (!datos.length) return <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 12 }}>Sin comisiones vigentes</div>;
  const max = Math.max(...datos.map(d => d.n));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {datos.map(d => (
        <div key={d.label} title={`${d.label}: ${d.n}`}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 38%) 1fr 28px', alignItems: 'center', gap: 8, fontSize: '0.76rem' }}>
          <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 14 }}>
            <div style={{ width: `${(d.n / max) * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
          </div>
          <span style={{ color: '#e2e8f0', fontWeight: 700, textAlign: 'right' }}>{d.n}</span>
        </div>
      ))}
    </div>
  );
}

function Columnas({ meses, series }: {
  meses: string[];
  series: { nombre: string; color: string; valores: number[] }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 200, M = { top: 10, right: 8, bottom: 26, left: 26 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const max = Math.max(1, ...series.flatMap(s => s.valores));
  const paso = Math.max(1, Math.ceil(max / 4));
  const ticks = Array.from({ length: Math.floor(max / paso) + 1 }, (_, i) => i * paso);
  const yMax = ticks[ticks.length - 1] < max ? max : Math.max(ticks[ticks.length - 1], 1);
  const slot = iw / meses.length;
  const bw = Math.max(2, (slot * 0.72) / series.length);
  const y = (v: number) => M.top + ih - (v / yMax) * ih;
  const cadaX = Math.max(1, Math.ceil(meses.length / 12));
  return (
    <div style={{ position: 'relative' }}>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 14, fontSize: '0.72rem', color: '#cbd5e1', marginBottom: 4 }}>
          {series.map(s => (
            <span key={s.nombre} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />{s.nombre}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHover(null)} role="img" aria-label={series.map(s => s.nombre).join(' y ')}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" />
            <text x={M.left - 5} y={y(t) + 3} fontSize="9" fill="#64748b" textAnchor="end">{t}</text>
          </g>
        ))}
        {meses.map((m, i) => (
          <g key={m} onMouseEnter={() => setHover(i)}>
            <rect x={M.left + i * slot} y={M.top} width={slot} height={ih}
              fill={hover === i ? 'rgba(255,255,255,0.05)' : 'transparent'} />
            {series.map((s, j) => s.valores[i] > 0 && (
              <rect key={s.nombre} x={M.left + i * slot + (slot - bw * series.length) / 2 + j * bw}
                y={y(s.valores[i])} width={bw - 1} height={M.top + ih - y(s.valores[i])} rx={1.5} fill={s.color} />
            ))}
            {i % cadaX === 0 && (
              <text x={M.left + i * slot + slot / 2} y={H - 8} fontSize="9" fill="#64748b" textAnchor="middle">{mesLabel(m)}</text>
            )}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div style={{
          position: 'absolute', top: 0, right: 0, background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6, padding: '4px 8px', fontSize: '0.72rem', color: '#e2e8f0', pointerEvents: 'none',
        }}>
          <b>{mesLabel(meses[hover])}</b>
          {series.map(s => <div key={s.nombre}><span style={{ color: s.color }}>■</span> {s.nombre}: {s.valores[hover]}</div>)}
        </div>
      )}
    </div>
  );
}

// ─── Corrección de datos ──────────────────────────────────────────────────────
function EditarComisionModal({ c, onClose, onDone }: { c: Comision; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    tipo_acto: c.tipo_acto || '', numero_acto: c.numero_acto, destino: c.destino,
    fecha_hasta: c.fecha_hasta || '', observaciones: c.observaciones || '',
  });
  const [saving, setSaving] = useState(false);
  const lbl: React.CSSProperties = { fontSize: '0.7rem', color: '#94a3b8', marginBottom: 2, display: 'block' };
  const fld: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: '0.86rem' };
  const guardar = async () => {
    if (!f.numero_acto.trim() || !f.destino.trim()) return toast.error('Acto y destino son obligatorios');
    setSaving(true);
    try {
      const res = await apiFetch<any>(`/comisiones/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          tipo_acto: f.tipo_acto || null, numero_acto: f.numero_acto.trim(),
          destino: f.destino.trim().toUpperCase(), fecha_hasta: f.fecha_hasta || null,
          observaciones: f.observaciones.trim() || null,
        }),
      });
      if (!res?.ok) throw new Error(res?.error || 'No se pudo guardar');
      toast.ok('✅ Comisión actualizada');
      onDone();
    } catch (e: any) { toast.error('Error al guardar', e?.message); } finally { setSaving(false); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div className="card" style={{ maxWidth: 520, width: '100%', padding: '1.25rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong>✏️ Corregir comisión</strong>
          <button className="btn" type="button" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 12 }}>
          {c.apellido}, {c.nombre} · DNI {c.dni} · desde {fmtFecha(c.fecha_desde)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Tipo de acto</label>
            <select className="input" style={fld} value={f.tipo_acto} onChange={e => setF(p => ({ ...p, tipo_acto: e.target.value }))}>
              <option value="">—</option>{TIPOS_ACTO.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div><label style={lbl}>Número de acto *</label>
            <input className="input" style={{ ...fld, fontFamily: 'monospace' }} value={f.numero_acto}
              onChange={e => setF(p => ({ ...p, numero_acto: e.target.value }))} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Destino *</label>
            <input className="input" style={fld} value={f.destino} onChange={e => setF(p => ({ ...p, destino: e.target.value }))} /></div>
          <div><label style={lbl}>Vence (límite)</label>
            <input type="date" className="input" style={fld} value={f.fecha_hasta} onChange={e => setF(p => ({ ...p, fecha_hasta: e.target.value }))} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Observaciones</label>
            <textarea className="input" rows={2} style={{ ...fld, resize: 'vertical' }} value={f.observaciones}
              onChange={e => setF(p => ({ ...p, observaciones: e.target.value }))} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" type="button" onClick={onClose}>Cancelar</button>
          <button className="btn" type="button" disabled={saving} onClick={guardar}
            style={{ background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' }}>{saving ? '⏳…' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export function ComisionesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Comision[]>([]);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState<FiltroEstado>('ACTIVAS');
  const [q, setQ] = useState('');

  const [nuevoDni, setNuevoDni] = useState('');
  const [pase, setPase] = useState<{ dni: number; nombre: string; agenteId?: number; fecha?: string } | null>(null);
  const [regreso, setRegreso] = useState<Comision | null>(null);
  const [editar, setEditar] = useState<Comision | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/comisiones');
      setRows(Array.isArray(res?.data) ? res.data : []);
      setPendientes(Array.isArray(res?.pendientes) ? res.pendientes : []);
    } catch (e: any) {
      toast.error('No se pudieron cargar las comisiones', e?.message);
    } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const buscarParaPase = async () => {
    const dni = nuevoDni.replace(/\D/g, '');
    if (!/^\d{6,8}$/.test(dni)) return toast.error('DNI inválido');
    try {
      const res = await apiFetch<any>(`/personal/${dni}`);
      const d = res?.data;
      if (!d) return toast.error('No se encontró el agente');
      if (!d.has_active_agente) return toast.error('El agente no tiene una vinculación activa', `Estado: ${d.estado_empleo || '—'}`);
      setPase({ dni: Number(dni), nombre: `${d.apellido}, ${d.nombre}` });
    } catch (e: any) { toast.error('No se encontró el agente', e?.message); }
  };

  // ── Indicadores y series ──
  const kpis = useMemo(() => {
    const k = { VIGENTE: 0, POR_VENCER: 0, VENCIDA: 0, FINALIZADA: 0 };
    rows.forEach(r => { k[r.estado]++; });
    const activas = rows.filter(r => r.estado !== 'FINALIZADA');
    const prom = activas.length ? Math.round(activas.reduce((a, r) => a + Number(r.dias || 0), 0) / activas.length) : 0;
    return { ...k, activas: activas.length, prom };
  }, [rows]);

  const porDestino = useMemo(() => {
    const m = new Map<string, number>();
    rows.filter(r => r.estado !== 'FINALIZADA').forEach(r => m.set(r.destino, (m.get(r.destino) ?? 0) + 1));
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 10);
  }, [rows]);

  const movimientos = useMemo(() => {
    const hoy = new Date();
    const meses = rangoMeses(new Date(hoy.getFullYear(), hoy.getMonth() - 23, 1), 24);
    const idx = new Map(meses.map((m, i) => [m, i]));
    const pases = meses.map(() => 0), regresos = meses.map(() => 0);
    rows.forEach(r => {
      const i = idx.get(mesKey(r.fecha_desde)); if (i !== undefined) pases[i]++;
      if (r.fecha_regreso) { const j = idx.get(mesKey(r.fecha_regreso)); if (j !== undefined) regresos[j]++; }
    });
    return { meses, pases, regresos };
  }, [rows]);

  const vencimientos = useMemo(() => {
    const hoy = new Date();
    const meses = rangoMeses(new Date(hoy.getFullYear(), hoy.getMonth(), 1), 12);
    const idx = new Map(meses.map((m, i) => [m, i]));
    const v = meses.map(() => 0);
    rows.filter(r => !r.fecha_regreso && r.fecha_hasta).forEach(r => {
      const i = idx.get(mesKey(r.fecha_hasta!)); if (i !== undefined) v[i]++;
    });
    return { meses, v, sinPlazo: rows.filter(r => !r.fecha_regreso && !r.fecha_hasta).length };
  }, [rows]);

  const visibles = useMemo(() => {
    const t = q.trim().toUpperCase();
    return rows.filter(r =>
      (filtro === 'TODAS' || (filtro === 'ACTIVAS' ? r.estado !== 'FINALIZADA' : r.estado === filtro)) &&
      (!t || `${r.apellido} ${r.nombre} ${r.dni} ${r.destino} ${r.numero_acto} ${r.servicio_origen ?? ''}`.toUpperCase().includes(t)));
  }, [rows, filtro, q]);

  const exportar = () => exportToExcel(`comisiones_${new Date().toISOString().slice(0, 10)}`, visibles.map(r => ({
    DNI: r.dni, Apellido: r.apellido, Nombre: r.nombre, 'Tipo acto': r.tipo_acto ?? '', 'N° acto': r.numero_acto,
    Destino: r.destino, Desde: fmtFecha(r.fecha_desde), Vence: fmtFecha(r.fecha_hasta), Regreso: fmtFecha(r.fecha_regreso),
    'Servicio origen': r.servicio_origen ?? '', 'Servicio regreso': r.servicio_regreso ?? '', Días: r.dias,
    Estado: ESTADO_UI[r.estado].label, Observaciones: r.observaciones ?? '',
  })));

  const Kpi = ({ label, n, color, f }: { label: string; n: number | string; color: string; f?: FiltroEstado }) => (
    <button type="button" className="card" onClick={() => f && setFiltro(f)}
      style={{ ...card, textAlign: 'left', cursor: f ? 'pointer' : 'default', borderLeft: `3px solid ${color}`,
        outline: f && filtro === f ? `1px solid ${color}` : 'none', background: undefined }}>
      <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#e2e8f0' }}>{n}</div>
    </button>
  );

  return (
    <Layout title="Comisiones">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Cabecera + pase nuevo */}
        <div className="card" style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>🧳 Agentes en comisión</div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              El pase cierra el cargo y el servicio con la fecha de inicio. El regreso abre un cargo nuevo en el servicio que elijas.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input" placeholder="DNI del agente" value={nuevoDni} style={{ width: 150 }}
              onChange={e => setNuevoDni(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') buscarParaPase(); }} />
            <button className="btn" type="button" onClick={buscarParaPase}
              style={{ background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' }}>➕ Pase a comisión</button>
          </div>
        </div>

        {/* Indicadores */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <Kpi label="En comisión" n={kpis.activas} color="#3987e5" f="ACTIVAS" />
          <Kpi label="Por vencer (30 días)" n={kpis.POR_VENCER} color="#c98500" f="POR_VENCER" />
          <Kpi label="Vencidas sin regreso" n={kpis.VENCIDA} color="#e66767" f="VENCIDA" />
          <Kpi label="Finalizadas" n={kpis.FINALIZADA} color="#64748b" f="FINALIZADA" />
          <Kpi label="Días promedio (activas)" n={kpis.prom} color="#199e70" />
          <Kpi label="Sin datos cargados" n={pendientes.length} color="#d55181" />
        </div>

        {/* Gráficos */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div className="card" style={card}>
            <h3 style={h3}>En comisión por destino</h3>
            <BarrasHorizontales datos={porDestino} color={SERIE_COLORES[0]} />
          </div>
          <div className="card" style={card}>
            <h3 style={h3}>Pases y regresos por mes (últimos 24)</h3>
            <Columnas meses={movimientos.meses} series={[
              { nombre: 'Pases', color: SERIE_COLORES[0], valores: movimientos.pases },
              { nombre: 'Regresos', color: SERIE_COLORES[2], valores: movimientos.regresos },
            ]} />
          </div>
          <div className="card" style={card}>
            <h3 style={h3}>Vencimientos de los próximos 12 meses</h3>
            <Columnas meses={vencimientos.meses} series={[{ nombre: 'Vencen', color: SERIE_COLORES[3], valores: vencimientos.v }]} />
            {vencimientos.sinPlazo > 0 && (
              <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 4 }}>
                {vencimientos.sinPlazo} comisión(es) activa(s) sin fecha de vencimiento cargada.
              </div>
            )}
          </div>
        </div>

        {/* Pendientes: COMISION viejos sin acto/destino */}
        {pendientes.length > 0 && (
          <div className="card" style={{ ...card, borderLeft: '3px solid #d55181' }}>
            <h3 style={h3}>Figuran en COMISION sin acto ni destino ({pendientes.length})</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {pendientes.map(p => (
                <div key={p.agente_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: '0.78rem' }}>
                  <span>{p.apellido}, {p.nombre} <span style={{ color: '#64748b' }}>· {p.dni}</span></span>
                  <button className="btn" type="button" style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    onClick={() => setPase({ dni: p.dni, nombre: `${p.apellido}, ${p.nombre}`, agenteId: p.agente_id, fecha: p.fecha_egreso ?? undefined })}>
                    Completar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Listado */}
        <div className="card" style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            {(['ACTIVAS', 'VIGENTE', 'POR_VENCER', 'VENCIDA', 'FINALIZADA', 'TODAS'] as FiltroEstado[]).map(fe => (
              <button key={fe} type="button" className="btn" onClick={() => setFiltro(fe)}
                style={{ fontSize: '0.74rem', padding: '3px 10px',
                  ...(filtro === fe ? { background: 'rgba(57,135,229,0.25)', borderColor: '#3987e5', color: '#e2e8f0' } : {}) }}>
                {fe === 'ACTIVAS' ? 'En comisión' : fe === 'TODAS' ? 'Todas' : ESTADO_UI[fe].label}
              </button>
            ))}
            <input className="input" placeholder="Buscar agente, destino, acto…" value={q} onChange={e => setQ(e.target.value)}
              style={{ flex: '1 1 200px', minWidth: 160 }} />
            <button className="btn" type="button" onClick={exportar} disabled={!visibles.length}>⬇ Excel</button>
            <button className="btn" type="button" onClick={cargar}>{loading ? '⏳' : '🔄'}</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>
                <th style={th}>Agente</th><th style={th}>Acto</th><th style={th}>Destino</th>
                <th style={th}>Desde</th><th style={th}>Vence</th><th style={th}>Regreso</th>
                <th style={th}>Servicio</th><th style={th}>Días</th><th style={th}>Estado</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {visibles.map(r => {
                  const e = ESTADO_UI[r.estado];
                  return (
                    <tr key={r.id}>
                      <td style={td}><b>{r.apellido}, {r.nombre}</b><div style={{ color: '#64748b', fontSize: '0.72rem' }}>DNI {r.dni}</div></td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.76rem' }}>
                        {r.tipo_acto && <div style={{ color: '#64748b', fontFamily: 'inherit' }}>{r.tipo_acto}</div>}{r.numero_acto}
                      </td>
                      <td style={td}>{r.destino}</td>
                      <td style={td}>{fmtFecha(r.fecha_desde)}</td>
                      <td style={td}>{fmtFecha(r.fecha_hasta)}</td>
                      <td style={td}>{fmtFecha(r.fecha_regreso)}</td>
                      <td style={{ ...td, fontSize: '0.74rem' }}>
                        <div>de: {r.servicio_origen ?? '—'}</div>
                        {r.servicio_regreso && <div style={{ color: '#4ade80' }}>a: {r.servicio_regreso}</div>}
                      </td>
                      <td style={td}>{r.dias}</td>
                      <td style={td}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                          background: `${e.color}26`, color: e.color, border: `1px solid ${e.color}55`, whiteSpace: 'nowrap' }}>{e.label}</span>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {!r.fecha_regreso && (
                          <button className="btn" type="button" onClick={() => setRegreso(r)}
                            style={{ fontSize: '0.72rem', padding: '2px 8px', background: '#16a34a', color: '#fff', borderColor: '#15803d' }}>↩ Regreso</button>
                        )}{' '}
                        <button className="btn" type="button" onClick={() => setEditar(r)} style={{ fontSize: '0.72rem', padding: '2px 8px' }}>✏️</button>
                      </td>
                    </tr>
                  );
                })}
                {!visibles.length && (
                  <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#64748b', padding: 20 }}>
                    {loading ? 'Cargando…' : 'No hay comisiones para este filtro'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {pase && (
        <PaseComisionModal dni={pase.dni} nombre={pase.nombre} agenteId={pase.agenteId} fechaInicial={pase.fecha}
          onClose={() => setPase(null)} onDone={() => { setPase(null); setNuevoDni(''); cargar(); }} />
      )}
      {regreso && (
        <RegresoComisionModal comision={regreso} onClose={() => setRegreso(null)}
          onDone={() => { setRegreso(null); cargar(); }} />
      )}
      {editar && <EditarComisionModal c={editar} onClose={() => setEditar(null)} onDone={() => { setEditar(null); cargar(); }} />}
    </Layout>
  );
}

export default ComisionesPage;

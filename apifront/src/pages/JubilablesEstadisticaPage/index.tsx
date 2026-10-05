// src/pages/JubilablesEstadisticaPage/index.tsx
// Estadística de jubilables para Dirección Ejecutiva y Docencia: sólo
// porcentajes, gráficos y cantidades — nunca datos de un agente. El backend
// (GET /jubilacion/proyeccion/estadistica) ya devuelve todo agregado por
// servicio+ley, con el escenario fijo "con pago" (beca/residencia y lo anterior
// a Jun/2015 computan como insalubre). Excluye ocupación "a asignar",
// servicio "A UBICAR" y agentes sin servicio. Los servicios que admin marcó
// como controlados llevan un ✔ con tooltip (acá sólo se ven).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';
import {
  GraficoEvolucion, SERIE_COLORES, SERIE_OTRO, type SerieEvolucion,
} from '../HerramientasPage/GraficoEvolucion';
import { BadgeControlado, indexarControles, type ControlServicio } from '../HerramientasPage/ControlServicio';

interface Grupo {
  servicio_id: number | null;
  servicio_nombre: string;
  reparticion_id: number | null;
  dependencia_id: number | null;
  dependencia_nombre: string | null;
  ley_id: number | null;
  total: number;
  excluidos: number;
  fechas: Record<string, number>;
  ultimo_cambio: string | null;
}
interface Estructura {
  dependencias: Array<{ id: number; nombre: string }>;
  reparticiones: Array<{ id: number; nombre: string; dependencia_id: number | null }>;
  servicios: Array<{ id: number; nombre: string; reparticion_id: number | null }>;
  leyes: Array<{ id: number; nombre: string }>;
}

const S: Record<string, React.CSSProperties> = {
  card:   { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 20, marginBottom: 16 },
  label:  { fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 4, display: 'block' },
  input:  { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box', fontSize: '0.85rem' },
  btn:    { cursor: 'pointer', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: '0.84rem', border: 'none' },
  titulo: { fontSize: '0.74rem', color: '#94a3b8', marginBottom: 10 },
};

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtFecha = (v: string | null | undefined) => {
  if (!v) return '—';
  const [y, m, d] = v.slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};
const mesesDespues = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const f = new Date(y, m - 1 + n, d);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};
const pct = (a: number, n: number) => (n ? Math.round(a / n * 100) : 0);

// Fecha en la que se llega al umbral del plantel proyectable (fechas ordenadas).
function fechaUmbral(fechas: string[], umbral: number) {
  const n = fechas.length;
  if (!n) return { fecha: null as string | null, alcanzan: 0 };
  const fecha = fechas[Math.min(n - 1, Math.max(0, Math.ceil((umbral / 100) * n) - 1))];
  return { fecha, alcanzan: fechas.filter(x => x <= fecha).length };
}

// Acumula grupos en una fila: fechas ordenadas (una por agente, sin identidad).
function acumular(gs: Grupo[]) {
  const fechas: string[] = [];
  let total = 0, excluidos = 0;
  for (const g of gs) {
    total += g.total; excluidos += g.excluidos;
    for (const [f, c] of Object.entries(g.fechas)) for (let i = 0; i < c; i++) fechas.push(f);
  }
  fechas.sort();
  return { fechas, total, excluidos };
}

// ── Barras horizontales: % en condiciones hoy / a 6 meses / a 12 meses ──────
function BarrasPorServicio({ filas }: {
  filas: Array<{ key: string; nombre: string; hoy: number; m6: number; m12: number; n: number; badge?: React.ReactNode }>;
}) {
  const colores = ['#22c55e', '#3987e5', '#9085e9'];
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: '0.74rem', color: '#cbd5e1', marginBottom: 10, flexWrap: 'wrap' }}>
        {['Ya en condiciones', 'En 6 meses', 'En 12 meses'].map((l, i) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: colores[i] }} />{l}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filas.map(f => (
          <div key={f.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 240px) 1fr 52px', gap: 10, alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <span title={f.nombre} style={{ fontSize: '0.76rem', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nombre}</span>
              {f.badge}
            </span>
            <div title={`Hoy ${f.hoy}% · 6m ${f.m6}% · 12m ${f.m12}% (de ${f.n} agentes)`}
              style={{ position: 'relative', height: 14, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
              {[f.m12, f.m6, f.hoy].map((v, i) => (
                <div key={i} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${v}%`, background: colores[2 - i], borderRadius: 4 }} />
              ))}
            </div>
            <span style={{ fontSize: '0.76rem', color: '#94a3b8', textAlign: 'right' }}>{f.m12}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Barras verticales: cuántos agentes llegan a cumplir cada año ─────────────
function BarrasPorAnio({ datos }: { datos: Array<{ anio: string; cant: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!datos.length) return null;
  const W = 900, H = 220, M = { top: 18, right: 10, bottom: 26, left: 36 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const max = Math.max(...datos.map(d => d.cant), 1);
  const bw = iw / datos.length;
  const paso = Math.max(1, Math.ceil(datos.length / 14));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Agentes que cumplen por año" style={{ display: 'block' }}>
      {[0, 0.5, 1].map(t => (
        <g key={t}>
          <line x1={M.left} x2={M.left + iw} y1={M.top + ih - t * ih} y2={M.top + ih - t * ih} stroke="rgba(255,255,255,0.07)" />
          <text x={M.left - 6} y={M.top + ih - t * ih} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#64748b">{Math.round(max * t)}</text>
        </g>
      ))}
      {datos.map((d, i) => {
        const h = (d.cant / max) * ih;
        const x = M.left + i * bw;
        return (
          <g key={d.anio} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x} y={M.top} width={bw} height={ih} fill="transparent" />
            <rect x={x + bw * 0.15} y={M.top + ih - h} width={bw * 0.7} height={h} rx={3}
              fill={hover === i ? '#60a5fa' : '#3987e5'} />
            {(hover === i || datos.length <= 20) && d.cant > 0 && (
              <text x={x + bw / 2} y={M.top + ih - h - 5} textAnchor="middle" fontSize="10.5" fill="#cbd5e1">{d.cant}</text>
            )}
            {i % paso === 0 && (
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">{d.anio}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function JubilablesEstadisticaPage() {
  const toast = useToast();
  const [fecha, setFecha]         = useState(hoyISO());
  const [fechaCorrida, setFechaCorrida] = useState<string | null>(null);
  const [grupos, setGrupos]       = useState<Grupo[]>([]);
  const [controles, setControles] = useState<ControlServicio[]>([]);
  const [cargando, setCargando]   = useState(false);
  const [estructura, setEstructura] = useState<Estructura | null>(null);
  const [dep, setDep]             = useState('');
  const [rep, setRep]             = useState('');
  const [srvs, setSrvs]           = useState<string[]>([]);
  const [ley, setLey]             = useState('');
  const [umbral, setUmbral]       = useState(90);

  const correr = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch<any>(`/jubilacion/proyeccion/estadistica?fecha=${encodeURIComponent(fecha)}`);
      if (!res?.ok) { toast.error(res?.error ?? 'Error al calcular'); return; }
      setGrupos(res.grupos ?? []);
      setControles(res.servicios_controlados ?? []);
      setFechaCorrida(res.fecha);
    } catch (e: any) {
      toast.error('Error al calcular: ' + e?.message);
    } finally { setCargando(false); }
  }, [fecha, toast]);

  useEffect(() => {
    apiFetch<any>('/jubilacion/proyeccion/estructura')
      .then(r => { if (r?.data) setEstructura(r.data); })
      .catch(() => { /* sin catálogos los filtros quedan vacíos */ });
    correr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const corte = fechaCorrida ?? fecha;
  const corte6 = mesesDespues(corte, 6);
  const corte12 = mesesDespues(corte, 12);

  const reparticiones = useMemo(() => {
    const todas = estructura?.reparticiones ?? [];
    return dep ? todas.filter(r => String(r.dependencia_id ?? '') === dep) : todas;
  }, [estructura, dep]);
  const servicios = useMemo(() => {
    // "A UBICAR" no es un servicio real: el backend ya lo excluye.
    const todos = (estructura?.servicios ?? []).filter(s => !/^\s*A\s+UBICAR\s*$/i.test(s.nombre));
    if (rep) return todos.filter(s => String(s.reparticion_id ?? '') === rep);
    if (dep) {
      const ids = new Set(reparticiones.map(r => String(r.id)));
      return todos.filter(s => ids.has(String(s.reparticion_id ?? '')));
    }
    return todos;
  }, [estructura, dep, rep, reparticiones]);

  const filtrados = useMemo(() => grupos.filter(g => {
    if (dep && String(g.dependencia_id ?? '') !== dep) return false;
    if (rep && String(g.reparticion_id ?? '') !== rep) return false;
    if (ley && String(g.ley_id ?? '') !== ley) return false;
    if (srvs.length && !srvs.includes(String(g.servicio_id ?? ''))) return false;
    return true;
  }), [grupos, dep, rep, ley, srvs]);

  const controlPorSrv = useMemo(() => indexarControles(controles), [controles]);

  // Una fila por servicio (suma sus leyes).
  const porServicio = useMemo(() => {
    const m = new Map<string, Grupo[]>();
    for (const g of filtrados) {
      const k = String(g.servicio_id ?? 'SIN');
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    }
    const filas = Array.from(m.entries()).map(([key, gs]) => {
      const a = acumular(gs);
      const n = a.fechas.length;
      const u = fechaUmbral(a.fechas, umbral);
      const cuenta = (f: string) => a.fechas.filter(x => x <= f).length;
      return {
        key, nombre: gs[0].servicio_nombre, dependencia: gs[0].dependencia_nombre ?? '',
        ultimo_cambio: gs.map(x => x.ultimo_cambio).filter(Boolean).sort().pop() ?? null,
        total: a.total, proyectables: n, excluidos: a.excluidos, fechas: a.fechas,
        hoy: cuenta(corte), m6: cuenta(corte6), m12: cuenta(corte12),
        fecha_umbral: u.fecha, alcanzan: u.alcanzan,
      };
    });
    filas.sort((a, b) => {
      if (!a.fecha_umbral && !b.fecha_umbral) return a.nombre.localeCompare(b.nombre);
      if (!a.fecha_umbral) return 1;
      if (!b.fecha_umbral) return -1;
      return a.fecha_umbral.localeCompare(b.fecha_umbral);
    });
    return filas;
  }, [filtrados, umbral, corte, corte6, corte12]);

  const total = useMemo(() => {
    const a = acumular(filtrados);
    const cuenta = (f: string) => a.fechas.filter(x => x <= f).length;
    const u = fechaUmbral(a.fechas, umbral);
    return { ...a, n: a.fechas.length, hoy: cuenta(corte), m6: cuenta(corte6), m12: cuenta(corte12), ...u };
  }, [filtrados, umbral, corte, corte6, corte12]);

  // Año a año desde la fecha del cálculo hasta que cumple todo el plantel (tope 40).
  const evolucion = useMemo(() => {
    const n = total.fechas.length;
    if (!n) return [] as Array<{ fecha: string; cantidad: number; pct: number }>;
    const y = Number(corte.slice(0, 4)), resto = corte.slice(4, 10);
    const out: Array<{ fecha: string; cantidad: number; pct: number }> = [];
    for (let k = 0; k <= 40; k++) {
      const f = `${y + k}${resto}`;
      const cantidad = total.fechas.filter(x => x <= f).length;
      out.push({ fecha: f, cantidad, pct: pct(cantidad, n) });
      if (cantidad === n) break;
    }
    return out;
  }, [total, corte]);

  const series = useMemo((): SerieEvolucion[] => {
    const filas = porServicio.filter(g => g.proyectables > 0);
    const orden = srvs.length ? srvs : [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(g => g.key);
    return filas
      .map(g => {
        const idx = orden.indexOf(g.key);
        return {
          key: g.key, nombre: g.nombre, n: g.proyectables, idx,
          color: idx >= 0 && idx < SERIE_COLORES.length ? SERIE_COLORES[idx] : SERIE_OTRO,
          puntos: evolucion.map(e => {
            const cant = g.fechas.filter(x => x <= e.fecha).length;
            return { fecha: e.fecha, cant, pct: pct(cant, g.proyectables) };
          }),
        };
      })
      .sort((a, b) => a.idx - b.idx);
  }, [porServicio, evolucion, srvs]);

  const serieTotal = useMemo((): SerieEvolucion[] => evolucion.length ? [{
    key: 'TOTAL', nombre: 'Total del plantel filtrado', color: '#86efac', n: total.n,
    puntos: evolucion.map(e => ({ fecha: e.fecha, cant: e.cantidad, pct: e.pct })),
  }] : [], [evolucion, total.n]);

  // Cuántos llegan a cumplir en cada año calendario (los que ya cumplen, en el año del cálculo).
  const porAnio = useMemo(() => {
    if (!total.fechas.length) return [];
    const desde = Number(corte.slice(0, 4));
    const hasta = Number(total.fechas[total.fechas.length - 1].slice(0, 4));
    const m = new Map<string, number>();
    for (let a = desde; a <= hasta; a++) m.set(String(a), 0);
    for (const f of total.fechas) {
      const a = String(Math.max(desde, Number(f.slice(0, 4))));
      m.set(a, (m.get(a) ?? 0) + 1);
    }
    return Array.from(m.entries()).map(([anio, cant]) => ({ anio, cant }));
  }, [total, corte]);

  const exportar = useCallback(() => {
    if (!porServicio.length) { toast.error('No hay filas para exportar'); return; }
    exportToExcel(`jubilables_estadistica_${corte}`, porServicio.map(g => ({
      Servicio: g.nombre,
      Dependencia: g.dependencia,
      'Plantel': g.total,
      'Proyectables': g.proyectables,
      [`% en condiciones al ${fmtFecha(corte)}`]: g.proyectables ? `${pct(g.hoy, g.proyectables)}%` : '',
      '% en 6 meses': g.proyectables ? `${pct(g.m6, g.proyectables)}%` : '',
      '% en 12 meses': g.proyectables ? `${pct(g.m12, g.proyectables)}%` : '',
      [`Fecha en que se llega al ${umbral}%`]: fmtFecha(g.fecha_umbral),
    })));
  }, [porServicio, corte, umbral, toast]);

  const hayFiltros = !!(dep || rep || srvs.length || ley);
  const badge = (g: { key: string; ultimo_cambio: string | null }) =>
    <BadgeControlado control={controlPorSrv.get(g.key)} ultimoCambio={g.ultimo_cambio} />;
  const controlados = porServicio.filter(g => controlPorSrv.has(g.key)).length;

  return (
    <Layout title="Jubilables · Estadística">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>📈 Jubilables por servicio</h1>
        <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
          Porcentaje del plantel de cada servicio en condiciones de jubilarse y fecha en la que se llega
          al {umbral}%. Sólo números agregados. Quedan afuera los agentes que no computan aportes o no
          tienen datos para proyectar, los de ocupación «a asignar» y los que no tienen servicio.
        </p>
      </div>

      <div style={S.card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <div>
            <label style={S.label}>Fecha del cálculo</label>
            <input type="date" style={S.input} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Dependencia</label>
            <select style={S.input} value={dep} onChange={e => { setDep(e.target.value); setRep(''); setSrvs([]); }}>
              <option value="">Todas</option>
              {(estructura?.dependencias ?? []).map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Repartición</label>
            <select style={S.input} value={rep} onChange={e => { setRep(e.target.value); setSrvs([]); }}>
              <option value="">Todas</option>
              {reparticiones.map(r => <option key={r.id} value={String(r.id)}>{r.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Servicios</label>
            <select style={S.input} value=""
              onChange={e => { const v = e.target.value; if (v) setSrvs(p => p.includes(v) ? p : [...p, v]); }}>
              <option value="">{srvs.length ? '+ Agregar otro servicio…' : 'Todos (agregar servicio…)'}</option>
              {servicios.map(s => <option key={s.id} value={String(s.id)}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Ley</label>
            <select style={S.input} value={ley} onChange={e => setLey(e.target.value)}>
              <option value="">Todas</option>
              {(estructura?.leyes ?? []).map(l => <option key={l.id} value={String(l.id)}>{l.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Umbral</label>
            <select style={S.input} value={umbral} onChange={e => setUmbral(Number(e.target.value))}>
              {[25, 50, 75, 90, 95].map(p => <option key={p} value={p}>{p}% del plantel</option>)}
            </select>
          </div>
        </div>

        {srvs.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {srvs.map(id => (
              <span key={id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(167,139,250,0.4)',
                color: '#ddd6fe', borderRadius: 999, padding: '3px 6px 3px 12px', fontSize: '0.76rem',
              }}>
                {estructura?.servicios.find(s => String(s.id) === id)?.nombre ?? `Servicio ${id}`}
                <button title="Quitar" onClick={() => setSrvs(p => p.filter(x => x !== id))} style={{
                  background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ddd6fe',
                  borderRadius: 999, width: 18, height: 18, cursor: 'pointer', lineHeight: '16px', padding: 0,
                }}>×</button>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={{ ...S.btn, background: '#7c3aed', color: '#fff', opacity: cargando ? 0.6 : 1 }}
            disabled={cargando} onClick={correr}>
            {cargando ? 'Calculando…' : '🔄 Recalcular a esta fecha'}
          </button>
          <button style={{ ...S.btn, background: '#166534', color: '#fff' }} onClick={exportar} disabled={!porServicio.length}>
            📊 Exportar Excel
          </button>
          {hayFiltros && (
            <button style={{ ...S.btn, background: 'rgba(255,255,255,0.07)', color: '#cbd5e1' }}
              onClick={() => { setDep(''); setRep(''); setSrvs([]); setLey(''); }}>
              Limpiar filtros
            </button>
          )}
          {fechaCorrida && <span style={{ fontSize: '0.74rem', color: '#64748b' }}>Parado al {fmtFecha(fechaCorrida)}</span>}
        </div>
        {fechaCorrida && fecha !== fechaCorrida && (
          <div style={{ fontSize: '0.74rem', color: '#fdba74', marginTop: 8 }}>
            ⚠️ La fecha cambió: apretá «Recalcular» para actualizar.
          </div>
        )}
      </div>

      <div style={{
        background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.30)', borderRadius: 10,
        padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#d8b4fe', lineHeight: 1.5,
      }}>
        💰 <b>Escenario:</b> la beca / residencia / concurrencia (ingreso → nombramiento) computa como
        servicio insalubre, y lo anterior a Jun/2015 también pasa a insalubre (2% pagado). Desde Jun/2015
        todo computa insalubre.
      </div>

      {cargando && !grupos.length ? (
        <div style={{ ...S.card, textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem', padding: '40px 0' }}>
          Proyectando el padrón… puede demorar unos segundos.
        </div>
      ) : (
        <>
          {/* ─ Tarjetas ─ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { t: 'Plantel proyectable', v: String(total.n), s: total.excluidos ? `${total.excluidos} excluidos (no computa/sin datos)` : `de ${total.total} agentes`, c: '#e2e8f0' },
              { t: `En condiciones al ${fmtFecha(corte)}`, v: `${pct(total.hoy, total.n)}%`, s: `${total.hoy} de ${total.n}`, c: '#86efac' },
              { t: 'En 6 meses', v: `${pct(total.m6, total.n)}%`, s: `${total.m6} de ${total.n}`, c: '#93c5fd' },
              { t: 'En 12 meses', v: `${pct(total.m12, total.n)}%`, s: `${total.m12} de ${total.n}`, c: '#c4b5fd' },
              { t: `Se llega al ${umbral}%`, v: fmtFecha(total.fecha), s: total.n ? `${pct(total.alcanzan, total.n)}% · ${total.alcanzan} de ${total.n}` : '', c: '#fcd34d' },
              { t: 'Servicios controlados ✔', v: `${controlados} de ${porServicio.length}`, s: porServicio.length ? `${pct(controlados, porServicio.length)}% de los servicios` : '', c: '#86efac' },
            ].map(k => (
              <div key={k.t} style={{ ...S.card, marginBottom: 0, padding: 16 }}>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{k.t}</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: k.c }}>{k.v}</div>
                <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{k.s}</div>
              </div>
            ))}
          </div>

          {/* ─ Evolución por servicio ─ */}
          {evolucion.length > 0 && porServicio.length > 0 && (
            <div style={S.card}>
              <div style={S.titulo}>EVOLUCIÓN POR SERVICIO · % de cada plantel en condiciones, año a año</div>
              {series.length > 0 && series.length <= SERIE_COLORES.length ? (
                <div style={{ marginBottom: 16 }}><GraficoEvolucion series={series} umbral={umbral} /></div>
              ) : (
                <>
                  <div style={{ marginBottom: 8 }}><GraficoEvolucion series={serieTotal} umbral={umbral} /></div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: 12 }}>
                    Se muestra el total. Para comparar servicios (hasta {SERIE_COLORES.length}), elegilos en «Servicios».
                  </div>
                </>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: '100%' }}>
                  <thead>
                    <tr style={{ color: '#94a3b8' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', position: 'sticky', left: 0, background: '#111827', minWidth: 200 }}>Servicio</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Proy.</th>
                      {evolucion.map(e => (
                        <th key={e.fecha} style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{e.fecha.slice(0, 4)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {porServicio.map(g => (
                      <tr key={g.key} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 600, position: 'sticky', left: 0, background: '#111827' }}>{g.nombre}{badge(g)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#94a3b8' }}>{g.proyectables}</td>
                        {evolucion.map(e => {
                          if (!g.proyectables) return <td key={e.fecha} style={{ padding: '6px 8px', textAlign: 'right', color: '#475569' }}>—</td>;
                          const cant = g.fechas.filter(x => x <= e.fecha).length;
                          const p = pct(cant, g.proyectables);
                          return (
                            <td key={e.fecha} title={`${cant} de ${g.proyectables} al ${fmtFecha(e.fecha)}`} style={{
                              padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap',
                              color: p >= umbral ? '#86efac' : p > 0 ? '#e2e8f0' : '#475569',
                              fontWeight: p >= umbral ? 700 : 400,
                            }}>{p}%</td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 8 }}>
                Cada columna es al {fmtFecha(corte).split('/').slice(0, 2).join('/')} de ese año.
                En verde, los que ya pasaron el {umbral}%. Pasá el mouse para ver la cantidad.
              </div>
            </div>
          )}

          {/* ─ Evolución total año a año ─ */}
          {evolucion.length > 0 && (
            <div style={S.card}>
              <div style={S.titulo}>EVOLUCIÓN · % del plantel filtrado en condiciones, año a año</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8 }}>
                {evolucion.map((e, i) => {
                  const sube = i > 0 && e.cantidad > evolucion[i - 1].cantidad;
                  return (
                    <div key={e.fecha} style={{
                      borderRadius: 10, padding: '8px 10px',
                      background: e.pct >= umbral ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${e.pct >= umbral ? 'rgba(134,239,172,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    }}>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>al {fmtFecha(e.fecha)}</div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: sube || i === 0 ? '#86efac' : '#64748b' }}>{e.pct}%</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{e.cantidad} de {total.n}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─ Barras por año ─ */}
          {porAnio.length > 0 && (
            <div style={S.card}>
              <div style={S.titulo}>AGENTES QUE LLEGAN A CUMPLIR, POR AÑO</div>
              <BarrasPorAnio datos={porAnio} />
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 6 }}>
                En {corte.slice(0, 4)} se suman también los que ya están en condiciones.
              </div>
            </div>
          )}

          {/* ─ Barras por servicio ─ */}
          {porServicio.some(g => g.proyectables > 0) && (
            <div style={S.card}>
              <div style={S.titulo}>% DE CADA SERVICIO EN CONDICIONES · hoy, a 6 y a 12 meses</div>
              <BarrasPorServicio filas={[...porServicio]
                .filter(g => g.proyectables > 0)
                .map(g => ({
                  key: g.key, nombre: g.nombre, n: g.proyectables, badge: badge(g),
                  hoy: pct(g.hoy, g.proyectables), m6: pct(g.m6, g.proyectables), m12: pct(g.m12, g.proyectables),
                }))
                .sort((a, b) => b.m12 - a.m12 || b.hoy - a.hoy || a.nombre.localeCompare(b.nombre))} />
            </div>
          )}

          {/* ─ Tabla por servicio ─ */}
          <div style={S.card}>
            <div style={S.titulo}>DETALLE POR SERVICIO</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                    {['Servicio', 'Plantel', 'Proyectables', `Al ${fmtFecha(corte)}`, 'En 6 meses', 'En 12 meses', `Llega al ${umbral}%`].map((h, i) => (
                      <th key={h} style={{ padding: '8px 6px', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {porServicio.map(g => (
                    <tr key={g.key} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                      <td style={{ padding: '7px 6px', fontWeight: 600 }}>
                        {g.nombre}{badge(g)}
                        {g.dependencia && <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>{g.dependencia}</div>}
                      </td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', color: '#94a3b8' }}>{g.total}</td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', color: '#94a3b8' }}>{g.proyectables}</td>
                      {[g.hoy, g.m6, g.m12].map((c, i) => (
                        <td key={i} style={{ padding: '7px 6px', textAlign: 'right' }}>
                          {g.proyectables ? <><b>{pct(c, g.proyectables)}%</b> <span style={{ color: '#64748b' }}>({c})</span></> : '—'}
                        </td>
                      ))}
                      <td style={{ padding: '7px 6px', textAlign: 'right', color: '#93c5fd', fontWeight: 700 }}>{fmtFecha(g.fecha_umbral)}</td>
                    </tr>
                  ))}
                  {!porServicio.length && (
                    <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>Sin datos para los filtros elegidos.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}

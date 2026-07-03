// src/pages/DirectorEjecutivoPage/index.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Layout }    from '../../components/Layout';
import { apiFetch }  from '../../api/http';
import { useToast }  from '../../ui/toast';
import { exportToExcel } from '../../utils/export';

async function fetchAll<T = any>(url: string): Promise<T[]> {
  let all: T[] = [], page = 1, total = Infinity;
  while (all.length < total) {
    const sep = url.includes('?') ? '&' : '?';
    const res = await apiFetch<any>(`${url}${sep}limit=500&page=${page}`);
    const rows: T[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total);
    else total = all.length;
    if (rows.length < 500) break;
    page++;
  }
  return all;
}

function fmt(d?: string | null) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return `${day}/${m}/${y}`;
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 12, padding: 20, marginBottom: 20,
};
const thSt: React.CSSProperties = {
  textAlign: 'left', padding: '7px 10px', fontSize: '0.68rem',
  textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b',
  borderBottom: '1px solid rgba(255,255,255,0.10)', whiteSpace: 'nowrap',
};
const tdSt: React.CSSProperties = { padding: '7px 10px', fontSize: '0.8rem' };

export function DirectorEjecutivoPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [step,    setStep]    = useState('');

  // ── Datos enfermeros por servicio ─────────────────────────────────────────
  interface SvcRow { servicio: string; total: number; sectores: { nombre: string; total: number }[] }
  const [svcRows, setSvcRows] = useState<SvcRow[]>([]);

  // ── Datos ingresos 2026+ ──────────────────────────────────────────────────
  interface IngresoRow {
    dni: number; apellido: string; nombre: string;
    fecha_ingreso: string | null; ley: string; servicio: string; ocupacion: string;
  }
  const [ingresos, setIngresos] = useState<IngresoRow[]>([]);
  const [filtroLey, setFiltroLey] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      // Catálogos
      setStep('Cargando catálogos…');
      const [rOcup, rSrv, rSec, rLey] = await Promise.all([
        fetchAll('/ocupaciones'),
        fetchAll('/servicios'),
        fetchAll('/sectores'),
        fetchAll('/ley'),
      ]);
      const ocupMap: Record<number, string> = {};
      for (const o of rOcup) ocupMap[o.id] = o.nombre;
      const srvMap: Record<number, string> = {};
      for (const s of rSrv) srvMap[s.id] = s.nombre;
      const secMap: Record<number, string> = {};
      for (const s of rSec) secMap[s.id] = s.nombre;
      const leyMap: Record<number, string> = {};
      for (const l of rLey) leyMap[l.id] = l.nombre;

      // IDs de ocupaciones enfermería
      const enfIds = new Set(
        rOcup.filter((o: any) => /enfer/i.test(o.nombre)).map((o: any) => o.id)
      );

      // Agentes con servicio activo
      setStep('Cargando servicios…');
      const pases = await fetchAll('/agentes_servicios');
      const pasesActivos = pases.filter((p: any) => !p.fecha_hasta);

      // Agentes para ocupacion
      setStep('Cargando agentes…');
      const agentes = await fetchAll('/agentes');
      const agenteOcup: Record<number, number> = {};
      for (const a of agentes) agenteOcup[a.dni] = a.ocupacion_id;

      // ── Enfermeros por servicio ───────────────────────────────────────────
      const bySrv: Record<number, { total: number; bySec: Record<string, number> }> = {};
      for (const p of pasesActivos) {
        if (!enfIds.has(agenteOcup[p.dni])) continue;
        const sid = p.servicio_id;
        if (!bySrv[sid]) bySrv[sid] = { total: 0, bySec: {} };
        bySrv[sid].total++;
        const secKey = p.sector_id ? String(p.sector_id) : '__none__';
        bySrv[sid].bySec[secKey] = (bySrv[sid].bySec[secKey] || 0) + 1;
      }
      const svcRowsBuilt: SvcRow[] = Object.entries(bySrv)
        .map(([srvId, data]) => ({
          servicio: srvMap[Number(srvId)] || `Servicio #${srvId}`,
          total: data.total,
          sectores: Object.entries(data.bySec)
            .map(([secId, tot]) => ({
              nombre: secId === '__none__' ? 'Sin sector' : (secMap[Number(secId)] || `Sector #${secId}`),
              total: tot as number,
            }))
            .sort((a, b) => b.total - a.total),
        }))
        .sort((a, b) => b.total - a.total);
      setSvcRows(svcRowsBuilt);

      // ── Ingresos 2026+ ────────────────────────────────────────────────────
      setStep('Cargando ingresos…');
      const personal = await fetchAll('/personal/search?estado_empleo=ACTIVO');
      const dniSrvActivo: Record<number, number> = {};
      for (const p of pasesActivos) dniSrvActivo[p.dni] = p.servicio_id;

      const ingresoRows: IngresoRow[] = personal
        .filter((p: any) => p.fecha_ingreso && p.fecha_ingreso >= '2026-01-01')
        .map((p: any) => ({
          dni:          p.dni,
          apellido:     p.apellido,
          nombre:       p.nombre,
          fecha_ingreso: p.fecha_ingreso,
          ley:          leyMap[p.ley_id] || p.ley_nombre || '—',
          servicio:     srvMap[dniSrvActivo[p.dni]] || '—',
          ocupacion:    ocupMap[agenteOcup[p.dni]]  || '—',
        }))
        .sort((a: IngresoRow, b: IngresoRow) =>
          (b.fecha_ingreso || '').localeCompare(a.fecha_ingreso || '')
        );
      setIngresos(ingresoRows);

    } catch (e: any) {
      toast.error('Error cargando datos', e?.message);
    } finally {
      setLoading(false);
      setStep('');
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Filtros ingresos ──────────────────────────────────────────────────────
  const leyes = [...new Set(ingresos.map(r => r.ley))].sort();
  const ingresosFiltrados = ingresos.filter(r => !filtroLey || r.ley === filtroLey);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Layout title="Dirección Ejecutiva" showBack>
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⏳</div>
          <div style={{ fontWeight: 700 }}>{step || 'Cargando…'}</div>
        </div>
      </Layout>
    );
  }

  const totalEnfermeros = svcRows.reduce((s, r) => s + r.total, 0);

  const selSt: React.CSSProperties = {
    fontSize: '0.76rem', padding: '5px 10px',
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6, color: 'inherit',
  };

  return (
    <Layout title="Dirección Ejecutiva" showBack>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>
            🏥 Panel Dirección Ejecutiva
          </h1>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
            FERNANDEZ VIÑA, VALERIA SILVINA — Directora Ejecutiva
          </p>
        </div>

        {/* ── Enfermeros por servicio ── */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 2 }}>🩺 Enfermeros por servicio</div>
              <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                Agentes con ocupación de enfermería activos por servicio · <strong style={{ color: '#86efac' }}>{totalEnfermeros} total</strong>
              </div>
            </div>
            <button className="btn" style={{ fontSize: '0.75rem' }}
              onClick={() => exportToExcel('enfermeros_por_servicio', svcRows.flatMap(r =>
                r.sectores.length > 1
                  ? r.sectores.map(s => ({ Servicio: r.servicio, Sector: s.nombre, Total: s.total }))
                  : [{ Servicio: r.servicio, Sector: '—', Total: r.total }]
              ))}>
              Excel
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={thSt}>Servicio</th>
                  <th style={thSt}>Sector</th>
                  <th style={{ ...thSt, textAlign: 'right' }}>Enfermeros</th>
                </tr>
              </thead>
              <tbody>
                {svcRows.map((row, i) => (
                  row.sectores.length <= 1 ? (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ ...tdSt, fontWeight: 600 }}>{row.servicio}</td>
                      <td style={{ ...tdSt, color: '#64748b' }}>—</td>
                      <td style={{ ...tdSt, textAlign: 'right', fontWeight: 700, color: '#86efac' }}>{row.total}</td>
                    </tr>
                  ) : (
                    <React.Fragment key={i}>
                      {/* Fila total del servicio */}
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                        <td style={{ ...tdSt, fontWeight: 700, color: '#a5b4fc' }} colSpan={2}>{row.servicio}</td>
                        <td style={{ ...tdSt, textAlign: 'right', fontWeight: 800, color: '#a5b4fc' }}>{row.total}</td>
                      </tr>
                      {/* Filas por sector */}
                      {row.sectores.map((s, j) => (
                        <tr key={j} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ ...tdSt, paddingLeft: 24, color: '#64748b' }}></td>
                          <td style={{ ...tdSt, color: 'rgba(255,255,255,0.65)' }}>↳ {s.nombre}</td>
                          <td style={{ ...tdSt, textAlign: 'right', fontWeight: 600 }}>{s.total}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Ingresos 2026+ ── */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 2 }}>📋 Ingresos desde 2026</div>
              <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                Agentes activos con fecha de ingreso a partir del 1/1/2026 · <strong style={{ color: '#93c5fd' }}>{ingresosFiltrados.length}</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select style={selSt} value={filtroLey} onChange={e => setFiltroLey(e.target.value)}>
                <option value="">Todas las leyes</option>
                {leyes.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <button className="btn" style={{ fontSize: '0.75rem' }}
                onClick={() => exportToExcel('ingresos_2026', ingresosFiltrados.map(r => ({
                  DNI: r.dni, Apellido: r.apellido, Nombre: r.nombre,
                  'Fecha Ingreso': fmt(r.fecha_ingreso), Ley: r.ley,
                  Ocupación: r.ocupacion, Servicio: r.servicio,
                })))}>
                Excel
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                  <th style={thSt}>Fecha</th>
                  <th style={thSt}>Apellido y Nombre</th>
                  <th style={thSt}>DNI</th>
                  <th style={thSt}>Ley</th>
                  <th style={thSt}>Ocupación</th>
                  <th style={thSt}>Servicio</th>
                </tr>
              </thead>
              <tbody>
                {ingresosFiltrados.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap', color: '#93c5fd', fontWeight: 600 }}>{fmt(r.fecha_ingreso)}</td>
                    <td style={{ ...tdSt, fontWeight: 600 }}>{r.apellido}, {r.nombre}</td>
                    <td style={{ ...tdSt, color: '#64748b' }}>{r.dni}</td>
                    <td style={tdSt}>{r.ley}</td>
                    <td style={{ ...tdSt, color: 'rgba(255,255,255,0.7)' }}>{r.ocupacion}</td>
                    <td style={{ ...tdSt, color: 'rgba(255,255,255,0.6)' }}>{r.servicio}</td>
                  </tr>
                ))}
                {ingresosFiltrados.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#475569' }}>Sin ingresos para el filtro seleccionado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </Layout>
  );
}

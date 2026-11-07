// Licencias por agente (04/11/2026): para un rango de fechas, qué licencias/novedades tiene cada agente en
// SIAPE, en el Ministerio y en Salud Laboral, una tabla por agente, paginado (GET /comparacion-v2/licencias-agentes).
// Se abre desde Comparador SIAPE → Control de cruces → "👤 Licencias por agente".
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';

interface Lic { fuente: string; novedad: string; desde: string; hasta: string; detalle: string; dependencia: string }
interface Agente { dni: number; nombre: string; ley: string; dependencias: string[]; licencias: Lic[] }
interface Resp { ok: boolean; error?: string; desde: string; hasta: string; page: number; pageSize: number; total: number; paginas: number; agentes: Agente[] }

const COLOR: Record<string, string> = { 'SIAPE': '#38bdf8', 'Ministerio': '#a78bfa', 'Salud Laboral': '#10b981' };
const fmt = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
const dias = (d: string, h: string) => Math.round((Date.parse(h) - Date.parse(d)) / 86400000) + 1;
const mesAnterior = () => {
  const h = new Date(); const i = new Date(h.getFullYear(), h.getMonth() - 1, 1); const f = new Date(h.getFullYear(), h.getMonth(), 0);
  const s = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [s(i), s(f)];
};

export function LicenciasPorAgentePage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [d0, h0] = mesAnterior();
  const mesParam = params.get('mes');
  const ini = mesParam ? `${mesParam}-01` : d0;
  const fin = mesParam ? (() => { const [a, m] = mesParam.split('-').map(Number); const f = new Date(a, m, 0); return `${a}-${String(m).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`; })() : h0;
  const [desde, setDesde] = useState(ini);
  const [hasta, setHasta] = useState(fin);
  const [q, setQ] = useState('');
  const [dep, setDep] = useState('');
  const [fuentes, setFuentes] = useState<string[]>(['SIAPE', 'MINISTERIO', 'SALUD']);
  const [parciales, setParciales] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useCallback((p: number, todo = false) => {
    const u = new URLSearchParams({ desde, hasta, q, dep, fuentes: fuentes.join(','), page: String(p), pageSize: String(pageSize) });
    if (parciales) u.set('parciales', '1');
    if (todo) u.set('todo', '1');
    return `/comparacion-v2/licencias-agentes?${u.toString()}`;
  }, [desde, hasta, q, dep, fuentes, parciales, pageSize]);

  const cargar = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const r = await apiFetch<Resp>(query(p));
      setData(r); setPage(p);
    } catch (e: any) {
      toast.error('No pude leer las licencias', e?.message || '');
    } finally { setLoading(false); }
  }, [query, toast]);

  useEffect(() => { cargar(1); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const exportar = async () => {
    try {
      const r = await apiFetch<Resp>(query(1, true));
      exportToExcel(`licencias_por_agente_${desde}_${hasta}`, r.agentes.flatMap(a => a.licencias.map(l => ({
        DNI: a.dni, Agente: a.nombre, Ley: a.ley, Dependencia: l.dependencia || a.dependencias.join(', '),
        Fuente: l.fuente, Novedad: l.novedad, Desde: fmt(l.desde), Hasta: fmt(l.hasta), Dias: dias(l.desde, l.hasta), Detalle: l.detalle,
      }))));
    } catch (e: any) { toast.error('No pude exportar', e?.message || ''); }
  };
  const toggleFuente = (f: string) => setFuentes(v => (v.includes(f) ? v.filter(x => x !== f) : [...v, f]));
  const paginador = data && data.paginas > 1 && (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', margin: '10px 0' }}>
      <button className="btn" disabled={page <= 1 || loading} onClick={() => cargar(1)}>⏮</button>
      <button className="btn" disabled={page <= 1 || loading} onClick={() => cargar(page - 1)}>◀</button>
      <span className="muted" style={{ fontSize: '0.8rem' }}>Página {page} de {data.paginas} · {data.total} agentes</span>
      <button className="btn" disabled={page >= data.paginas || loading} onClick={() => cargar(page + 1)}>▶</button>
      <button className="btn" disabled={page >= data.paginas || loading} onClick={() => cargar(data.paginas)}>⏭</button>
    </div>
  );

  return (
    <Layout title="Licencias por agente" showBack>
      <strong>👤 Licencias por agente</strong>
      <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 12 }}>
        Lo que tiene cada agente en SIAPE, en el Ministerio y en Salud Laboral para el período elegido.
      </div>
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label className="muted" style={{ fontSize: '0.75rem' }}>Desde <input className="input" type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
        <label className="muted" style={{ fontSize: '0.75rem' }}>Hasta <input className="input" type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} /></label>
        <input className="input" placeholder="Agente, DNI o novedad…" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') cargar(1); }} style={{ width: 220 }} />
        <select className="input" value={dep} onChange={e => setDep(e.target.value)} style={{ width: 150 }}>
          <option value="">Todas las dependencias</option>
          <option value="HOSPITAL">HOSPITAL</option><option value="UPA 4">UPA 4</option><option value="UPA 18">UPA 18</option>
        </select>
        {[['SIAPE', 'SIAPE'], ['MINISTERIO', 'Ministerio'], ['SALUD', 'Salud Laboral']].map(([k, l]) => (
          <label key={k} style={{ fontSize: '0.78rem', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={fuentes.includes(k)} onChange={() => toggleFuente(k)} />{l}
          </label>
        ))}
        <label style={{ fontSize: '0.78rem', display: 'flex', gap: 4, alignItems: 'center' }} title="Boletas de salida, llegadas tarde, lactancia, permisos por horas">
          <input type="checkbox" checked={parciales} onChange={e => setParciales(e.target.checked)} />Incluir permisos por horas
        </label>
        <select className="input" value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ width: 110 }}>
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} por página</option>)}
        </select>
        <button className="btn js-btn-save" onClick={() => cargar(1)} disabled={loading}>{loading ? '⏳' : '🔎 Buscar'}</button>
        <button className="btn" onClick={exportar} disabled={!data?.total}>⬇ Excel</button>
      </div>

      {paginador}
      {loading && !data && <div className="card muted" style={{ padding: 20, textAlign: 'center' }}>⏳ Leyendo…</div>}
      {data && !data.agentes.length && <div className="card muted" style={{ padding: 20, textAlign: 'center' }}>No hay licencias para esos filtros.</div>}
      {data?.agentes.map(a => (
        <div key={a.dni} className="card" style={{ marginBottom: 10, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <div>
              <strong>{a.nombre || `DNI ${a.dni}`}</strong>
              <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 8 }}>DNI {a.dni} · {a.ley || 'sin ley'}{a.dependencias.length ? ` · ${a.dependencias.join(', ')}` : ''}</span>
            </div>
            <span className="muted" style={{ fontSize: '0.75rem' }}>{a.licencias.length} registro{a.licencias.length !== 1 ? 's' : ''}</span>
          </div>
          <table className="table" style={{ width: '100%', fontSize: '0.78rem' }}>
            <thead><tr><th style={{ width: 110 }}>Fuente</th><th>Novedad</th><th style={{ width: 95 }}>Desde</th><th style={{ width: 95 }}>Hasta</th><th style={{ width: 50 }}>Días</th><th>Detalle</th></tr></thead>
            <tbody>
              {a.licencias.map((l, i) => (
                <tr key={i}>
                  <td style={{ color: COLOR[l.fuente] || '#e2e8f0', fontWeight: 600 }}>{l.fuente}</td>
                  <td>{l.novedad}</td>
                  <td style={{ fontFamily: 'monospace' }}>{fmt(l.desde)}</td>
                  <td style={{ fontFamily: 'monospace' }}>{fmt(l.hasta)}</td>
                  <td style={{ textAlign: 'right' }}>{dias(l.desde, l.hasta)}</td>
                  <td className="muted">{l.detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {paginador}
    </Layout>
  );
}

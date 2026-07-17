// src/pages/ReporteAsistenciaServicioPage/LicenciasHistorialTab.tsx
// Tablero de licencias alimentado por la tabla `historial` (SIAPE 2016→hoy):
// cards, serie mensual con picos, estacionalidad, heatmap año×mes, día de la
// semana, rankings por tipo/dependencia/agrupamiento/régimen/planta (clickeables:
// filtran), top agentes y detalle paginado con export. Se excluye PRESENTE.
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import XLSXStyle from 'xlsx-js-style';
import { saveAs } from 'file-saver';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AggRow { valor: string; licencias: number; dias: number; agentes: number; }
interface AgenteTop { dni: number; apellido: string | null; nombre: string | null; licencias: number; dias: number; tipos: number; }

interface Analisis {
  cards: { licencias: number; dias: number; agentes: number; tipos: number };
  porAnio: { anio: number; licencias: number; dias: number; agentes: number }[];
  porMesSerie: { mes: string; licencias: number; dias: number; agentes: number }[];
  estacionalidad: { mes: number; licencias: number; dias: number; agentes: number }[];
  porDiaSemana: { dia: number; licencias: number; dias: number; agentes: number }[];
  porNovedad: AggRow[];
  porDependencia: AggRow[];
  porAgrupamiento: AggRow[];
  porRegimen: AggRow[];
  porPlanta: AggRow[];
  porJustificado: AggRow[];
  topAgentesDias: AgenteTop[];
  topAgentesLicencias: AgenteTop[];
  anios: number[];
}

interface DetalleRow {
  dni: number; apellido: string | null; nombre: string | null; novedad: string;
  fecha_desde: string | null; fecha_hasta: string | null; dias: number;
  justificado: string | null; dependencia: string | null; agrupamiento: string | null;
  regimen_estatutario: string | null; planta: string | null; estructura_servicio: string | null;
}

interface Filtros {
  anio: string; dependencia: string; novedad: string; agrupamiento: string;
  regimen: string; planta: string; justificado: string; q: string;
}

const FILTROS_VACIOS: Filtros = {
  anio: '', dependencia: '', novedad: '', agrupamiento: '',
  regimen: '', planta: '', justificado: '', q: '',
};

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const nf = (n: number | null | undefined) => Number(n || 0).toLocaleString('es-AR');
const fmtFechaCorta = (v: string | null) => {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return d ? `${d}/${m}/${y}` : s;
};
const nombreAgente = (a: { apellido: string | null; nombre: string | null; dni: number }) =>
  a.apellido ? `${a.apellido}, ${a.nombre ?? ''}` : String(a.dni);

// ─── Componentes visuales ─────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: color }} />
      <div style={{ paddingLeft: 8 }}>
        <div className="muted" style={{ fontSize: '0.64rem', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <div style={{ fontSize: '1.45rem', fontWeight: 800, lineHeight: 1.1, color }}>{value}</div>
        {sub && <div className="muted" style={{ fontSize: '0.68rem', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
    </div>
  );
}

function BarRow({ label, value, max, total, dias, active, onClick }: {
  label: string; value: number; max: number; total: number; dias?: number;
  active?: boolean; onClick?: () => void;
}) {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
        cursor: onClick ? 'pointer' : undefined,
        background: active ? 'rgba(99,102,241,0.12)' : undefined, borderRadius: 5, padding: '1px 4px',
      }}
      title={onClick ? `${label} — click para ${active ? 'quitar el filtro' : 'filtrar'}` : label}
    >
      <div style={{
        minWidth: 165, maxWidth: 165, fontSize: '0.72rem', textAlign: 'right',
        color: active ? '#a5b4fc' : 'rgba(255,255,255,0.72)', fontWeight: active ? 700 : 400,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label || '(sin dato)'}</div>
      <div style={{ flex: 1, height: 18, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: active ? '#818cf8' : '#6366f1', minWidth: 2, transition: 'width 0.5s' }} />
      </div>
      <div style={{ minWidth: 52, textAlign: 'right', fontSize: '0.76rem', fontWeight: 700 }}>{nf(value)}</div>
      <div className="muted" style={{ minWidth: 60, fontSize: '0.66rem', textAlign: 'right' }}>
        {dias !== undefined ? `${nf(dias)} días` : (total ? `${Math.round((value / total) * 100)}%` : '')}
      </div>
    </div>
  );
}

// Columnas verticales (serie temporal / estacionalidad). El pico se pinta rosa.
function ColumnChart({ data, height = 130, labelEvery = 1 }: {
  data: { label: string; value: number; sub?: string }[];
  height?: number; labelEvery?: number;
}) {
  const max = Math.max(1, ...data.map(d => d.value));
  const iMax = data.findIndex(d => d.value === max);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: data.length > 60 ? 1 : 3, height }}>
        {data.map((d, i) => (
          <div key={d.label} title={`${d.label}: ${nf(d.value)} licencias${d.sub ? ` · ${d.sub}` : ''}`}
            style={{
              flex: 1, minWidth: 2, borderRadius: '2px 2px 0 0',
              height: `${Math.max(2, (d.value / max) * 100)}%`,
              background: i === iMax ? '#f472b6' : '#6366f1',
              opacity: i === iMax ? 1 : 0.85,
            }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: data.length > 60 ? 1 : 3, marginTop: 4 }}>
        {data.map((d, i) => (
          <div key={d.label} style={{ flex: 1, minWidth: 2, textAlign: 'center', fontSize: '0.6rem', color: 'rgba(255,255,255,0.45)', overflow: 'visible', whiteSpace: 'nowrap' }}>
            {i % labelEvery === 0 ? d.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// Heatmap año × mes (intensidad = licencias iniciadas ese mes)
function Heatmap({ serie }: { serie: { mes: string; licencias: number; dias: number }[] }) {
  const mapa = new Map(serie.map(s => [s.mes, s]));
  const anios = [...new Set(serie.map(s => Number(s.mes.slice(0, 4))))].sort();
  const max = Math.max(1, ...serie.map(s => s.licencias));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: '0.68rem' }}>
        <thead>
          <tr>
            <th />
            {MESES.map(m => <th key={m} style={{ color: '#94a3b8', fontWeight: 600, padding: '0 2px' }}>{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {anios.map(a => (
            <tr key={a}>
              <td style={{ color: '#94a3b8', fontWeight: 700, paddingRight: 6 }}>{a}</td>
              {MESES.map((_, mi) => {
                const key = `${a}-${String(mi + 1).padStart(2, '0')}`;
                const cel = mapa.get(key);
                const v = cel?.licencias || 0;
                return (
                  <td key={key} title={`${MESES[mi]} ${a}: ${nf(v)} licencias · ${nf(cel?.dias || 0)} días`}
                    style={{
                      width: 34, height: 22, borderRadius: 4, textAlign: 'center',
                      background: v ? `rgba(99,102,241,${0.12 + 0.88 * (v / max)})` : 'rgba(255,255,255,0.04)',
                      color: v / max > 0.55 ? '#fff' : 'rgba(255,255,255,0.55)',
                      fontWeight: v === max ? 800 : 400,
                      outline: v === max ? '1px solid #f472b6' : undefined,
                    }}>
                    {v ? (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: '0.66rem', marginTop: 4 }}>El mes con más licencias del período está recuadrado en rosa.</div>
    </div>
  );
}

function Panel({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: '0.88rem' }}>{title}</strong>
        {hint && <span className="muted" style={{ fontSize: '0.66rem' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Pestaña ──────────────────────────────────────────────────────────────────

export function LicenciasHistorialTab() {
  const toast = useToast();
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [qInput, setQInput]   = useState('');
  const [an, setAn]           = useState<Analisis | null>(null);
  const [loading, setLoading] = useState(false);

  const [detalle, setDetalle]           = useState<DetalleRow[]>([]);
  const [detTotal, setDetTotal]         = useState(0);
  const [detPage, setDetPage]           = useState(1);
  const [rankAgentes, setRankAgentes]   = useState<'dias' | 'licencias'>('dias');
  const DET_LIMIT = 100;

  const setF = (k: keyof Filtros, v: string) => { setFiltros(p => ({ ...p, [k]: p[k] === v ? '' : v })); setDetPage(1); };
  const limpiar = () => { setFiltros(FILTROS_VACIOS); setQInput(''); setDetPage(1); };
  const hayFiltros = Object.values(filtros).some(Boolean);

  // Debounce del buscador de agente
  useEffect(() => {
    const t = setTimeout(() => { setFiltros(p => p.q === qInput ? p : { ...p, q: qInput }); setDetPage(1); }, 450);
    return () => clearTimeout(t);
  }, [qInput]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v);
    return p.toString();
  }, [filtros]);

  // Análisis
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    apiFetch<any>(`/asistencia/historial-analisis?${params}`)
      .then(r => { if (!vivo) return; if (!r?.ok) throw new Error(r?.error || 'Error del servidor'); setAn(r); })
      .catch(e => vivo && toast.error('Error', e?.message))
      .finally(() => vivo && setLoading(false));
    return () => { vivo = false; };
  }, [params]);

  // Detalle paginado
  useEffect(() => {
    let vivo = true;
    apiFetch<any>(`/asistencia/historial-detalle?${params}&page=${detPage}&limit=${DET_LIMIT}`)
      .then(r => { if (!vivo || !r?.ok) return; setDetalle(r.rows); setDetTotal(r.total); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [params, detPage]);

  // Derivados para cards
  const picoMes = useMemo(() => {
    if (!an?.porMesSerie.length) return null;
    return an.porMesSerie.reduce((m, s) => (s.licencias > m.licencias ? s : m));
  }, [an]);
  const picoAnio = useMemo(() => {
    if (!an?.porAnio.length) return null;
    return an.porAnio.reduce((m, s) => (s.licencias > m.licencias ? s : m));
  }, [an]);
  const topTipo = an?.porNovedad[0] ?? null;
  const topAgente = an?.topAgentesDias[0] ?? null;
  const promDias = an && an.cards.licencias ? (Number(an.cards.dias) / Number(an.cards.licencias)) : 0;

  const mesLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${y}`; };

  const exportar = async () => {
    try {
      const r = await apiFetch<any>(`/asistencia/historial-detalle?${params}&page=1&limit=5000`);
      if (!r?.ok) throw new Error(r?.error || 'Error del servidor');
      const FILL_HEADER = { patternType: 'solid', fgColor: { rgb: '2C3E50' } };
      const FONT_HEADER = { bold: true, color: { rgb: 'FFFFFF' } };
      const hd = (h: string) => ({ v: h, s: { fill: FILL_HEADER, font: FONT_HEADER } });

      const aoa: any[][] = [['Agente', 'DNI', 'Tipo de licencia', 'Desde', 'Hasta', 'Días', 'Justificado', 'Dependencia', 'Agrupamiento', 'Régimen', 'Planta', 'Servicio (estructura)'].map(hd)];
      for (const f of r.rows as DetalleRow[]) {
        aoa.push([
          nombreAgente(f), f.dni, f.novedad, fmtFechaCorta(f.fecha_desde), fmtFechaCorta(f.fecha_hasta), f.dias,
          f.justificado || '', f.dependencia || '', f.agrupamiento || '', f.regimen_estatutario || '', f.planta || '', f.estructura_servicio || '',
        ]);
      }
      const aoaTot: any[][] = [['Tipo de licencia', 'Licencias', 'Días', 'Agentes'].map(hd)];
      for (const t of an?.porNovedad ?? []) aoaTot.push([t.valor, t.licencias, t.dias, t.agentes]);
      const aoaAnio: any[][] = [['Año', 'Licencias', 'Días', 'Agentes'].map(hd)];
      for (const a of an?.porAnio ?? []) aoaAnio.push([a.anio, a.licencias, a.dias, a.agentes]);

      const wb = XLSXStyle.utils.book_new();
      XLSXStyle.utils.book_append_sheet(wb, XLSXStyle.utils.aoa_to_sheet(aoa), 'Detalle');
      XLSXStyle.utils.book_append_sheet(wb, XLSXStyle.utils.aoa_to_sheet(aoaTot), 'Por tipo');
      XLSXStyle.utils.book_append_sheet(wb, XLSXStyle.utils.aoa_to_sheet(aoaAnio), 'Por año');
      const out = XLSXStyle.write(wb, { type: 'array', bookType: 'xlsx' });
      saveAs(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `licencias-historial-${new Date().toISOString().slice(0, 10)}.xlsx`);
      if (r.total > 5000) toast.ok('Exportado', `Se exportaron las primeras 5000 de ${nf(r.total)} filas (afiná los filtros para menos).`);
    } catch (e: any) { toast.error('Error exportando', e?.message); }
  };

  const selFiltro = (k: keyof Filtros, label: string, opts: AggRow[]) => (
    <div>
      <label htmlFor={`hl-${k}`} style={lbl}>{label}</label>
      <select id={`hl-${k}`} className="input" value={filtros[k]}
        onChange={e => { setFiltros(p => ({ ...p, [k]: e.target.value })); setDetPage(1); }}>
        <option value="">Todos</option>
        {filtros[k] && !opts.some(o => o.valor === filtros[k]) && <option value={filtros[k]}>{filtros[k]}</option>}
        {opts.filter(o => o.valor !== '(sin dato)').map(o => (
          <option key={o.valor} value={o.valor}>{o.valor} ({nf(o.licencias)})</option>
        ))}
      </select>
    </div>
  );

  const rankingActual = rankAgentes === 'dias' ? (an?.topAgentesDias ?? []) : (an?.topAgentesLicencias ?? []);
  const detPags = Math.max(1, Math.ceil(detTotal / DET_LIMIT));

  return (
    <>
      {/* ── Filtros ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div className="h2" style={{ margin: 0 }}>Análisis histórico de licencias</div>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            Fuente: tabla historial (SIAPE) · se excluye PRESENTE · los rankings filtran con un click
          </span>
          {loading && <span style={{ color: '#818cf8', fontSize: '0.72rem' }}>cargando…</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div>
            <label htmlFor="hl-anio" style={lbl}>Año</label>
            <select id="hl-anio" className="input" value={filtros.anio}
              onChange={e => { setFiltros(p => ({ ...p, anio: e.target.value })); setDetPage(1); }}>
              <option value="">Todos</option>
              {(an?.anios ?? []).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {selFiltro('dependencia', 'Dependencia', an?.porDependencia ?? [])}
          {selFiltro('novedad', 'Tipo de licencia', an?.porNovedad ?? [])}
          {selFiltro('agrupamiento', 'Agrupamiento', an?.porAgrupamiento ?? [])}
          {selFiltro('regimen', 'Régimen / Ley', an?.porRegimen ?? [])}
          {selFiltro('planta', 'Planta', an?.porPlanta ?? [])}
          {selFiltro('justificado', 'Justificado', an?.porJustificado ?? [])}
          <div>
            <label htmlFor="hl-q" style={lbl}>Agente (DNI o apellido)</label>
            <input id="hl-q" className="input" placeholder="p.ej. 28123456 o GOMEZ" value={qInput} onChange={e => setQInput(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {hayFiltros && (
            <button className="btn" type="button" onClick={limpiar} style={{ fontSize: '0.74rem', padding: '3px 12px' }}>
              ✕ Limpiar filtros
            </button>
          )}
          <button className="btn" type="button" onClick={exportar} style={{ fontSize: '0.74rem', padding: '3px 12px', background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
            ⬇ Exportar Excel
          </button>
        </div>
      </div>

      {an && (
        <>
          {/* ── Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
            <StatCard label="Licencias" value={nf(an.cards.licencias)} color="#818cf8" sub={`${nf(an.cards.tipos)} tipos distintos`} />
            <StatCard label="Días totales" value={nf(an.cards.dias)} color="#34d399" sub={`${promDias ? promDias.toFixed(1) : '0'} días por licencia`} />
            <StatCard label="Agentes" value={nf(an.cards.agentes)} color="#fbbf24"
              sub={an.cards.agentes ? `${(Number(an.cards.licencias) / Number(an.cards.agentes)).toFixed(1)} licencias por agente` : undefined} />
            <StatCard label="Pico mensual" value={picoMes ? mesLabel(picoMes.mes) : '—'} color="#f472b6"
              sub={picoMes ? `${nf(picoMes.licencias)} licencias · ${nf(picoMes.dias)} días` : undefined} />
            <StatCard label="Año pico" value={picoAnio ? String(picoAnio.anio) : '—'} color="#a78bfa"
              sub={picoAnio ? `${nf(picoAnio.licencias)} licencias` : undefined} />
            <StatCard label="Tipo más usado" value={topTipo ? (topTipo.valor.length > 14 ? topTipo.valor.slice(0, 14) + '…' : topTipo.valor) : '—'} color="#38bdf8"
              sub={topTipo ? `${nf(topTipo.licencias)} licencias · ${nf(topTipo.dias)} días` : undefined} />
            <StatCard label="Agente con más días" value={topAgente ? (nombreAgente(topAgente).length > 15 ? nombreAgente(topAgente).slice(0, 15) + '…' : nombreAgente(topAgente)) : '—'} color="#fb7185"
              sub={topAgente ? `${nf(topAgente.dias)} días · ${nf(topAgente.licencias)} licencias` : undefined} />
          </div>

          {/* ── Serie mensual ── */}
          <Panel title="📈 Licencias por mes" hint="pico en rosa · pasá el mouse para ver valores">
            <ColumnChart
              data={an.porMesSerie.map(s => ({ label: s.mes.slice(0, 7), value: s.licencias, sub: `${nf(s.dias)} días · ${nf(s.agentes)} agentes` }))}
              labelEvery={Math.max(1, Math.ceil(an.porMesSerie.length / 16))}
              height={140}
            />
          </Panel>

          {/* ── Heatmap + estacionalidad ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            <Panel title="🔥 Mapa de calor año × mes" hint="¿cuándo se saca más?">
              <Heatmap serie={an.porMesSerie} />
            </Panel>
            <Panel title="🗓 Estacionalidad (todos los años sumados)" hint="mes del año en que más licencias arrancan">
              <ColumnChart
                data={MESES.map((m, i) => {
                  const e = an.estacionalidad.find(x => Number(x.mes) === i + 1);
                  return { label: m, value: e?.licencias || 0, sub: `${nf(e?.dias || 0)} días` };
                })}
                height={110}
              />
              <div style={{ marginTop: 14 }}>
                {DIAS_SEMANA.map((d, i) => {
                  const r = an.porDiaSemana.find(x => Number(x.dia) === i);
                  const max = Math.max(1, ...an.porDiaSemana.map(x => x.licencias));
                  const tot = an.porDiaSemana.reduce((acc, x) => acc + Number(x.licencias), 0);
                  return <BarRow key={d} label={d} value={r?.licencias || 0} max={max} total={tot} />;
                })}
                <div className="muted" style={{ fontSize: '0.66rem' }}>Día de la semana en que arrancan las licencias.</div>
              </div>
            </Panel>
          </div>

          {/* ── Por año + tipos ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            <Panel title="📅 Por año" hint="click = filtrar el tablero por ese año">
              {an.porAnio.map(a => (
                <BarRow key={a.anio} label={String(a.anio)} value={a.licencias}
                  max={Math.max(1, ...an.porAnio.map(x => x.licencias))}
                  total={an.porAnio.reduce((acc, x) => acc + Number(x.licencias), 0)}
                  dias={a.dias}
                  active={filtros.anio === String(a.anio)}
                  onClick={() => setF('anio', String(a.anio))} />
              ))}
            </Panel>
            <Panel title="🏷 Por tipo de licencia" hint="click = filtrar">
              <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                {an.porNovedad.map(t => (
                  <BarRow key={t.valor} label={t.valor} value={t.licencias}
                    max={Math.max(1, ...an.porNovedad.map(x => x.licencias))}
                    total={an.porNovedad.reduce((acc, x) => acc + Number(x.licencias), 0)}
                    dias={t.dias}
                    active={filtros.novedad === t.valor}
                    onClick={() => setF('novedad', t.valor)} />
                ))}
              </div>
            </Panel>
          </div>

          {/* ── Dependencia / agrupamiento / régimen / planta / justificado ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            <Panel title="🏥 Por dependencia" hint="click = filtrar">
              {an.porDependencia.map(d => (
                <BarRow key={d.valor} label={d.valor} value={d.licencias}
                  max={Math.max(1, ...an.porDependencia.map(x => x.licencias))}
                  total={an.porDependencia.reduce((acc, x) => acc + Number(x.licencias), 0)}
                  dias={d.dias}
                  active={filtros.dependencia === d.valor}
                  onClick={d.valor !== '(sin dato)' ? () => setF('dependencia', d.valor) : undefined} />
              ))}
              <div style={{ marginTop: 14 }}>
                <strong style={{ fontSize: '0.78rem' }}>Justificado</strong>
                {an.porJustificado.map(j => (
                  <BarRow key={j.valor} label={j.valor} value={j.licencias}
                    max={Math.max(1, ...an.porJustificado.map(x => x.licencias))}
                    total={an.porJustificado.reduce((acc, x) => acc + Number(x.licencias), 0)}
                    active={filtros.justificado === j.valor}
                    onClick={j.valor !== '(sin dato)' ? () => setF('justificado', j.valor) : undefined} />
                ))}
              </div>
            </Panel>
            <Panel title="👥 Por agrupamiento" hint="click = filtrar">
              {an.porAgrupamiento.map(d => (
                <BarRow key={d.valor} label={d.valor} value={d.licencias}
                  max={Math.max(1, ...an.porAgrupamiento.map(x => x.licencias))}
                  total={an.porAgrupamiento.reduce((acc, x) => acc + Number(x.licencias), 0)}
                  dias={d.dias}
                  active={filtros.agrupamiento === d.valor}
                  onClick={d.valor !== '(sin dato)' ? () => setF('agrupamiento', d.valor) : undefined} />
              ))}
            </Panel>
            <Panel title="⚖️ Por régimen / ley" hint="click = filtrar">
              {an.porRegimen.map(d => (
                <BarRow key={d.valor} label={d.valor} value={d.licencias}
                  max={Math.max(1, ...an.porRegimen.map(x => x.licencias))}
                  total={an.porRegimen.reduce((acc, x) => acc + Number(x.licencias), 0)}
                  dias={d.dias}
                  active={filtros.regimen === d.valor}
                  onClick={d.valor !== '(sin dato)' ? () => setF('regimen', d.valor) : undefined} />
              ))}
              <div style={{ marginTop: 14 }}>
                <strong style={{ fontSize: '0.78rem' }}>Planta</strong>
                {an.porPlanta.map(d => (
                  <BarRow key={d.valor} label={d.valor} value={d.licencias}
                    max={Math.max(1, ...an.porPlanta.map(x => x.licencias))}
                    total={an.porPlanta.reduce((acc, x) => acc + Number(x.licencias), 0)}
                    active={filtros.planta === d.valor}
                    onClick={d.valor !== '(sin dato)' ? () => setF('planta', d.valor) : undefined} />
                ))}
              </div>
            </Panel>
          </div>

          {/* ── Top agentes ── */}
          <Panel title="🏆 Top agentes" hint="click en un agente = ver su historial abajo">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['dias', 'licencias'] as const).map(k => (
                <button key={k} className="btn" type="button"
                  style={{ fontSize: '0.72rem', padding: '3px 10px', ...(rankAgentes === k ? { background: 'rgba(99,102,241,0.25)', color: '#818cf8', fontWeight: 700 } : {}) }}
                  onClick={() => setRankAgentes(k)}>
                  {k === 'dias' ? 'Por días' : 'Por cantidad'}
                </button>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.76rem' }}>
                <thead>
                  <tr><th>#</th><th>Agente</th><th>DNI</th><th>Licencias</th><th>Días</th><th>Tipos distintos</th></tr>
                </thead>
                <tbody>
                  {rankingActual.map((a, i) => (
                    <tr key={a.dni} style={{ cursor: 'pointer' }} title="Ver historial del agente"
                      onClick={() => { setQInput(String(a.dni)); setFiltros(p => ({ ...p, q: String(a.dni) })); setDetPage(1); }}>
                      <td style={{ color: '#94a3b8' }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{nombreAgente(a)}</td>
                      <td>{a.dni}</td>
                      <td>{nf(a.licencias)}</td>
                      <td style={{ fontWeight: 700, color: '#34d399' }}>{nf(a.dias)}</td>
                      <td>{a.tipos}</td>
                    </tr>
                  ))}
                  {!rankingActual.length && <tr><td colSpan={6} className="muted" style={{ padding: 12 }}>Sin datos.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── Detalle ── */}
          <Panel title="📋 Detalle de licencias" hint={`${nf(detTotal)} registros con los filtros actuales · más recientes primero`}>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.74rem' }}>
                <thead>
                  <tr>
                    <th>Agente</th><th>DNI</th><th>Tipo de licencia</th><th>Desde</th><th>Hasta</th><th>Días</th>
                    <th>Justif.</th><th>Dependencia</th><th>Agrupamiento</th><th>Régimen</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.map((f, i) => (
                    <tr key={`${f.dni}-${f.novedad}-${f.fecha_desde}-${i}`}>
                      <td style={{ fontWeight: 600, padding: '4px 8px' }}>{nombreAgente(f)}</td>
                      <td style={{ padding: '4px 8px' }}>{f.dni}</td>
                      <td style={{ padding: '4px 8px', maxWidth: 210 }}>
                        <span title={f.novedad} style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.novedad}</span>
                      </td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{fmtFechaCorta(f.fecha_desde)}</td>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{fmtFechaCorta(f.fecha_hasta)}</td>
                      <td style={{ padding: '4px 8px', fontWeight: 700 }}>{f.dias}</td>
                      <td style={{ padding: '4px 8px' }}>{f.justificado || '—'}</td>
                      <td style={{ padding: '4px 8px' }}>{f.dependencia || '—'}</td>
                      <td style={{ padding: '4px 8px' }}>{f.agrupamiento || '—'}</td>
                      <td style={{ padding: '4px 8px', maxWidth: 140 }}>
                        <span title={f.regimen_estatutario || undefined} style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.regimen_estatutario || '—'}</span>
                      </td>
                    </tr>
                  ))}
                  {!detalle.length && <tr><td colSpan={10} className="muted" style={{ padding: 12, textAlign: 'center' }}>Sin registros para los filtros seleccionados.</td></tr>}
                </tbody>
              </table>
            </div>
            {detPags > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
                <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 10px' }} disabled={detPage === 1} onClick={() => setDetPage(p => Math.max(1, p - 1))}>← Ant</button>
                <span className="muted" style={{ fontSize: '0.78rem' }}>Página {detPage} de {nf(detPags)}</span>
                <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 10px' }} disabled={detPage >= detPags} onClick={() => setDetPage(p => p + 1)}>Sig →</button>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

const lbl: React.CSSProperties = { fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: 4 };

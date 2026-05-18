// src/pages/ReportesPage/index.tsx
import React, { useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf, printTable } from '../../utils/export';

type TabKey = 'cumpleanos' | 'antiguedad' | 'estadisticas_consultas' | 'whatsapp' | 'consultas_dinamicas';

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];
const DIAS = Array.from({ length: 31 }, (_, i) => i + 1);
const YEAR_NOW = new Date().getFullYear();
const YEARS_ANTIG = Array.from({ length: 15 }, (_, i) => YEAR_NOW - i);
const YEARS_RANGE = Array.from({ length: 5 }, (_, i) => YEAR_NOW - i);

const fmtLocalDate = (v: any): string => {
  if (!v) return '—';
  const s = String(v).split('T')[0];
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  return `${Number(parts[2])}/${Number(parts[1])}/${parts[0]}`;
};

function hoyStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2,'0')}-01`;
}

async function fetchAllPages(path: string, extraParams: string = ''): Promise<any[]> {
  const SEP = path.includes('?') ? '&' : '?';
  const PAGE = 200;
  let page = 1; let all: any[] = []; let total = Infinity;
  while (all.length < total) {
    const res = await apiFetch<any>(`${path}${SEP}limit=${PAGE}&page=${page}${extraParams ? '&' + extraParams : ''}`);
    const rows: any[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total !== undefined) total = Number(res.meta.total);
    else total = all.length;
    if (rows.length < PAGE) break;
    page++;
  }
  return all;
}

async function buildDniNameMap(): Promise<Record<string, { apellido: string; nombre: string }>> {
  const rows = await fetchAllPages('/personal', 'fields=dni,apellido,nombre');
  const map: Record<string, { apellido: string; nombre: string }> = {};
  for (const r of rows) {
    if (r.dni) map[String(r.dni)] = { apellido: r.apellido ?? '', nombre: r.nombre ?? '' };
  }
  return map;
}

const CAMPO_FECHA = 'hora_atencion';

function buildParamsFecha(desde: string, hasta: string): string {
  return `${CAMPO_FECHA}_gte=${desde} 00:00:00&${CAMPO_FECHA}_lte=${hasta} 23:59:59&sort=${CAMPO_FECHA}`;
}

async function fetchConsultasConNombres(params: string): Promise<any[]> {
  try {
    const data = await fetchAllPages('/consultaspordni', params);
    return data;
  } catch {
    const [rows, nameMap] = await Promise.all([
      fetchAllPages('/consultas', params),
      buildDniNameMap(),
    ]);
    return rows.map(r => ({
      ...r,
      apellido: nameMap[String(r.dni)]?.apellido ?? '',
      nombre:   nameMap[String(r.dni)]?.nombre  ?? '',
    }));
  }
}

const SELECT_DARK: React.CSSProperties = {
  background: '#1e293b', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 10px',
};

function ExportButtons({ rows, filename, title }: { rows: any[]; filename: string; title: string }) {
  if (!rows.length) return null;
  return (
    <>
      <button className="btn" onClick={() => printTable(title, rows)}>🖨 Imprimir</button>
      <button className="btn" style={{ background: '#16a34a', color: '#fff' }}
        onClick={() => exportToExcel(filename, rows)}>📊 Excel</button>
      <button className="btn" style={{ background: '#dc2626', color: '#fff' }}
        onClick={() => exportToPdf(filename, rows)}>📕 PDF</button>
    </>
  );
}

// ─── Cumpleaños ───────────────────────────────────────────────────────────────
function CumpleanosTab() {
  const toast = useToast();
  const [mode, setMode] = useState<'dia' | 'mes'>('dia');
  const [dia, setDia] = useState('');
  const [mes, setMes] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const buscar = useCallback(async () => {
    setLoading(true); setRows([]);
    try {
      if (!mes) { toast.error('Seleccioná un mes'); return; }
      if (mode === 'dia' && !dia) { toast.error('Seleccioná un día'); return; }
      const params = mode === 'dia' ? `mes=${mes}&dia=${dia}` : `mes=${mes}`;
      const res = await apiFetch<any>(`/personal/cumpleanos?${params}`);
      const data: any[] = res?.data || [];
      setRows(data);
      if (!data.length) toast.error('Sin resultados');
      else toast.ok(`${data.length} resultado(s)`);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, [mode, dia, mes, toast]);

  const cols = ['dni','apellido','nombre','fecha_nacimiento','email','telefono'];
  const labelRes = mode === 'dia' && dia && mes
    ? ` el ${dia} de ${MESES[Number(mes)-1]}`
    : mode === 'mes' && mes ? ` en ${MESES[Number(mes)-1]}` : '';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ marginBottom: 8 }}><strong>🎂 Cumpleaños</strong></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Modo</div>
            <select style={{ ...SELECT_DARK, minWidth: 150 }} value={mode}
              onChange={e => { setMode(e.target.value as any); setDia(''); setRows([]); }}>
              <option value="dia">Día exacto</option>
              <option value="mes">Mes completo</option>
            </select>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Mes</div>
            <select style={{ ...SELECT_DARK, minWidth: 160 }} value={mes} onChange={e => setMes(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {MESES.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
            </select>
          </div>
          {mode === 'dia' && (
            <div>
              <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Día</div>
              <select style={{ ...SELECT_DARK, minWidth: 80 }} value={dia} onChange={e => setDia(e.target.value)}>
                <option value="">—</option>
                {DIAS.map(d => <option key={d} value={String(d)}>{d}</option>)}
              </select>
            </div>
          )}
          <button className="btn" style={{ background: '#2563eb', color: '#fff', height: 36 }}
            disabled={loading} onClick={buscar}>
            {loading ? '⏳ Buscando…' : '🔍 Buscar'}
          </button>
          <ExportButtons rows={rows} filename="cumpleanos.xlsx" title={`Cumpleaños${labelRes}`} />
        </div>
      </div>
      {rows.length > 0 && (
        <div className="card">
          <div style={{ marginBottom: 8 }}><strong>{rows.length}</strong> agente(s) cumplen años{labelRes}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse' }}>
              <thead><tr>{cols.map(c => (
                <th key={c} style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8',
                  fontSize: '0.72rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  {c.toUpperCase()}
                </th>
              ))}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    {cols.map(c => (
                      <td key={c} style={{ padding: '5px 10px', fontSize: '0.82rem' }}>
                        {c === 'fecha_nacimiento' ? fmtLocalDate(r[c]) : String(r[c] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Antigüedad ───────────────────────────────────────────────────────────────
function AntigüedadTab() {
  const toast = useToast();
  const [mesSelec, setMesSelec] = useState(String(new Date().getMonth() + 1));
  const [anioSelec, setAnioSelec] = useState(String(YEAR_NOW));
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const anioIngreso = Number(anioSelec) - 20;
  const mesNum = Number(mesSelec);

  const buscar = useCallback(async () => {
    setLoading(true); setRows([]);
    try {
      const fechaDesde = `${anioIngreso}-${String(mesNum).padStart(2,'0')}-01`;
      const fechaHasta = lastDayOfMonth(anioIngreso, mesNum);

      const agentes = await fetchAllPages(
        '/agentes',
        `fecha_ingreso_gte=${fechaDesde}&fecha_ingreso_lte=${fechaHasta}&estado_empleo=ACTIVO&sort=dni`
      );

      if (!agentes.length) { toast.error('Sin resultados'); setLoading(false); return; }

      const personal = await fetchAllPages('/personal', 'fields=dni,apellido,nombre,email,telefono');
      const nameMap: Record<string, any> = {};
      for (const p of personal) {
        if (p.dni) nameMap[String(p.dni)] = p;
      }

      const data = agentes.map((a: any) => ({
        dni:           a.dni,
        apellido:      nameMap[String(a.dni)]?.apellido  ?? '—',
        nombre:        nameMap[String(a.dni)]?.nombre    ?? '—',
        fecha_ingreso: a.fecha_ingreso,
        email:         nameMap[String(a.dni)]?.email     ?? '—',
        telefono:      nameMap[String(a.dni)]?.telefono  ?? '—',
      })).sort((a: any, b: any) => (a.apellido > b.apellido ? 1 : -1));

      setRows(data);
      toast.ok(`${data.length} agente(s)`);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, [mesSelec, anioSelec, anioIngreso, mesNum, toast]);

  const cols = ['dni','apellido','nombre','fecha_ingreso','email','telefono'];
  const labelRes = `${MESES[mesNum-1]} ${anioSelec}`;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ marginBottom: 8 }}><strong>🏅 Antigüedad — agentes que cumplen 20 años</strong></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Mes</div>
            <select style={{ ...SELECT_DARK, minWidth: 150 }} value={mesSelec}
              onChange={e => setMesSelec(e.target.value)}>
              {MESES.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
            </select>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Año (en que se cumplen los 20)</div>
            <select style={{ ...SELECT_DARK, minWidth: 130 }} value={anioSelec}
              onChange={e => setAnioSelec(e.target.value)}>
              {YEARS_ANTIG.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              → Fecha de ingreso: <strong style={{ color: '#e2e8f0' }}>
                {MESES[mesNum-1]} {anioIngreso}
              </strong>
            </span>
          </div>
          <button className="btn" style={{ background: '#7c3aed', color: '#fff', height: 36 }}
            disabled={loading} onClick={buscar}>
            {loading ? '⏳ Buscando…' : '🔍 Buscar'}
          </button>
          <ExportButtons
            rows={rows}
            filename={`antiguedad_20_${mesSelec}_${anioSelec}.xlsx`}
            title={`Antigüedad 20 años — ${labelRes}`}
          />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div style={{ marginBottom: 8 }}>
            <strong>{rows.length}</strong> agente(s) cumplen 20 años en {labelRes}
            <span className="muted" style={{ fontSize: '0.78rem', marginLeft: 8 }}>
              (ingresaron en {MESES[mesNum-1]} {anioIngreso})
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse' }}>
              <thead><tr>{cols.map(c => (
                <th key={c} style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8',
                  fontSize: '0.72rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  {c.toUpperCase()}
                </th>
              ))}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    {cols.map(c => (
                      <td key={c} style={{ padding: '5px 10px', fontSize: '0.82rem' }}>
                        {c === 'fecha_ingreso' ? fmtLocalDate(r[c]) : String(r[c] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Estadísticas Consultas ───────────────────────────────────────────────────
function EstadisticasConsultasTab() {
  const toast = useToast();

  const mesAtras = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();

  const [desde, setDesde] = useState(mesAtras);
  const [hasta, setHasta] = useState(hoyStr());
  const [mesRapido, setMesRapido] = useState('');
  const [anioRapido, setAnioRapido] = useState(String(YEAR_NOW));
  const [loading, setLoading] = useState(false);
  const [totalHoy, setTotalHoy] = useState<number | null>(null);
  const [ultimaFecha, setUltimaFecha] = useState<string | null>(null);
  const [porDia, setPorDia] = useState<any[]>([]);
  const [porMes, setPorMes] = useState<any[]>([]);
  const [porAgente, setPorAgente] = useState<any[]>([]);
  const [porAtendido, setPorAtendido] = useState<any[]>([]);
  const [detalle, setDetalle] = useState<any[]>([]);
  const [vistaDetalle, setVistaDetalle] = useState(false);
  const [comparativo, setComparativo] = useState<any[]>([]);
  const [comparativoMes, setComparativoMes] = useState<any[]>([]);

  React.useEffect(() => {
    (async () => {
      try {
        const h = hoyStr();
        const [resHoy, resUltima] = await Promise.all([
          apiFetch<any>(`/consultas?limit=1&page=1&${buildParamsFecha(h, h).replace(/&sort=[^&]*/,'')}`),
          apiFetch<any>(`/consultas?limit=1&page=1&sort=-hora_atencion&hora_atencion_gt=2020-01-01`),
        ]);
        setTotalHoy(resHoy?.meta?.total ?? 0);
        const ultima = resUltima?.data?.[0]?.hora_atencion;
        if (ultima) setUltimaFecha(String(ultima).split('T')[0].split(' ')[0]);
      } catch { /* silencioso */ }
    })();
  }, []);

  // Selección rápida por mes/año → llena desde/hasta
  const aplicarMesRapido = useCallback(() => {
    if (!mesRapido) return;
    const m = Number(mesRapido);
    const y = Number(anioRapido);
    setDesde(firstDayOfMonth(y, m));
    setHasta(lastDayOfMonth(y, m));
  }, [mesRapido, anioRapido]);

  const buscar = useCallback(async () => {
    if (!desde || !hasta) { toast.error('Seleccioná rango de fechas'); return; }
    setLoading(true);
    setPorDia([]); setPorMes([]); setPorAgente([]); setPorAtendido([]); setDetalle([]);
    setComparativo([]); setComparativoMes([]);
    try {
      const [all, waRes] = await Promise.all([
        fetchConsultasConNombres(buildParamsFecha(desde, hasta)),
        apiFetch<any>(`/whatsapp?desde=${desde}&hasta=${hasta}`).catch(() => null),
      ]);

      if (!all.length) { toast.error('Sin resultados en ese rango'); return; }

      // ── Por día ──
      const byDia: Record<string, number> = {};
      for (const c of all) {
        const raw = String(c[CAMPO_FECHA] || c.hora_atencion || c.created_at || '');
        const fecha = raw.split('T')[0].split(' ')[0];
        if (fecha && fecha !== '1111-11-11') byDia[fecha] = (byDia[fecha] ?? 0) + 1;
      }
      setPorDia(
        Object.entries(byDia)
          .map(([fecha, total]) => ({ FECHA: fmtLocalDate(fecha), TOTAL: total, _sort: fecha }))
          .sort((a, b) => a._sort.localeCompare(b._sort))
      );

      // ── Por mes ──
      const byMes: Record<string, number> = {};
      for (const c of all) {
        const raw = String(c[CAMPO_FECHA] || c.hora_atencion || c.created_at || '').split('T')[0].split(' ')[0];
        if (!raw || raw === '1111-11-11') continue;
        const parts = raw.split('-');
        const mes = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : raw;
        byMes[mes] = (byMes[mes] ?? 0) + 1;
      }
      setPorMes(
        Object.entries(byMes)
          .map(([m, total]) => {
            const [y, mm] = m.split('-');
            return { MES: mm ? `${MESES[Number(mm)-1]} ${y}` : m, TOTAL: total, _sort: m };
          })
          .sort((a, b) => a._sort.localeCompare(b._sort))
      );

      // ── Por agente ──
      const byAgente: Record<string, any> = {};
      for (const c of all) {
        const key = String(c.dni ?? '');
        if (!byAgente[key]) {
          byAgente[key] = { DNI: c.dni, APELLIDO: c.apellido ?? '—', NOMBRE: c.nombre ?? '—', TOTAL: 0 };
        }
        byAgente[key].TOTAL++;
      }
      setPorAgente(Object.values(byAgente).sort((a: any, b: any) => b.TOTAL - a.TOTAL));

      // ── Por quien atendió ──
      const byAtendido: Record<string, number> = {};
      for (const c of all) {
        const at = ((c.atendido_por ?? '') as string).trim() || '(sin registrar)';
        byAtendido[at] = (byAtendido[at] ?? 0) + 1;
      }
      setPorAtendido(
        Object.entries(byAtendido)
          .map(([ATENDIDO_POR, TOTAL]) => ({ ATENDIDO_POR, TOTAL }))
          .sort((a: any, b: any) => b.TOTAL - a.TOTAL)
      );

      setDetalle(all);

      // ── Comparativo ventanilla vs WhatsApp ──
      const waRows: any[] = waRes?.data || [];
      const waByDia: Record<string, number> = {};
      const waByMes: Record<string, number> = {};
      for (const w of waRows) {
        const f = String(w.fecha).split('T')[0];
        waByDia[f] = Number(w.cantidad);
        const parts = f.split('-');
        const mesKey = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : f;
        waByMes[mesKey] = (waByMes[mesKey] ?? 0) + Number(w.cantidad);
      }

      // Comparativo por día
      const allFechas = new Set([...Object.keys(byDia), ...Object.keys(waByDia)]);
      const comp = Array.from(allFechas).sort().map(fecha => ({
        FECHA:      fmtLocalDate(fecha),
        VENTANILLA: byDia[fecha] ?? 0,
        WHATSAPP:   waByDia[fecha] ?? 0,
        TOTAL:      (byDia[fecha] ?? 0) + (waByDia[fecha] ?? 0),
        _sort:      fecha,
      }));
      setComparativo(comp);

      // Comparativo por mes
      const allMeses = new Set([...Object.keys(byMes), ...Object.keys(waByMes)]);
      const compMes = Array.from(allMeses).sort().map(m => {
        const [y, mm] = m.split('-');
        return {
          MES:        mm ? `${MESES[Number(mm)-1]} ${y}` : m,
          VENTANILLA: byMes[m] ?? 0,
          WHATSAPP:   waByMes[m] ?? 0,
          TOTAL:      (byMes[m] ?? 0) + (waByMes[m] ?? 0),
          _sort:      m,
        };
      });
      setComparativoMes(compMes);

      toast.ok(`${all.length} consulta(s) procesadas`);
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error al consultar');
    } finally { setLoading(false); }
  }, [desde, hasta, toast]);

  const labelRango = desde === hasta ? fmtLocalDate(desde) : `${fmtLocalDate(desde)} – ${fmtLocalDate(hasta)}`;

  function TablaStat({ titulo, filas, cols }: { titulo: string; filas: any[]; cols: string[] }) {
    if (!filas.length) return null;
    return (
      <div className="card">
        <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.88rem' }}>
          {titulo}
          <span style={{ marginLeft: 8, fontSize: '0.76rem', color: '#94a3b8', fontWeight: 400 }}>
            ({filas.length})
          </span>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
              <tr>{cols.map(h => (
                <th key={h} style={{ padding: '5px 8px',
                  textAlign: h === 'TOTAL' || h === 'CANT' ? 'right' : 'left',
                  color: '#94a3b8', fontSize: '0.72rem',
                  borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filas.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  {cols.map(h => {
                    const val = r[h] ?? '—';
                    const isNum = h === 'TOTAL' || h === 'CANT';
                    return (
                      <td key={h} style={{ padding: '4px 8px',
                        textAlign: isNum ? 'right' : 'left',
                        fontWeight: isNum ? 700 : 400,
                        color: isNum ? '#38bdf8' : undefined,
                        maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={String(val)}>
                        {String(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>

      {/* Contador hoy */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ fontSize: '2.5rem', lineHeight: 1 }}>📋</div>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 2 }}>
            CONSULTAS DE VENTANILLA HOY ({fmtLocalDate(hoyStr())})
          </div>
          <div style={{ fontSize: '2.2rem', fontWeight: 700, color: '#38bdf8' }}>
            {totalHoy === null ? '…' : totalHoy}
          </div>
          {totalHoy === 0 && ultimaFecha && (
            <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: 2 }}>
              ⚠️ Sin consultas hoy — última registrada el {fmtLocalDate(ultimaFecha)}
            </div>
          )}
        </div>
      </div>

      {/* Filtro */}
      <div className="card">
        <div style={{ marginBottom: 10 }}><strong>📊 Estadísticas por rango de fechas</strong></div>

        {/* Selector rápido por mes */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12,
          paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Mes rápido</div>
            <select style={{ ...SELECT_DARK, minWidth: 150 }} value={mesRapido}
              onChange={e => setMesRapido(e.target.value)}>
              <option value="">— Elegir mes —</option>
              {MESES.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
            </select>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Año</div>
            <select style={{ ...SELECT_DARK, minWidth: 100 }} value={anioRapido}
              onChange={e => setAnioRapido(e.target.value)}>
              {YEARS_RANGE.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <button className="btn" style={{ height: 36 }} onClick={aplicarMesRapido} disabled={!mesRapido}>
            Aplicar mes
          </button>
        </div>

        {/* Rango manual */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Desde</div>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={{ ...SELECT_DARK }} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Hasta</div>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={{ ...SELECT_DARK }} />
          </div>
          <button className="btn" style={{ background: '#2563eb', color: '#fff', height: 36 }}
            disabled={loading} onClick={buscar}>
            {loading ? '⏳ Cargando…' : '🔍 Generar'}
          </button>
          {detalle.length > 0 && (
            <>
              <button className="btn"
                onClick={() => printTable(`Consultas por agente ${labelRango}`, porAgente)}>
                🖨 Imprimir agentes
              </button>
              <button className="btn" style={{ background: '#16a34a', color: '#fff' }}
                onClick={() => exportToExcel(`consultas_agentes_${desde}_${hasta}.xlsx`, porAgente)}>
                📊 Excel agentes
              </button>
              <button className="btn" style={{ background: '#dc2626', color: '#fff' }}
                onClick={() => exportToPdf(`consultas_agentes_${desde}_${hasta}`, porAgente)}>
                📕 PDF
              </button>
            </>
          )}
        </div>
        {detalle.length > 0 && (
          <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#94a3b8' }}>
            Total: <strong style={{ color: '#e2e8f0' }}>{detalle.length}</strong> consultas — {labelRango}
          </div>
        )}
      </div>

      {/* Por día y por mes */}
      {(porDia.length > 0 || porMes.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 12 }}>
          <TablaStat titulo="📅 Por día" filas={porDia} cols={['FECHA','TOTAL']} />
          <TablaStat titulo="🗓 Por mes" filas={porMes} cols={['MES','TOTAL']} />
        </div>
      )}

      {/* Comparativo ventanilla vs WhatsApp */}
      {comparativo.length > 0 && (
        <>
          <div style={{ marginTop: 4, fontWeight: 700, fontSize: '0.88rem', color: '#94a3b8' }}>
            📊 Comparativo Ventanilla vs WhatsApp
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 12 }}>

            {/* Por día */}
            <div className="card">
              <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.88rem' }}>
                📅 Por día
                <span style={{ marginLeft: 8, fontSize: '0.76rem', color: '#94a3b8', fontWeight: 400 }}>
                  ({comparativo.length} días)
                </span>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                    <tr>
                      {['FECHA','VENTANILLA','WHATSAPP','TOTAL'].map(h => (
                        <th key={h} style={{ padding: '5px 8px',
                          textAlign: h === 'FECHA' ? 'left' : 'right',
                          color: h === 'VENTANILLA' ? '#38bdf8' : h === 'WHATSAPP' ? '#4ade80' : h === 'TOTAL' ? '#e2e8f0' : '#94a3b8',
                          fontSize: '0.72rem', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparativo.map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{r.FECHA}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: '#38bdf8', fontWeight: 600 }}>{r.VENTANILLA}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: '#4ade80', fontWeight: 600 }}>{r.WHATSAPP}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700 }}>{r.TOTAL}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid rgba(255,255,255,0.15)', fontWeight: 700 }}>
                      <td style={{ padding: '5px 8px', color: '#94a3b8' }}>TOTAL</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: '#38bdf8' }}>
                        {comparativo.reduce((s, r) => s + r.VENTANILLA, 0)}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: '#4ade80' }}>
                        {comparativo.reduce((s, r) => s + r.WHATSAPP, 0)}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                        {comparativo.reduce((s, r) => s + r.TOTAL, 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Por mes */}
            <div className="card">
              <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.88rem' }}>
                🗓 Por mes
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['MES','VENTANILLA','WHATSAPP','TOTAL'].map(h => (
                        <th key={h} style={{ padding: '5px 8px',
                          textAlign: h === 'MES' ? 'left' : 'right',
                          color: h === 'VENTANILLA' ? '#38bdf8' : h === 'WHATSAPP' ? '#4ade80' : h === 'TOTAL' ? '#e2e8f0' : '#94a3b8',
                          fontSize: '0.72rem', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparativoMes.map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '4px 8px' }}>{r.MES}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: '#38bdf8', fontWeight: 600 }}>{r.VENTANILLA}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: '#4ade80', fontWeight: 600 }}>{r.WHATSAPP}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700 }}>{r.TOTAL}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid rgba(255,255,255,0.15)', fontWeight: 700 }}>
                      <td style={{ padding: '5px 8px', color: '#94a3b8' }}>TOTAL</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: '#38bdf8' }}>
                        {comparativoMes.reduce((s, r) => s + r.VENTANILLA, 0)}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: '#4ade80' }}>
                        {comparativoMes.reduce((s, r) => s + r.WHATSAPP, 0)}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                        {comparativoMes.reduce((s, r) => s + r.TOTAL, 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {comparativo.filter(r => r.WHATSAPP === 0).length > 0 && (
                <div style={{ marginTop: 8, fontSize: '0.73rem', color: '#f59e0b' }}>
                  ⚠️ Algunos días no tienen datos de WhatsApp cargados
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Por agente y por quien atendió */}
      {porAgente.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 12 }}>
          <div className="card">
            <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.88rem' }}>
              👤 Por agente
              <span style={{ marginLeft: 8, fontSize: '0.76rem', color: '#94a3b8', fontWeight: 400 }}>
                ({porAgente.length} agentes · {detalle.length} consultas)
              </span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                  <tr>{['DNI','APELLIDO','NOMBRE','TOTAL'].map(h => (
                    <th key={h} style={{ padding: '5px 8px', textAlign: h==='TOTAL'?'right':'left',
                      color: '#94a3b8', fontSize: '0.72rem',
                      borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {porAgente.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{r.DNI}</td>
                      <td style={{ padding: '4px 8px' }}>{r.APELLIDO}</td>
                      <td style={{ padding: '4px 8px' }}>{r.NOMBRE}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                        {r.TOTAL}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.88rem' }}>
              🧑‍💼 Por quien atendió
              <span style={{ marginLeft: 8, fontSize: '0.76rem', color: '#94a3b8', fontWeight: 400 }}>
                ({porAtendido.length})
              </span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                  <tr>{['ATENDIDO_POR','TOTAL'].map(h => (
                    <th key={h} style={{ padding: '5px 8px', textAlign: h==='TOTAL'?'right':'left',
                      color: '#94a3b8', fontSize: '0.72rem',
                      borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {porAtendido.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '4px 8px', maxWidth: 240, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={r.ATENDIDO_POR}>{r.ATENDIDO_POR}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: '#a78bfa' }}>
                        {r.TOTAL}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Detalle completo */}
      {detalle.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: '0.88rem' }}>📄 Detalle ({detalle.length})</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ fontSize: '0.78rem' }}
                onClick={() => exportToExcel(`detalle_consultas_${desde}_${hasta}.xlsx`, detalle.map(r => ({
                  fecha: fmtLocalDate(r.hora_atencion),
                  dni: r.dni, apellido: r.apellido, nombre: r.nombre,
                  motivo: r.motivo_consulta, atendido_por: r.atendido_por,
                })))}>
                📊 Excel completo
              </button>
              <button className="btn" style={{ fontSize: '0.78rem' }}
                onClick={() => setVistaDetalle(v => !v)}>
                {vistaDetalle ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>
          {vistaDetalle && (
            <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                  <tr>{['FECHA','DNI','APELLIDO','NOMBRE','MOTIVO','ATENDIDO POR'].map(h => (
                    <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: '#94a3b8',
                      fontSize: '0.7rem', borderBottom: '1px solid rgba(255,255,255,0.1)',
                      whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {detalle.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '3px 8px', whiteSpace: 'nowrap', color: '#94a3b8' }}>
                        {fmtLocalDate(r[CAMPO_FECHA] || r.hora_atencion || r.created_at)}
                      </td>
                      <td style={{ padding: '3px 8px', color: '#94a3b8' }}>{r.dni}</td>
                      <td style={{ padding: '3px 8px' }}>{r.apellido ?? '—'}</td>
                      <td style={{ padding: '3px 8px' }}>{r.nombre ?? '—'}</td>
                      <td style={{ padding: '3px 8px', maxWidth: 220, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={r.motivo_consulta}>{r.motivo_consulta ?? '—'}</td>
                      <td style={{ padding: '3px 8px' }}>{r.atendido_por ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WhatsApp Tab ─────────────────────────────────────────────────────────────
function WhatsappTab() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Formulario nuevo registro
  const [newFecha, setNewFecha] = useState(hoyStr());
  const [newCantidad, setNewCantidad] = useState('');

  // Formulario edición inline
  const [editCantidad, setEditCantidad] = useState('');
  const [editFecha, setEditFecha] = useState('');

  // Filtro para listar: mes o año completo
  const [verAnio, setVerAnio] = useState(false);
  const [filtroMes, setFiltroMes] = useState(String(new Date().getMonth() + 1));
  const [filtroAnio, setFiltroAnio] = useState(String(YEAR_NOW));

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = verAnio
        ? `year=${filtroAnio}`
        : `year=${filtroAnio}&month=${filtroMes}`;
      const res = await apiFetch<any>(`/whatsapp?${params}`);
      setRows(res?.data || []);
    } catch (e: any) {
      toast.error('Error al cargar', e?.message);
    } finally { setLoading(false); }
  }, [filtroMes, filtroAnio, verAnio, toast]);

  React.useEffect(() => { cargar(); }, [cargar]);

  // Bloquea solo si ya existe con cantidad > 0 (cantidad 0 = pre-cargada sin datos reales)
  const fechaYaExiste = rows.some(r => String(r.fecha).split('T')[0] === newFecha && Number(r.cantidad) > 0);

  const guardar = async () => {
    if (!newFecha || newCantidad === '') { toast.error('Completá fecha y cantidad'); return; }
    if (fechaYaExiste) return; // bloqueado, el aviso ya está visible
    setSaving(true);
    try {
      await apiFetch('/whatsapp', {
        method: 'POST',
        body: JSON.stringify({ fecha: newFecha, cantidad: Number(newCantidad) }),
      });
      toast.ok('Guardado');
      setNewCantidad('');
      await cargar();
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally { setSaving(false); }
  };

  const actualizarFila = async (id: number) => {
    if (editCantidad === '') { toast.error('Ingresá la cantidad'); return; }
    setSaving(true);
    try {
      await apiFetch(`/whatsapp/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ fecha: editFecha, cantidad: Number(editCantidad) }),
      });
      toast.ok('Actualizado');
      setEditingId(null);
      await cargar();
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally { setSaving(false); }
  };

  const eliminar = async (id: number, fecha: string) => {
    if (!confirm(`¿Eliminar registro del ${fmtLocalDate(fecha)}?`)) return;
    try {
      await apiFetch(`/whatsapp/${id}`, { method: 'DELETE' });
      toast.ok('Eliminado');
      await cargar();
    } catch (e: any) {
      toast.error('Error', e?.message);
    }
  };

  // Excluye sábados (6) y domingos (0) — fecha en formato YYYY-MM-DD, sin conversión UTC
  const esFinde = (fecha: string) => {
    const [y, m, d] = String(fecha).split('T')[0].split('-').map(Number);
    const dia = new Date(y, m - 1, d).getDay();
    return dia === 0 || dia === 6;
  };
  const rowsHabil = rows.filter(r => !esFinde(r.fecha));

  // Totales: por mes (para vista año) y total general
  const totalGeneral = rowsHabil.reduce((s, r) => s + Number(r.cantidad), 0);

  // Agrupa por mes para la vista anual
  const porMesAnio: { mes: string; label: string; filas: any[]; total: number }[] = React.useMemo(() => {
    if (!verAnio) return [];
    const grupos: Record<string, any[]> = {};
    for (const r of rowsHabil) {
      const key = String(r.fecha).substring(0, 7); // YYYY-MM
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(r);
    }
    return Object.entries(grupos).sort(([a], [b]) => a.localeCompare(b)).map(([mes, filas]) => {
      const [y, mm] = mes.split('-');
      return { mes, label: `${MESES[Number(mm)-1]} ${y}`, filas, total: filas.reduce((s, r) => s + Number(r.cantidad), 0) };
    });
  }, [rowsHabil, verAnio]);

  const exportRows = rowsHabil.map(r => ({ fecha: fmtLocalDate(r.fecha), cantidad: r.cantidad }));
  const exportFilename = verAnio
    ? `whatsapp_${filtroAnio}.xlsx`
    : `whatsapp_${filtroAnio}_${filtroMes.padStart(2,'0')}.xlsx`;
  const exportTitle = verAnio
    ? `Consultas WhatsApp — ${filtroAnio}`
    : `Consultas WhatsApp — ${MESES[Number(filtroMes)-1]} ${filtroAnio}`;

  function FilaTabla({ r }: { r: any }) {
    return (
      <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <td style={{ padding: '5px 10px', color: '#64748b', fontSize: '0.76rem' }}>{r.id}</td>
        <td style={{ padding: '5px 10px' }}>
          {editingId === r.id
            ? <input type="date" value={editFecha} onChange={e => setEditFecha(e.target.value)}
                style={{ ...SELECT_DARK, padding: '2px 6px' }} />
            : fmtLocalDate(r.fecha)
          }
        </td>
        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
          {editingId === r.id
            ? <input type="number" min={0} value={editCantidad}
                onChange={e => setEditCantidad(e.target.value)}
                style={{ ...SELECT_DARK, width: 80, padding: '2px 6px', textAlign: 'right' }}
                onKeyDown={e => e.key === 'Enter' && actualizarFila(r.id)} />
            : <strong style={{ color: '#4ade80' }}>{r.cantidad}</strong>
          }
        </td>
        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {editingId === r.id ? (
              <>
                <button className="btn" style={{ fontSize: '0.74rem', padding: '2px 8px',
                  background: '#16a34a', color: '#fff' }}
                  disabled={saving} onClick={() => actualizarFila(r.id)}>OK</button>
                <button className="btn" style={{ fontSize: '0.74rem', padding: '2px 8px' }}
                  onClick={() => setEditingId(null)}>Cancelar</button>
              </>
            ) : (
              <>
                <button className="btn" style={{ fontSize: '0.74rem', padding: '2px 8px' }}
                  onClick={() => {
                    setEditingId(r.id);
                    setEditCantidad(String(r.cantidad));
                    setEditFecha(String(r.fecha).split('T')[0]);
                  }}>Editar</button>
                <button className="btn" style={{ fontSize: '0.74rem', padding: '2px 8px', color: '#f87171' }}
                  onClick={() => eliminar(r.id, r.fecha)}>Eliminar</button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }

  function TablaFilas({ filas, labelTotal }: { filas: any[]; labelTotal: string }) {
    const tot = filas.reduce((s, r) => s + Number(r.cantidad), 0);
    return (
      <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['ID','FECHA','CANTIDAD',''].map(h => (
              <th key={h} style={{ padding: '5px 10px',
                textAlign: h === 'CANTIDAD' ? 'right' : 'left',
                color: '#94a3b8', fontSize: '0.72rem',
                borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map(r => <FilaTabla key={r.id} r={r} />)}
          <tr style={{ borderTop: '2px solid rgba(255,255,255,0.15)' }}>
            <td colSpan={2} style={{ padding: '6px 10px', fontWeight: 700, color: '#94a3b8' }}>
              TOTAL {labelTotal}
            </td>
            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#4ade80', fontSize: '1rem' }}>
              {tot}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>

      {/* Formulario nuevo */}
      <div className="card">
        <div style={{ marginBottom: 10 }}><strong>💬 Cargar consultas de WhatsApp</strong></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Fecha</div>
            <input type="date" value={newFecha} onChange={e => setNewFecha(e.target.value)}
              style={{ ...SELECT_DARK, borderColor: fechaYaExiste ? '#f59e0b' : undefined }} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Cantidad</div>
            <input type="number" min={0} value={newCantidad} onChange={e => setNewCantidad(e.target.value)}
              placeholder="0" style={{ ...SELECT_DARK, width: 100 }}
              disabled={fechaYaExiste}
              onKeyDown={e => e.key === 'Enter' && !fechaYaExiste && guardar()} />
          </div>
          <button className="btn" style={{ background: '#16a34a', color: '#fff', height: 36,
            opacity: fechaYaExiste ? 0.5 : 1, cursor: fechaYaExiste ? 'not-allowed' : 'pointer' }}
            disabled={saving || fechaYaExiste} onClick={guardar}>
            {saving ? '⏳ Guardando…' : '💾 Guardar'}
          </button>
          {fechaYaExiste && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
              borderRadius: 8, padding: '6px 12px', fontSize: '0.8rem', color: '#f59e0b' }}>
              ⚠️ Esta fecha ya tiene datos cargados. Usá <strong style={{ marginLeft: 4 }}>Editar</strong> en la tabla de abajo.
            </div>
          )}
        </div>
      </div>

      {/* Listado */}
      <div className="card">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          {!verAnio && (
            <div>
              <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Mes</div>
              <select style={{ ...SELECT_DARK, minWidth: 150 }} value={filtroMes}
                onChange={e => setFiltroMes(e.target.value)}>
                {MESES.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
              </select>
            </div>
          )}
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Año</div>
            <select style={{ ...SELECT_DARK, minWidth: 100 }} value={filtroAnio}
              onChange={e => setFiltroAnio(e.target.value)}>
              {YEARS_RANGE.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              fontSize: '0.82rem', userSelect: 'none' }}>
              <input type="checkbox" checked={verAnio} onChange={e => setVerAnio(e.target.checked)}
                style={{ width: 14, height: 14 }} />
              Ver año completo
            </label>
          </div>
          {rowsHabil.length > 0 && (
            <ExportButtons rows={exportRows} filename={exportFilename} title={exportTitle} />
          )}
        </div>

        {loading ? (
          <div className="muted">Cargando…</div>
        ) : rowsHabil.length === 0 ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Sin registros para {verAnio ? `el año ${filtroAnio}` : 'este mes'}.
          </div>
        ) : verAnio ? (
          // Vista año completo: una sección por mes + resumen anual
          <div style={{ display: 'grid', gap: 16 }}>
            {porMesAnio.map(grupo => (
              <div key={grupo.mes}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8',
                  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {grupo.label}
                  <span style={{ marginLeft: 8, color: '#4ade80', fontWeight: 700 }}>
                    {grupo.total} consultas
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <TablaFilas filas={grupo.filas} labelTotal={grupo.label.toUpperCase()} />
                </div>
              </div>
            ))}
            {/* Resumen anual */}
            <div style={{ borderTop: '2px solid rgba(255,255,255,0.15)', paddingTop: 12,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#94a3b8', fontSize: '0.88rem' }}>
                TOTAL AÑO {filtroAnio}
              </span>
              <span style={{ fontWeight: 700, color: '#4ade80', fontSize: '1.4rem' }}>
                {totalGeneral}
              </span>
            </div>
            {/* Resumen por mes en tabla compacta */}
            <div className="card" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.82rem', color: '#94a3b8' }}>
                Resumen mensual {filtroAnio}
              </div>
              <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '4px 10px', textAlign: 'left', color: '#64748b', fontSize: '0.72rem',
                      borderBottom: '1px solid rgba(255,255,255,0.08)' }}>MES</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right', color: '#64748b', fontSize: '0.72rem',
                      borderBottom: '1px solid rgba(255,255,255,0.08)' }}>DÍAS</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right', color: '#64748b', fontSize: '0.72rem',
                      borderBottom: '1px solid rgba(255,255,255,0.08)' }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {porMesAnio.map(g => (
                    <tr key={g.mes} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '4px 10px' }}>{g.label}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', color: '#94a3b8' }}>{g.filas.length}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 700, color: '#4ade80' }}>{g.total}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid rgba(255,255,255,0.15)' }}>
                    <td style={{ padding: '5px 10px', fontWeight: 700, color: '#94a3b8' }}>TOTAL</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#94a3b8' }}>{rowsHabil.length}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: '#4ade80', fontSize: '1rem' }}>{totalGeneral}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          // Vista mes
          <>
            <div style={{ marginBottom: 8, fontSize: '0.82rem', color: '#94a3b8' }}>
              {rowsHabil.length} día(s) registrado(s) —
              <strong style={{ color: '#4ade80', marginLeft: 6 }}>
                Total mes: {totalGeneral} consultas
              </strong>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <TablaFilas filas={rowsHabil} labelTotal={MESES[Number(filtroMes)-1].toUpperCase()} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Consultas dinámicas ───────────────────────────────────────────────────────
const PRESET_TABLES: Array<{ key: string; label: string; cols?: string[] }> = [
  { key: 'personal', label: 'Personal (datos personales)', cols: ['dni','apellido','nombre','fecha_nacimiento','cuil','email','telefono','domicilio','localidad_id','observaciones','created_at'] },
  { key: 'agentes', label: 'Agentes (datos laborales)', cols: ['id','dni','estado_empleo','fecha_ingreso','fecha_baja','ley_id','planta_id','categoria_id','ocupacion_id','regimen_horario_id','jefatura_id','sector_id','salario_mensual'] },
  { key: 'agentes_servicios', label: 'Agentes - Servicios / Dependencias', cols: ['id','dni','dependencia_id','servicio_nombre','jefe_nombre','fecha_desde','fecha_hasta','motivo','observaciones'] },
  { key: 'agentexdni1', label: 'Vista completa agente' },
  { key: 'consultaspordni', label: 'Consultas con nombre de agente' },
  { key: 'agentehistorial', label: 'Historial de agentes' },
  { key: 'consultas', label: 'Consultas (raw)' },
  { key: 'consultas_whatsapp', label: 'Consultas WhatsApp' },
  { key: 'pedidos', label: 'Pedidos' },
];
type FilterOp = 'contains' | 'eq' | 'starts' | 'notempty' | 'gte' | 'lte';
interface Filter { col: string; op: FilterOp; val: string; }

function ConsultasDinamicasTab() {
  const toast = useToast();
  const [tableKey, setTableKey] = useState('personal');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(200);
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [inferredCols, setInferredCols] = useState<Record<string, string[]>>({});

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingTables(true);
      try {
        const res = await apiFetch<any>('/tables');
        const list: string[] = (res?.data || []).slice().sort();
        if (!mounted) return;
        setAvailableTables(list);
        if (list.length && !list.includes(tableKey))
          setTableKey(list.includes('personal') ? 'personal' : list[0]);
      } catch (e: any) {
        toast.error('Error', e?.message || 'No se pudieron obtener las tablas');
      } finally { if (mounted) setLoadingTables(false); }
    })();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presetKeys = new Set(PRESET_TABLES.map(t => t.key));
  const presetDefs = PRESET_TABLES.filter(t => availableTables.includes(t.key));
  const otherDefs = availableTables.filter(t => !presetKeys.has(t)).map(t => ({ key: t, label: t }));
  const tableDefs = [...presetDefs, ...otherDefs];
  const tableDef = tableDefs.find(t => t.key === tableKey) || tableDefs[0] || { key: tableKey, label: tableKey };
  const allCols = inferredCols[tableKey] || (tableDef as any).cols || (rows[0] ? Object.keys(rows[0]) : []);
  const visCols = selectedCols.length ? selectedCols : allCols;
  const toggleCol = (col: string) => setSelectedCols(p => p.includes(col) ? p.filter(c => c !== col) : [...p, col]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      if (!tableKey || !availableTables.includes(tableKey) || inferredCols[tableKey]) return;
      const preset = PRESET_TABLES.find(t => t.key === tableKey);
      if ((preset as any)?.cols?.length) return;
      try {
        const res = await apiFetch<any>(`/${tableKey}?limit=1&page=1`);
        const first = res?.data?.[0];
        if (first && mounted) {
          const cols = Object.keys(first);
          if (cols.length) setInferredCols(p => ({ ...p, [tableKey]: cols }));
        }
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, [tableKey, availableTables, inferredCols]);

  const addFilter = () => setFilters(p => [...p, { col: allCols[0] || '', op: 'contains', val: '' }]);
  const removeFilter = (i: number) => setFilters(p => p.filter((_, idx) => idx !== i));
  const updateFilter = (i: number, field: keyof Filter, val: string) =>
    setFilters(p => { const n = [...p]; n[i] = { ...n[i], [field]: val }; return n; });

  const buscar = useCallback(async () => {
    setLoading(true); setRows([]);
    try {
      const params: string[] = [`limit=${limit}`, 'page=1'];
      for (const f of filters) {
        if (!f.col || (!f.val.trim() && f.op !== 'notempty')) continue;
        if (f.op === 'contains')  params.push(`${f.col}_contains=${encodeURIComponent(f.val)}`);
        else if (f.op === 'eq')   params.push(`${f.col}=${encodeURIComponent(f.val)}`);
        else if (f.op === 'starts') params.push(`${f.col}_startsWith=${encodeURIComponent(f.val)}`);
        else if (f.op === 'gte')  params.push(`${f.col}_gte=${encodeURIComponent(f.val)}`);
        else if (f.op === 'lte')  params.push(`${f.col}_lte=${encodeURIComponent(f.val)}`);
        else if (f.op === 'notempty') params.push(`${f.col}_ne=`);
      }
      const res = await apiFetch<any>(`/${tableKey}?${params.join('&')}`);
      const data = res?.data || [];
      setRows(data);
      if (!data.length) toast.error('Sin resultados');
      else toast.ok(`${data.length} resultado(s)`);
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error al consultar');
    } finally { setLoading(false); }
  }, [tableKey, filters, limit, toast]);

  const exportData = () => rows.map(r => { const o: any = {}; visCols.forEach(c => { o[c] = r[c] ?? ''; }); return o; });

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 250px' }}>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Tabla / Vista</div>
            <select className="input" value={tableKey}
              onChange={e => { setTableKey(e.target.value); setSelectedCols([]); setFilters([]); setRows([]); }}>
              {loadingTables && <option value="">Cargando...</option>}
              {!loadingTables && tableDefs.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Límite</div>
            <select className="input" value={limit} onChange={e => setLimit(Number(e.target.value))}>
              {[50,100,200].map(n => <option key={n} value={n}>{n} filas</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 6 }}>
            Columnas
            <button className="btn" style={{ marginLeft: 8, fontSize: '0.72rem', padding: '1px 8px' }}
              onClick={() => setSelectedCols([])}>Reset</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allCols.map(col => (
              <label key={col} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                background: visCols.includes(col) ? 'rgba(37,99,235,0.25)' : 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '2px 8px', fontSize: '0.76rem' }}>
                <input type="checkbox" checked={visCols.includes(col)} onChange={() => toggleCol(col)} style={{ width: 12, height: 12 }} />
                {col}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <strong style={{ fontSize: '0.88rem' }}>🔍 Filtros</strong>
          <button className="btn" onClick={addFilter} style={{ fontSize: '0.78rem' }}>+ Agregar filtro</button>
        </div>
        {filters.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {allCols.length
              ? <select className="input" value={f.col} onChange={e => updateFilter(i,'col',e.target.value)} style={{ minWidth: 140, fontSize: '0.82rem' }}>
                  {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              : <input className="input" value={f.col} onChange={e => updateFilter(i,'col',e.target.value)} placeholder="columna" style={{ minWidth: 140, fontSize: '0.82rem' }} />
            }
            <select className="input" value={f.op} onChange={e => updateFilter(i,'op',e.target.value)} style={{ minWidth: 130, fontSize: '0.82rem' }}>
              <option value="contains">contiene</option>
              <option value="eq">igual a</option>
              <option value="starts">empieza con</option>
              <option value="gte">≥ mayor/igual</option>
              <option value="lte">≤ menor/igual</option>
              <option value="notempty">no vacío</option>
            </select>
            {f.op !== 'notempty' && (
              <input className="input" value={f.val} onChange={e => updateFilter(i,'val',e.target.value)}
                placeholder="valor…" style={{ minWidth: 140, fontSize: '0.82rem' }} />
            )}
            <button className="btn" onClick={() => removeFilter(i)} style={{ color: '#f87171', fontSize: '0.8rem', padding: '2px 8px' }}>✕</button>
          </div>
        ))}
        {!filters.length && <div className="muted" style={{ fontSize: '0.8rem' }}>Sin filtros</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" style={{ background: '#2563eb', color: '#fff' }} disabled={loading} onClick={buscar}>
          {loading ? '⏳ Consultando…' : '▶ Ejecutar'}
        </button>
        {rows.length > 0 && (
          <>
            <button className="btn" onClick={() => printTable(`Consulta ${tableKey}`, rows)}>🖨 Imprimir</button>
            <button className="btn" style={{ background: '#16a34a', color: '#fff' }}
              onClick={() => exportToExcel(`consulta_${tableKey}.xlsx`, exportData())}>📊 Excel</button>
            <button className="btn" style={{ background: '#dc2626', color: '#fff' }}
              onClick={() => exportToPdf(`consulta_${tableKey}`, exportData())}>📕 PDF</button>
            <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>{rows.length} registro(s)</span>
          </>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                  {visCols.map(c => (
                    <th key={c} style={{ padding: '6px 10px', textAlign: 'left', whiteSpace: 'nowrap',
                      borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: '0.72rem', color: '#94a3b8' }}>
                      {c.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    {visCols.map(c => (
                      <td key={c} style={{ padding: '4px 10px', maxWidth: 300, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(r[c] ?? '')}>
                        {r[c] == null ? <span className="muted">—</span> : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ReportesPage ─────────────────────────────────────────────────────────────
export function ReportesPage() {
  const [tab, setTab] = useState<TabKey>('cumpleanos');
  return (
    <Layout title="Reportes" showBack>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={`btn${tab === 'cumpleanos' ? ' active' : ''}`}
          onClick={() => setTab('cumpleanos')}>🎂 Cumpleaños</button>
        <button className={`btn${tab === 'antiguedad' ? ' active' : ''}`}
          onClick={() => setTab('antiguedad')}>🏅 Antigüedad</button>
        <button className={`btn${tab === 'estadisticas_consultas' ? ' active' : ''}`}
          onClick={() => setTab('estadisticas_consultas')}>📋 Consultas de Ventanilla</button>
        <button className={`btn${tab === 'whatsapp' ? ' active' : ''}`}
          onClick={() => setTab('whatsapp')}>💬 WhatsApp</button>
        <button className={`btn${tab === 'consultas_dinamicas' ? ' active' : ''}`}
          onClick={() => setTab('consultas_dinamicas')}>📊 Consultas dinámicas</button>
      </div>
      {tab === 'cumpleanos'             && <CumpleanosTab />}
      {tab === 'antiguedad'             && <AntigüedadTab />}
      {tab === 'estadisticas_consultas' && <EstadisticasConsultasTab />}
      {tab === 'whatsapp'               && <WhatsappTab />}
      {tab === 'consultas_dinamicas'    && <ConsultasDinamicasTab />}
    </Layout>
  );
}

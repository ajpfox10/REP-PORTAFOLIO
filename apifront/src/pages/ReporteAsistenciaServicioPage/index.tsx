// src/pages/ReporteAsistenciaServicioPage/index.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import XLSXStyle from 'xlsx-js-style';
import { saveAs } from 'file-saver';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

interface Servicio { id: number; nombre: string; }
interface Feriado  { fecha: string; nombre: string; tipo: string; }

interface DiaDet {
  fecha: string; diaSemana: string;
  esFeriado: boolean; feriadoNombre: string | null;
  debiaTrabajo: boolean; esLaboralBase: boolean;
  entrada_prog: string | null; salida_prog: string | null;
  horasTeoricas: number;
  entrada_real: string | null; salida_real: string | null;
  invertido: boolean;
  horasReales: number;
  cumplioHoras: boolean;
  novedades: string[];
}

interface ResumenSemana { semana: string; teorico: number; real: number; laboral: number; }

interface AgenteReporte {
  dni: string; nombre: string; enHorario: boolean;
  dias: DiaDet[];
  resumenMensual: {
    diasLaborales: number; diasFeriados: number;
    horasTeoricas: number; horasReales: number;
    diasConFichaje: number; diasSinFichaje: number; diasSinSalida: number; diasCumplio: number; diasConNovedad: number;
    diasInvertido: number;
  };
  resumenSemanal: ResumenSemana[];
}

interface Reporte {
  ok: boolean;
  servicio: Servicio;
  periodo: string;
  feriados: Feriado[];
  agentes: AgenteReporte[];
  dbError: string | null;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmtFecha(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtHs(hs: number) {
  if (!hs) return '—';
  const h = Math.floor(hs);
  const m = Math.round((hs - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function pct(real: number, teorico: number) {
  if (!teorico) return null;
  return Math.round((real / teorico) * 100);
}

function colorPct(p: number | null) {
  if (p === null) return 'rgba(255,255,255,0.3)';
  if (p >= 95)  return '#10b981';
  if (p >= 80)  return '#eab308';
  return '#ef4444';
}

// Semana ISO: lunes → domingo, label "DD/MM – DD/MM"
function semanaLabel(isoLunes: string) {
  const d = new Date(isoLunes + 'T00:00:00Z');
  const fin = new Date(d); fin.setUTCDate(fin.getUTCDate() + 6);
  const fmt2 = (dt: Date) => `${String(dt.getUTCDate()).padStart(2,'0')}/${String(dt.getUTCMonth()+1).padStart(2,'0')}`;
  return `${fmt2(d)} – ${fmt2(fin)}`;
}

// ─── PÁGINA ──────────────────────────────────────────────────────────────────

export function ReporteAsistenciaServicioPage() {
  const toast = useToast();

  // ── Selección ──
  const [servicios, setServicios]       = useState<Servicio[]>([]);
  const [servicioId, setServicioId]     = useState('');
  const [periodo, setPeriodo]           = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  });
  const [archivos, setArchivos]           = useState<{ name: string }[]>([]);
  const [siapFile, setSiapFile]           = useState('');
  const [horariosFile, setHorariosFile]   = useState('');
  const [ministerioFile, setMinisterioFile] = useState('');

  // ── Resultado ──
  const [reporte, setReporte]   = useState<Reporte | null>(null);
  const [loading, setLoading]   = useState(false);

  // ── Vista ──
  const [agenteAbierto, setAgenteAbierto] = useState<string | null>(null);
  const [vistaAgente, setVistaAgente]     = useState<'semanas' | 'dias'>('semanas');

  // Cargar servicios y archivos al montar
  useEffect(() => {
    apiFetch<any>('/servicios?limit=500&sort=nombre').then(r => {
      setServicios(r?.data || r || []);
    }).catch(() => {});

    apiFetch<any>('/asistencia/archivos').then(r => {
      if (!r?.ok || !Array.isArray(r.files)) return;
      setArchivos(r.files);
      const s = r.files.find((f: any) => f.name.toUpperCase().includes('SIAP'));
      const h = r.files.find((f: any) => f.name.toUpperCase().includes('HORARIO'));
      const mn = r.files.find((f: any) => f.name.toUpperCase().includes('MINISTERIO'));
      if (s) setSiapFile(s.name);
      if (h) setHorariosFile(h.name);
      if (mn) setMinisterioFile(mn.name);
    }).catch(() => {});
  }, []);

  // ── Generar reporte ──
  const handleGenerar = useCallback(async () => {
    if (!servicioId) { toast.error('Falta servicio', 'Seleccioná un servicio.'); return; }
    if (!periodo)    { toast.error('Falta período', 'Seleccioná el período.'); return; }
    setLoading(true); setReporte(null); setAgenteAbierto(null);
    try {
      const params = new URLSearchParams({ servicio_id: servicioId, periodo });
      if (siapFile)       params.set('siapFile', siapFile);
      if (horariosFile)   params.set('horariosFile', horariosFile);
      if (ministerioFile) params.set('ministerioFile', ministerioFile);
      const r = await apiFetch<Reporte>(`/asistencia/reporte-servicio?${params}`);
      if (!r?.ok) throw new Error((r as any)?.error || 'Error del servidor');
      setReporte(r);
      if (r.dbError) toast.error('Aviso biométrico', r.dbError);
      toast.ok('Reporte generado', `${r.agentes.length} agentes — ${r.feriados.length} feriados en el período`);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, [servicioId, periodo, siapFile, horariosFile, ministerioFile]);

  // ── Exportar Excel multi-hoja con estilos ───────────────────────────────
  const handleExport = () => {
    if (!reporte) return;
    const wb = XLSXStyle.utils.book_new();

    const FILL_MORADO  = { patternType: 'solid', fgColor: { rgb: 'C39BD3' } }; // sin salida
    const FILL_AMARILL = { patternType: 'solid', fgColor: { rgb: 'FAD7A0' } }; // sin fichaje
    const FILL_HEADER  = { patternType: 'solid', fgColor: { rgb: '2C3E50' } };
    const FONT_HEADER  = { bold: true, color: { rgb: 'FFFFFF' } };
    const FONT_BOLD    = { bold: true };
    const NUM_COLS     = 12;

    const styledCell = (v: any, style: any) => ({ v, s: style });

    // ── Hoja 1: Resumen ───────────────────────────────────────────────────
    const resHdr = ['DNI','Nombre','En Horario','Días Lab.','Hs Teóricas','Hs Reales','Cumplimiento %','Con Fichaje','Sin Fichaje','Sin Salida','Cumplió Hs (≥90%)','Con Novedad'];
    const resAoa: any[][] = [resHdr.map(h => styledCell(h, { fill: FILL_HEADER, font: FONT_HEADER }))];
    for (const a of reporte.agentes) {
      const p = pct(a.resumenMensual.horasReales, a.resumenMensual.horasTeoricas);
      resAoa.push([
        a.dni, a.nombre, a.enHorario ? 'Sí' : 'No',
        a.resumenMensual.diasLaborales, a.resumenMensual.horasTeoricas, a.resumenMensual.horasReales,
        p !== null ? `${p}%` : '',
        a.resumenMensual.diasConFichaje, a.resumenMensual.diasSinFichaje,
        a.resumenMensual.diasSinSalida, a.resumenMensual.diasCumplio, a.resumenMensual.diasConNovedad,
      ]);
    }
    XLSXStyle.utils.book_append_sheet(wb, XLSXStyle.utils.aoa_to_sheet(resAoa), 'Resumen');

    // ── Hoja por agente ───────────────────────────────────────────────────
    for (const a of reporte.agentes) {
      const sheetName = (a.nombre || a.dni).slice(0, 28).replace(/[\\/*?[\]:]/g, '_');
      const p = pct(a.resumenMensual.horasReales, a.resumenMensual.horasTeoricas);

      const aoa: any[][] = [
        [`${a.nombre || a.dni}`, '', `DNI: ${a.dni}`, '', `Período: ${reporte.periodo}`],
        [`Servicio: ${reporte.servicio.nombre}`],
        [],
        ['Días Lab.','Hs Teóricas','Hs Reales','Cumplimiento %','Con Fichaje','Sin Fichaje','Sin Salida','Cumplió (≥90%)','Con Novedad'].map(h => styledCell(h, { fill: FILL_HEADER, font: FONT_HEADER })),
        [
          a.resumenMensual.diasLaborales, a.resumenMensual.horasTeoricas, a.resumenMensual.horasReales,
          p !== null ? `${p}%` : '',
          a.resumenMensual.diasConFichaje, a.resumenMensual.diasSinFichaje, a.resumenMensual.diasSinSalida,
          a.resumenMensual.diasCumplio, a.resumenMensual.diasConNovedad,
        ],
        [],
        ['Fecha','Día','Prog. Entrada','Prog. Salida','Hs Teóricas','Entrada Real','Salida Real','Hs Reales','% del Día','Cumplió','Estado','Novedad'].map(h => styledCell(h, { fill: FILL_HEADER, font: FONT_HEADER })),
      ];

      // Sólo días laborales y feriados que caen en día laboral
      const HEADER_ROWS = aoa.length;
      const styleMap = new Map<number, { fill?: any; bold?: boolean }>();

      const FILL_AMARILL_INV = { patternType: 'solid', fgColor: { rgb: 'FEF08A' } }; // invertido

      const diasFiltrados = a.dias.filter(d => d.debiaTrabajo || (d.esFeriado && d.esLaboralBase) || d.entrada_real !== null || d.salida_real !== null);

      diasFiltrados.forEach((d, i) => {
        const pDia = d.horasTeoricas > 0 ? Math.round((d.horasReales / d.horasTeoricas) * 100) : null;
        const novedad = d.novedades.map(n => n.replace(/^(SIAP|Min): /, '')).join(' / ');
        const sinSalida = !!d.entrada_real && !d.salida_real;
        const estado =
          d.esFeriado                           ? `Feriado: ${d.feriadoNombre ?? ''}` :
          !d.debiaTrabajo                       ? 'No laboral' :
          !d.entrada_real && d.novedades.length ? 'Novedad' :
          !d.entrada_real                       ? 'Sin fichaje' :
          d.invertido                           ? 'Fichó (invertido)' :
          sinSalida                             ? 'Sin salida' : 'Fichó';

        aoa.push([
          fmtFecha(d.fecha), d.diaSemana,
          d.entrada_prog ?? '', d.salida_prog ?? '',
          d.horasTeoricas || '',
          d.entrada_real  ?? '', d.salida_real ?? '',
          d.horasReales   || '',
          pDia !== null   ? `${pDia}%` : '',
          d.debiaTrabajo && d.horasTeoricas > 0 ? (d.cumplioHoras ? 'Sí' : 'No') : '',
          estado, novedad,
        ]);

        const sinFichaje = !d.entrada_real && d.debiaTrabajo && !d.novedades.length;
        const noCumplio  = d.debiaTrabajo && d.horasTeoricas > 0 && !d.cumplioHoras;
        if (d.invertido || sinSalida || sinFichaje || noCumplio) {
          styleMap.set(HEADER_ROWS + i, {
            fill: d.invertido ? FILL_AMARILL_INV : sinSalida ? FILL_MORADO : sinFichaje ? FILL_AMARILL : undefined,
            bold: noCumplio,
          });
        }
      });

      const ws = XLSXStyle.utils.aoa_to_sheet(aoa);

      // Aplicar estilos fila por fila
      for (const [rowIdx, st] of styleMap) {
        for (let c = 0; c < NUM_COLS; c++) {
          const ref = XLSXStyle.utils.encode_cell({ r: rowIdx, c });
          if (!ws[ref]) ws[ref] = { t: 'z', v: '' };
          ws[ref].s = {
            ...(st.fill ? { fill: st.fill } : {}),
            font: { bold: !!st.bold },
          };
        }
      }

      XLSXStyle.utils.book_append_sheet(wb, ws, sheetName);
    }

    const out = XLSXStyle.write(wb, { type: 'array', bookType: 'xlsx' });
    saveAs(
      new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `reporte-${reporte.servicio.nombre}-${reporte.periodo}.xlsx`
    );
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <Layout title="📊 Reporte de Asistencia por Servicio" showBack>

      {/* ── Panel de selección ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="h2" style={{ marginBottom: 12 }}>Configurar reporte</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>

          <div style={fg}>
            <label style={lbl}>Servicio *</label>
            <select className="input" value={servicioId} onChange={e => setServicioId(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {servicios.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          <div style={fg}>
            <label style={lbl}>Período *</label>
            <input className="input" type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} />
          </div>

          <div style={fg}>
            <label style={lbl}>Archivo SIAP</label>
            <select className="input" value={siapFile} onChange={e => setSiapFile(e.target.value)}>
              <option value="">— sin SIAP —</option>
              {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>

          <div style={fg}>
            <label style={lbl}>Archivo Ministerio</label>
            <select className="input" value={ministerioFile} onChange={e => setMinisterioFile(e.target.value)}>
              <option value="">— sin Ministerio —</option>
              {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>

          <div style={fg}>
            <label style={lbl}>Archivo Horarios</label>
            <select className="input" value={horariosFile} onChange={e => setHorariosFile(e.target.value)}>
              <option value="">— sin horarios —</option>
              {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" type="button" onClick={handleGenerar} disabled={loading}>
            {loading ? 'Generando...' : '▶ Generar reporte'}
          </button>
          {reporte && (
            <button className="btn" type="button" onClick={handleExport} style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
              ⬇ Exportar Excel
            </button>
          )}
        </div>
      </div>

      {/* ── Resultado ── */}
      {reporte && (
        <>
          {/* Header del reporte */}
          <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{reporte.servicio.nombre}</div>
            <div className="muted">Período: {reporte.periodo}</div>
            <div className="muted">·</div>
            <div className="muted">{reporte.agentes.length} agentes</div>
            {reporte.feriados.length > 0 && (
              <>
                <div className="muted">·</div>
                <div className="muted">🗓 {reporte.feriados.length} feriados</div>
              </>
            )}
          </div>

          {/* Feriados del mes */}
          {reporte.feriados.length > 0 && (
            <div className="card" style={{ marginBottom: 12, padding: '10px 14px' }}>
              <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#94a3b8', marginBottom: 6 }}>FERIADOS DEL PERÍODO</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {reporte.feriados.map(f => (
                  <span key={f.fecha} style={{
                    background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                    borderRadius: 6, padding: '2px 8px', fontSize: '0.78rem',
                  }}>
                    {fmtFecha(f.fecha)} · {f.nombre}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Tabla resumen mensual ── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="h2" style={{ marginBottom: 10 }}>Resumen mensual</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Agente</th>
                    <th>DNI</th>
                    <th title="En archivo de horarios">Horario</th>
                    <th>Días Lab.</th>
                    <th>Hs Teóricas</th>
                    <th>Hs Reales</th>
                    <th>Cumplimiento</th>
                    <th>Con Fichaje</th>
                    <th>Sin Fichaje</th>
                    <th title="Fichó entrada pero no salida">Sin Salida</th>
                    <th title="Fichajes con entrada y salida invertidos (ambos tipo entrada)">Invertidos</th>
                    <th title="Días que cumplió al menos el 90% de las horas teóricas">Cumplió Hs</th>
                    <th>Con Novedad</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.agentes.map(a => {
                    const p = pct(a.resumenMensual.horasReales, a.resumenMensual.horasTeoricas);
                    const abierto = agenteAbierto === a.dni;
                    const borderColor = a.resumenMensual.diasSinFichaje > 0 ? '#ef4444'
                                      : a.resumenMensual.diasSinSalida  > 0 ? '#eab308'
                                      : undefined;
                    return (
                      <React.Fragment key={a.dni}>
                        <tr style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : {}}>
                          <td style={{ fontWeight: 600 }}>{a.nombre || '—'}</td>
                          <td>{a.dni}</td>
                          <td>
                            {a.enHorario
                              ? <span style={{ color: '#10b981', fontSize: '0.78rem' }}>✓ Sí</span>
                              : <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Sin info</span>}
                          </td>
                          <td>{a.resumenMensual.diasLaborales}</td>
                          <td>{fmtHs(a.resumenMensual.horasTeoricas)}</td>
                          <td>{fmtHs(a.resumenMensual.horasReales)}</td>
                          <td>
                            {p !== null ? (
                              <span style={{
                                background: `${colorPct(p)}22`, color: colorPct(p),
                                borderRadius: 6, padding: '1px 8px', fontWeight: 700, fontSize: '0.82rem',
                              }}>
                                {p}%
                              </span>
                            ) : <span className="muted">—</span>}
                          </td>
                          <td style={{ color: '#10b981' }}>{a.resumenMensual.diasConFichaje}</td>
                          <td style={{ color: a.resumenMensual.diasSinFichaje ? '#ef4444' : undefined }}>
                            {a.resumenMensual.diasSinFichaje || '—'}
                          </td>
                          <td style={{ color: a.resumenMensual.diasSinSalida ? '#eab308' : undefined }}>
                            {a.resumenMensual.diasSinSalida || '—'}
                          </td>
                          <td style={{ color: a.resumenMensual.diasInvertido ? '#eab308' : undefined }}>
                            {a.resumenMensual.diasInvertido || '—'}
                          </td>
                          <td style={{ color: '#10b981' }}>
                            {a.resumenMensual.diasCumplio || '—'}
                            {a.resumenMensual.diasLaborales > 0 && a.resumenMensual.diasCumplio > 0 && (
                              <span style={{ fontSize: '0.72rem', marginLeft: 4, opacity: 0.7 }}>
                                ({Math.round(a.resumenMensual.diasCumplio / a.resumenMensual.diasLaborales * 100)}%)
                              </span>
                            )}
                          </td>
                          <td>{a.resumenMensual.diasConNovedad || '—'}</td>
                          <td>
                            <button
                              className="btn"
                              type="button"
                              style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                              onClick={() => setAgenteAbierto(abierto ? null : a.dni)}
                            >
                              {abierto ? '▲ Cerrar' : '▼ Ver'}
                            </button>
                          </td>
                        </tr>

                        {/* ── Detalle expandido ── */}
                        {abierto && (
                          <tr>
                            <td colSpan={11} style={{ padding: 0, background: 'rgba(0,0,0,0.15)' }}>
                              <div style={{ padding: '12px 16px' }}>

                                {/* Tabs semanas / días */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                  {(['semanas', 'dias'] as const).map(v => (
                                    <button key={v} className="btn" type="button"
                                      style={{ fontSize: '0.78rem', padding: '3px 10px', ...(vistaAgente === v ? { background: 'rgba(99,102,241,0.25)', color: '#818cf8' } : {}) }}
                                      onClick={() => setVistaAgente(v)}>
                                      {v === 'semanas' ? '📅 Semanas' : '📋 Días'}
                                    </button>
                                  ))}
                                </div>

                                {/* Vista semanas */}
                                {vistaAgente === 'semanas' && (
                                  <div style={{ overflowX: 'auto' }}>
                                    <table className="table" style={{ width: '100%' }}>
                                      <thead>
                                        <tr>
                                          <th>Semana</th>
                                          <th>Días Lab.</th>
                                          <th>Hs Teóricas</th>
                                          <th>Hs Reales</th>
                                          <th>Cumplimiento</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {a.resumenSemanal.map(s => {
                                          const ps = pct(s.real, s.teorico);
                                          return (
                                            <tr key={s.semana}>
                                              <td style={{ fontSize: '0.82rem' }}>{semanaLabel(s.semana)}</td>
                                              <td>{s.laboral}</td>
                                              <td>{fmtHs(s.teorico)}</td>
                                              <td>{fmtHs(s.real)}</td>
                                              <td>
                                                {ps !== null ? (
                                                  <span style={{ color: colorPct(ps), fontWeight: 700, fontSize: '0.82rem' }}>{ps}%</span>
                                                ) : <span className="muted">—</span>}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                        {/* Fila total */}
                                        <tr style={{ fontWeight: 700, borderTop: '2px solid rgba(255,255,255,0.1)' }}>
                                          <td>TOTAL MES</td>
                                          <td>{a.resumenMensual.diasLaborales}</td>
                                          <td>{fmtHs(a.resumenMensual.horasTeoricas)}</td>
                                          <td>{fmtHs(a.resumenMensual.horasReales)}</td>
                                          <td>
                                            {pct(a.resumenMensual.horasReales, a.resumenMensual.horasTeoricas) !== null ? (
                                              <span style={{ color: colorPct(pct(a.resumenMensual.horasReales, a.resumenMensual.horasTeoricas)), fontWeight: 700 }}>
                                                {pct(a.resumenMensual.horasReales, a.resumenMensual.horasTeoricas)}%
                                              </span>
                                            ) : '—'}
                                          </td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {/* Vista días */}
                                {vistaAgente === 'dias' && (
                                  <div style={{ overflowX: 'auto' }}>
                                    <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
                                      <thead>
                                        <tr>
                                          <th>Fecha</th>
                                          <th>Día</th>
                                          <th>Estado</th>
                                          <th>Prog. Entrada</th>
                                          <th>Prog. Salida</th>
                                          <th>Hs Teór.</th>
                                          <th>Entrada Real</th>
                                          <th>Salida Real</th>
                                          <th>Hs Reales</th>
                                          <th title="≥90% horas teóricas">Cumplió</th>
                                          <th>Novedad SIAP</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {a.dias
                                          .filter(d => d.debiaTrabajo || d.esFeriado || d.entrada_real !== null || d.salida_real !== null)
                                          .map(d => {
                                          const sinSalida = !!d.entrada_real && !d.salida_real;
                                          const bgRow: React.CSSProperties =
                                            d.esFeriado     ? { background: 'rgba(99,102,241,0.1)' } :
                                            !d.debiaTrabajo ? { background: 'rgba(148,163,184,0.07)', borderLeft: '3px solid #475569' } :
                                            d.invertido     ? { background: 'rgba(234,179,8,0.1)', borderLeft: '3px solid #eab308' } :
                                            sinSalida       ? { background: 'rgba(234,179,8,0.1)', borderLeft: '3px solid #eab308' } :
                                            !d.entrada_real && !d.novedades.length ? { background: 'rgba(239,68,68,0.1)', borderLeft: '3px solid #ef4444' } :
                                            {};
                                          return (
                                            <tr key={d.fecha} style={bgRow}>
                                              <td>{fmtFecha(d.fecha)}</td>
                                              <td>{d.diaSemana}</td>
                                              <td style={{ fontSize: '0.72rem' }}>
                                                {d.esFeriado
                                                  ? <span style={{ color: '#818cf8' }}>🗓 {d.feriadoNombre}</span>
                                                  : !d.debiaTrabajo
                                                    ? <span style={{ color: '#94a3b8' }}>No laboral</span>
                                                    : d.invertido
                                                      ? <span style={{ color: '#eab308' }}>⚠ Invertido</span>
                                                      : sinSalida
                                                        ? <span style={{ color: '#eab308' }}>⚠ Sin salida</span>
                                                        : d.entrada_real
                                                          ? <span style={{ color: '#10b981' }}>✓ Fichó</span>
                                                          : d.novedades.length
                                                            ? <span style={{ color: '#eab308' }}>📋 Novedad</span>
                                                            : <span style={{ color: '#ef4444' }}>✗ Sin fichaje</span>}
                                              </td>
                                              <td>{d.entrada_prog ?? '—'}</td>
                                              <td>{d.salida_prog  ?? '—'}</td>
                                              <td>{d.horasTeoricas ? fmtHs(d.horasTeoricas) : '—'}</td>
                                              <td style={{ color: d.entrada_real ? '#10b981' : undefined }}>{d.entrada_real ?? '—'}</td>
                                              <td style={{ color: d.invertido ? '#eab308' : sinSalida ? '#eab308' : d.salida_real ? '#10b981' : undefined }}>
                                                {d.salida_real ?? '—'}
                                              </td>
                                              <td>{d.horasReales ? fmtHs(d.horasReales) : '—'}</td>
                                              <td style={{ textAlign: 'center' }}>
                                                {d.debiaTrabajo && d.horasTeoricas > 0
                                                  ? d.cumplioHoras
                                                    ? <span style={{ color: '#10b981', fontSize: '0.82rem' }}>✓</span>
                                                    : <span style={{ color: '#ef4444', fontSize: '0.82rem' }}>✗</span>
                                                  : <span className="muted">—</span>}
                                              </td>
                                              <td style={{ fontSize: '0.72rem', maxWidth: 200 }}>
                                                {d.novedades.length ? d.novedades.join(' / ') : '—'}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {!reporte.agentes.length && (
                    <tr><td colSpan={11} className="muted" style={{ padding: 12 }}>
                      Sin agentes en el servicio para este período.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Aviso sin biométrico */}
          {reporte.dbError && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308', fontSize: '0.82rem' }}>
              ⚠️ Sin datos biométricos: {reporte.dbError}. Los fichajes muestran "—".
            </div>
          )}
        </>
      )}

    </Layout>
  );
}

const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' };

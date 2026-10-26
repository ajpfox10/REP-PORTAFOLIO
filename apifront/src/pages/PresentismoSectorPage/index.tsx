// src/pages/PresentismoSectorPage/index.tsx
// "Presentismo por turno" — se abre desde Mi Sector (pestaña nueva).
// Por día: tabla sector × turno con teóricos (HORARIOS.xlsx), fichados y motivo de cada ausencia.
// Click en una fila → abajo se despliega quiénes faltaron (con la novedad), quiénes no tienen
// ni fichaje ni novedad cargada, y los presentes con su hora de entrada/salida.
// El jefe con varios sectores elige cuáles ver. Datos: GET /presentismo-sector.
// Pestaña "🔮 Próximos días": predicción de cuellos de botella (Prediccion.tsx).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { Prediccion } from './Prediccion';
import { exportarPresentismo } from './exportarExcel';

interface Registro {
  fecha: string;
  dni: string;
  turno: string;
  horario: string;
  estado: string;
  novedad: { detalle: string; desde: string; hasta: string } | null;
  fichada: { primera: string; ultima: string } | null;
}
interface Agente { dni: string; nombre: string; sector: string; ocupacion: string }
interface Resp {
  ok: boolean;
  error?: string;
  desde: string;
  hasta: string;
  dias: string[];
  servicio: { id: number; nombre: string; ids: number[] };
  agentes: Agente[];
  registros: Registro[];
  sinHorario: Agente[];
  feriados: { fecha: string; nombre: string }[];
  rotacion: {
    desde: string; hasta: string; agentes: { dni: string; trabaja: number; franco: number }[];
    finde?: { dni: string; dia: string; entrada: string; salida: string; veces: number }[];
  };
  fuentes: { ministerioAl: string | null; siapeAl: string | null; fichadasError: string | null };
}

// Columnas de motivo, en el orden en que se muestran
const CATS: { k: string; label: string; color: string }[] = [
  { k: 'FICHO', label: 'Ficharon',     color: '#86efac' },
  { k: 'ENF',   label: 'Enfermedad',   color: '#fca5a5' },
  { k: 'ART',   label: 'Acc. trabajo', color: '#fca5a5' },
  { k: 'VAC',   label: 'Vacaciones',   color: '#93c5fd' },
  { k: 'COMP',  label: 'Anual compl.', color: '#93c5fd' },
  { k: 'A26',   label: 'Art. 26',      color: '#fcd34d' },
  { k: 'FC',    label: 'Franco comp.', color: '#fcd34d' },
  { k: 'INA',   label: 'Inasist. 28',  color: '#fdba74' },
  { k: 'OTR',   label: 'Otras',        color: '#cbd5e1' },
  { k: 'FER',   label: 'Feriado',      color: '#a5b4fc' },
  { k: 'PSF',   label: 'Presente SIAPE sin fichar', color: '#c4b5fd' },
  { k: 'NOSIAPE', label: 'Falta descargar SIAPE',   color: '#94a3b8' },
  { k: 'SIN',   label: 'Sin fichaje ni novedad', color: '#f87171' },
];
const LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.k, c.label]));
const TURNOS = ['Mañana', 'Tarde', 'Vespertino', 'Noche', '24 h'];
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const isoHoy = () => new Date().toISOString().slice(0, 10);
function sumarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmtFecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtDia = (iso: string) => `${DOW[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${fmtFecha(iso)}`;
const nombreSector = (s: string) => (s === '(SIN SECTOR)' ? 'Sin sector asignado' : s);

const thSt: React.CSSProperties = { padding: '5px 5px', textAlign: 'right', fontSize: '0.68rem', lineHeight: 1.15, color: '#94a3b8', fontWeight: 600, whiteSpace: 'normal', verticalAlign: 'bottom', borderBottom: '1px solid rgba(255,255,255,0.12)' };
const tdSt: React.CSSProperties = { padding: '4px 5px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.06)' };
// Los bloques por día salen del ancho del contenedor de la página y usan el de la ventana (solo la tabla se ensancha)
const chipSt = (activo: boolean): React.CSSProperties => ({ padding: '3px 10px', fontSize: '0.75rem', opacity: activo ? 1 : 0.55, border: activo ? '1px solid #86efac' : undefined });
const anchoVentana: React.CSSProperties = { width: 'min(calc(100vw - 32px), 1500px)', position: 'relative', left: '50%', transform: 'translateX(-50%)' };

export function PresentismoSectorPage() {
  const [hasta, setHasta] = useState(sumarDias(isoHoy(), -1));
  const [desde, setDesde] = useState(sumarDias(isoHoy(), -15));
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectoresSel, setSectoresSel] = useState<Set<string>>(new Set()); // vacío = todos
  const [abierta, setAbierta] = useState<string | null>(null);              // fecha|sector|turno
  const [diasCerrados, setDiasCerrados] = useState<Set<string>>(new Set());
  const [verRanking, setVerRanking] = useState(false);
  const [vista, setVista] = useState<'pasado' | 'futuro'>('pasado');
  const [diasSoloTot, setDiasSoloTot] = useState<Set<string>>(new Set());     // días con los sectores ocultos (solo filas Total)
  const [turnoSel, setTurnoSel] = useState<string | null>(null);              // null = todos los turnos
  const [novedadSel, setNovedadSel] = useState<string | null>(null);          // null = todas las columnas

  const cargar = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ desde, hasta });
      if (refresh) qs.set('refresh', '1');
      const res = await apiFetch<Resp>(`/presentismo-sector?${qs.toString()}`);
      if (!res?.ok) throw new Error(res?.error || 'Error cargando el presentismo');
      setData(res);
      setAbierta(null);
    } catch (e: any) {
      setError(e?.message || 'Error cargando el presentismo');
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => { void cargar(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const agentesPorDni = useMemo(() => {
    const m = new Map<string, Agente>();
    for (const a of data?.agentes ?? []) m.set(a.dni, a);
    return m;
  }, [data]);

  // Sectores del servicio con cantidad de agentes
  const sectores = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of data?.agentes ?? []) c.set(a.sector, (c.get(a.sector) || 0) + 1);
    return [...c.entries()].sort((a, b) => {
      if (a[0] === '(SIN SECTOR)') return 1;
      if (b[0] === '(SIN SECTOR)') return -1;
      return a[0].localeCompare(b[0], 'es');
    });
  }, [data]);

  const sectorOk = useCallback((s: string) => sectoresSel.size === 0 || sectoresSel.has(s), [sectoresSel]);

  const delSector = useMemo(
    () => (data?.registros ?? []).filter(r => sectorOk(agentesPorDni.get(r.dni)?.sector ?? '') && (!turnoSel || r.turno === turnoSel)),
    [data, agentesPorDni, sectorOk, turnoSel],
  );
  // ROT = no le tocaba por su rotación real: no cuenta como teórico, se lista aparte en el detalle
  const registros = useMemo(() => delSector.filter(r => r.estado !== 'ROT'), [delSector]);
  const rotados = useMemo(() => {
    const m = new Map<string, Registro[]>();
    for (const r of delSector) {
      if (r.estado !== 'ROT') continue;
      const k = `${r.fecha}|${agentesPorDni.get(r.dni)?.sector ?? '(SIN SECTOR)'}|${r.turno}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  }, [delSector, agentesPorDni]);

  const toggleSector = (s: string) => {
    setSectoresSel(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
    setAbierta(null);
  };

  // Totales del período
  const totales = useMemo(() => {
    const t: Record<string, number> = { TEO: 0 };
    for (const r of registros) { t.TEO++; t[r.estado] = (t[r.estado] || 0) + 1; }
    return t;
  }, [registros]);

  // Ranking: agentes con días sin fichaje ni novedad
  const ranking = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of registros) {
      if (r.estado !== 'SIN') continue;
      if (!m.has(r.dni)) m.set(r.dni, []);
      if (!m.get(r.dni)!.includes(r.fecha)) m.get(r.dni)!.push(r.fecha);   // el de 06–18 tiene Mañana y Tarde
    }
    return [...m.entries()]
      .map(([dni, fechas]) => ({ dni, fechas, a: agentesPorDni.get(dni) }))
      .sort((x, y) => y.fechas.length - x.fechas.length || (x.a?.nombre ?? '').localeCompare(y.a?.nombre ?? '', 'es'));
  }, [registros, agentesPorDni]);

  // Por día → sector → turno
  const porDia = useMemo(() => {
    const dias = new Map<string, Map<string, Map<string, Registro[]>>>();
    for (const r of registros) {
      const sec = agentesPorDni.get(r.dni)?.sector ?? '(SIN SECTOR)';
      if (!dias.has(r.fecha)) dias.set(r.fecha, new Map());
      const d = dias.get(r.fecha)!;
      if (!d.has(sec)) d.set(sec, new Map());
      const s = d.get(sec)!;
      if (!s.has(r.turno)) s.set(r.turno, []);
      s.get(r.turno)!.push(r);
    }
    return dias;
  }, [registros, agentesPorDni]);

  const ordenSectores = sectores.map(([s]) => s);
  const cuenta = (rs: Registro[], k: string) => rs.filter(r => r.estado === k).length;

  const toggleSoloTot = (f: string) => setDiasSoloTot(prev => {
    const next = new Set(prev);
    if (next.has(f)) next.delete(f); else next.add(f);
    return next;
  });

  // Excel con una pestaña por día (con los filtros de sector y turno aplicados)
  const exportar = (dias: string[], sufijo: string) => {
    if (!data) return;
    const set = new Set(dias);
    const servicio = data.servicio?.nombre ?? 'Servicio';
    exportarPresentismo({
      dias,
      registros: registros.filter(r => set.has(r.fecha)),
      rotados: delSector.filter(r => r.estado === 'ROT' && set.has(r.fecha)),
      cats: CATS, turnos: TURNOS, ordenSectores,
      sectorDe: dni => agentesPorDni.get(dni)?.sector ?? '(SIN SECTOR)',
      nombreDe: dni => agentesPorDni.get(dni)?.nombre ?? dni,
      nombreSector, fmtDia, servicio, feriados: data.feriados ?? [],
      archivo: `presentismo_${servicio.replace(/[^\wÁÉÍÓÚÑáéíóúñ]+/g, '_')}_${sufijo}.xlsx`,
    });
  };
  // Lunes a domingo de la semana del día (solo los días consultados)
  const semanaDe = (f: string) => {
    const lunes = sumarDias(f, -((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7));
    return (data?.dias ?? []).filter(x => x >= lunes && x <= sumarDias(lunes, 6));
  };

  const toggleDia = (f: string) => setDiasCerrados(prev => {
    const next = new Set(prev);
    if (next.has(f)) next.delete(f); else next.add(f);
    return next;
  });

  return (
    <Layout title="Presentismo por turno">
      {/* Encabezado y filtros */}
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="h2" style={{ margin: 0 }}>📊 Presentismo por turno</div>
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
              {data?.servicio?.nombre ?? '—'}
              {data?.fuentes?.ministerioAl && <> · Novedades del Ministerio al <b>{data.fuentes.ministerioAl}</b></>}
              {data?.fuentes && <> · Historial SIAPE descargado hasta el <b>{data.fuentes.siapeAl ? fmtFecha(data.fuentes.siapeAl) : '—'}</b></>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.75rem' }} className="muted">Desde<br />
              <input className="input" type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} />
            </label>
            <label style={{ fontSize: '0.75rem' }} className="muted">Hasta<br />
              <input className="input" type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} />
            </label>
            <button className="btn" type="button" onClick={() => cargar(true)} disabled={loading}>
              {loading ? 'Cargando…' : '🔄 Consultar'}
            </button>
            {vista === 'pasado' && data && !loading && (
              <button className="btn" type="button" title="Una pestaña por día + Resumen"
                onClick={() => exportar(data.dias, `${data.desde}_a_${data.hasta}`)}>
                ⬇ Excel del período
              </button>
            )}
          </div>
        </div>

        {sectores.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 6 }}>Sectores (sin selección = todos)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button type="button" className="btn" onClick={() => { setSectoresSel(new Set()); setAbierta(null); }}
                style={{ padding: '3px 10px', fontSize: '0.75rem', opacity: sectoresSel.size === 0 ? 1 : 0.55, border: sectoresSel.size === 0 ? '1px solid #86efac' : undefined }}>
                Todos
              </button>
              {sectores.map(([s, n]) => (
                <button key={s} type="button" className="btn" onClick={() => toggleSector(s)}
                  style={{ padding: '3px 10px', fontSize: '0.75rem', opacity: sectoresSel.has(s) ? 1 : 0.55, border: sectoresSel.has(s) ? '1px solid #86efac' : undefined }}>
                  {nombreSector(s)} <span className="muted">({n})</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        {([['pasado', '📅 Lo que pasó'], ['futuro', '🔮 Próximos días']] as const).map(([k, l]) => (
          <button key={k} type="button" className="btn" onClick={() => setVista(k)}
            style={{ padding: '6px 14px', opacity: vista === k ? 1 : 0.6, border: vista === k ? '1px solid #86efac' : undefined }}>
            {l}
          </button>
        ))}
      </div>

      {vista === 'futuro' && <Prediccion sectorOk={sectorOk} ordenSectores={ordenSectores} />}

      {vista === 'pasado' && error && (
        <div className="card" style={{ marginTop: 12, padding: 14, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>{error}</div>
      )}
      {vista === 'pasado' && data?.fuentes?.fichadasError && (
        <div className="card" style={{ marginTop: 12, padding: 12, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.4)', fontSize: '0.85rem' }}>
          ⚠️ {data.fuentes.fichadasError}: no se pudieron leer las fichadas, todos los que no tienen novedad aparecen como "sin fichaje".
        </div>
      )}

      {vista === 'pasado' && data && !loading && (
        <>
          {/* Totales del período */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <div className="card" style={{ padding: '8px 14px', minWidth: 110, textAlign: 'center' }}>
              <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{totales.TEO}</div>
              <div className="muted" style={{ fontSize: '0.72rem' }}>Turnos teóricos</div>
            </div>
            {CATS.filter(c => totales[c.k]).map(c => (
              <div key={c.k} className="card" style={{ padding: '8px 14px', minWidth: 110, textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: c.color }}>{totales[c.k]}</div>
                <div className="muted" style={{ fontSize: '0.72rem' }}>{c.label}</div>
              </div>
            ))}
          </div>

          {/* Cómo ver los días: colapsar, solo totales, separar por turno o por novedad */}
          <div className="card" style={{ marginTop: 12, padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center', fontSize: '0.78rem' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="muted">Días</span>
              <button type="button" className="btn" style={chipSt(false)} onClick={() => setDiasCerrados(new Set(data.dias))}>▼ Colapsar todos</button>
              <button type="button" className="btn" style={chipSt(false)} onClick={() => setDiasCerrados(new Set())}>▲ Abrir todos</button>
              <button type="button" className="btn" style={chipSt(diasSoloTot.size === data.dias.length)}
                onClick={() => { setDiasSoloTot(diasSoloTot.size === data.dias.length ? new Set() : new Set(data.dias)); setAbierta(null); }}>
                {diasSoloTot.size === data.dias.length ? 'Mostrar sectores en todos' : 'Ocultar sectores en todos (solo totales)'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted">Turno</span>
              {[null, ...TURNOS].map(t => (
                <button key={t ?? 'todos'} type="button" className="btn" style={chipSt(turnoSel === t)}
                  onClick={() => { setTurnoSel(t); setAbierta(null); }}>{t ?? 'Todos'}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted">Novedad</span>
              <button type="button" className="btn" style={chipSt(novedadSel === null)} onClick={() => { setNovedadSel(null); setAbierta(null); }}>Todas</button>
              {CATS.filter(c => totales[c.k]).map(c => (
                <button key={c.k} type="button" className="btn" style={{ ...chipSt(novedadSel === c.k), color: c.color }}
                  onClick={() => { setNovedadSel(novedadSel === c.k ? null : c.k); setAbierta(null); }}>{c.label}</button>
              ))}
            </div>
          </div>

          {/* Ranking sin fichaje ni novedad */}
          {ranking.length > 0 && (
            <div className="card" style={{ marginTop: 12, padding: 14, border: '1px solid rgba(248,113,113,0.35)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setVerRanking(v => !v)}>
                <div style={{ fontWeight: 600, color: '#f87171' }}>
                  🚩 Sin fichaje ni novedad cargada — {ranking.length} agentes, {totales.SIN || 0} turnos
                </div>
                <span className="muted">{verRanking ? '▲' : '▼'}</span>
              </div>
              {verRanking && (
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead><tr>
                      <th style={{ ...thSt, textAlign: 'left' }}>Agente</th>
                      <th style={{ ...thSt, textAlign: 'left' }}>DNI</th>
                      <th style={{ ...thSt, textAlign: 'left' }}>Sector</th>
                      <th style={thSt}>Turnos</th>
                      <th style={{ ...thSt, textAlign: 'left' }}>Días</th>
                    </tr></thead>
                    <tbody>
                      {ranking.map(x => (
                        <tr key={x.dni}>
                          <td style={{ ...tdSt, textAlign: 'left' }}>{x.a?.nombre ?? x.dni}</td>
                          <td style={{ ...tdSt, textAlign: 'left' }} className="muted">{x.dni}</td>
                          <td style={{ ...tdSt, textAlign: 'left' }}>{nombreSector(x.a?.sector ?? '')}</td>
                          <td style={{ ...tdSt, color: '#f87171', fontWeight: 700 }}>{x.fechas.length}</td>
                          <td style={{ ...tdSt, textAlign: 'left', whiteSpace: 'normal' }}>{x.fechas.map(fmtDia).join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Un bloque por día */}
          {data.dias.map(f => {
            const d = porDia.get(f);
            if (!d) return null;
            const regsDia = registros.filter(r => r.fecha === f);
            const cerrado = diasCerrados.has(f);
            const soloTot = diasSoloTot.has(f);
            const colsDia = CATS.filter(c => (!novedadSel || c.k === novedadSel) && regsDia.some(r => r.estado === c.k));
            // Con una novedad elegida solo quedan las filas que la tienen
            const filaOk = (rs: Registro[]) => !novedadSel || cuenta(rs, novedadSel) > 0;
            return (
              <div key={f} className="card" style={{ marginTop: 12, padding: 0, overflow: 'hidden', ...anchoVentana }}>
                <div onClick={() => toggleDia(f)} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)' }}>
                  <div style={{ fontWeight: 700 }}>
                    {fmtDia(f)}
                    {data.feriados?.find(x => x.fecha === f) && (
                      <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.8rem', color: '#a5b4fc' }}>
                        Feriado · {data.feriados.find(x => x.fecha === f)!.nombre}
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="btn" style={chipSt(false)} title="Excel de este día"
                      onClick={e => { e.stopPropagation(); exportar([f], f); }}>⬇ Día</button>
                    <button type="button" className="btn" style={chipSt(false)} title="Excel de lunes a domingo de esta semana (una pestaña por día)"
                      onClick={e => { e.stopPropagation(); const s = semanaDe(f); exportar(s, `semana_${s[0]}_a_${s[s.length - 1]}`); }}>⬇ Semana</button>
                    {!cerrado && (
                      <button type="button" className="btn" style={chipSt(soloTot)}
                        onClick={e => { e.stopPropagation(); toggleSoloTot(f); }}>
                        {soloTot ? 'Mostrar sectores' : 'Ocultar sectores'}
                      </button>
                    )}
                    <span>
                    {/* por agente, no por turno: el de 06–18 cuenta en Mañana y en Tarde */}
                    {new Set(regsDia.filter(r => r.estado === 'FICHO').map(r => r.dni)).size}/{new Set(regsDia.map(r => r.dni)).size} ficharon
                    {cuenta(regsDia, 'SIN') > 0 && <span style={{ color: '#f87171' }}> · {cuenta(regsDia, 'SIN')} sin fichaje ni novedad</span>}
                    {novedadSel && !['FICHO', 'SIN'].includes(novedadSel) && (
                      <span style={{ color: CATS.find(c => c.k === novedadSel)?.color }}> · {cuenta(regsDia, novedadSel)} {LABEL[novedadSel]}</span>
                    )}
                    {' '}{cerrado ? '▼' : '▲'}
                    </span>
                  </div>
                </div>
                {!cerrado && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead><tr>
                        <th style={{ ...thSt, textAlign: 'left' }}>Sector</th>
                        <th style={{ ...thSt, textAlign: 'left' }}>Turno</th>
                        <th style={thSt}>Teóricos</th>
                        {colsDia.map(c => <th key={c.k} style={{ ...thSt, maxWidth: 74 }} title={c.label}>{c.label}</th>)}
                      </tr></thead>
                      <tbody>
                        {!soloTot && ordenSectores.filter(s => d.has(s)).map(s => {
                          const turnos = TURNOS.filter(t => d.get(s)!.has(t) && filaOk(d.get(s)!.get(t)!));
                          return turnos.map((t, i) => {
                            const rs = d.get(s)!.get(t)!;
                            const key = `${f}|${s}|${t}`;
                            const open = abierta === key;
                            return (
                              <React.Fragment key={key}>
                                <tr onClick={() => setAbierta(open ? null : key)}
                                  style={{ cursor: 'pointer', background: open ? 'rgba(134,239,172,0.08)' : undefined }}
                                  title="Click para ver los agentes">
                                  <td style={{ ...tdSt, textAlign: 'left', fontWeight: 600, whiteSpace: 'normal', maxWidth: 210, fontSize: '0.76rem' }}>{i === 0 ? nombreSector(s) : ''}</td>
                                  <td style={{ ...tdSt, textAlign: 'left' }}>{open ? '▾ ' : '▸ '}{t}</td>
                                  <td style={{ ...tdSt, fontWeight: 600 }}>{rs.length}</td>
                                  {colsDia.map(c => {
                                    const n = cuenta(rs, c.k);
                                    return <td key={c.k} style={{ ...tdSt, color: n ? c.color : 'rgba(255,255,255,0.2)', fontWeight: n && c.k === 'SIN' ? 700 : undefined }}>{n || '·'}</td>;
                                  })}
                                </tr>
                                {open && (
                                  <tr><td colSpan={3 + colsDia.length} style={{ padding: 0 }}>
                                    <DetalleFila regs={rs} rot={rotados.get(key) ?? []} agentes={agentesPorDni} />
                                  </td></tr>
                                )}
                              </React.Fragment>
                            );
                          });
                        })}
                        {TURNOS.filter(t => regsDia.some(r => r.turno === t)).map(t => {
                          const rs = regsDia.filter(r => r.turno === t);
                          if (!filaOk(rs)) return null;
                          return (
                            <tr key={`tot-${t}`} style={{ background: 'rgba(147,197,253,0.08)' }}>
                              <td style={{ ...tdSt, textAlign: 'left', fontWeight: 700 }}>Total</td>
                              <td style={{ ...tdSt, textAlign: 'left', fontWeight: 700 }}>{t}</td>
                              <td style={{ ...tdSt, fontWeight: 700 }}>{rs.length}</td>
                              {colsDia.map(c => <td key={c.k} style={{ ...tdSt, fontWeight: 700 }}>{cuenta(rs, c.k) || '·'}</td>)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {data.rotacion?.agentes?.length > 0 && (
            <div className="card muted" style={{ marginTop: 12, padding: 12, fontSize: '0.8rem' }}>
              🔄 Rotación detectada en <b>{data.rotacion.agentes.filter(a => sectorOk(agentesPorDni.get(a.dni)?.sector ?? '')).length}</b> agentes
              (fichadas y SIAPE del {fmtFecha(data.rotacion.desde)} al {fmtFecha(data.rotacion.hasta)}): HORARIOS.xlsx los diagrama todos
              los días, pero trabajan días alternados. Los días que no les tocan (<b>{delSector.length - registros.length}</b> turnos en el período)
              no se cuentan como teóricos; se ven en el detalle de cada turno.
            </div>
          )}
          {(data.rotacion?.finde?.length ?? 0) > 0 && (
            <div className="card muted" style={{ marginTop: 12, padding: 12, fontSize: '0.8rem' }}>
              📆 Fines de semana que HORARIOS.xlsx no tiene pero se toman de las fichadas (vinieron seguido en las últimas 8 semanas):{' '}
              {data.rotacion.finde!.filter(x => sectorOk(agentesPorDni.get(x.dni)?.sector ?? ''))
                .map(x => `${agentesPorDni.get(x.dni)?.nombre ?? x.dni} (${x.dia} ${x.entrada}–${x.salida}, ${x.veces} veces)`).join(' · ')}
            </div>
          )}
          {data.sinHorario.length > 0 && (
            <div className="card muted" style={{ marginTop: 12, padding: 12, fontSize: '0.8rem' }}>
              {data.sinHorario.length} agente(s) del servicio no figuran en HORARIOS.xlsx y no se cuentan:{' '}
              {data.sinHorario.map(a => a.nombre).join(' · ')}
            </div>
          )}
          <div className="muted" style={{ fontSize: '0.72rem', margin: '10px 2px 20px' }}>
            Teóricos: turnos de HORARIOS.xlsx, sin los días que no le tocan por su rotación real. Novedades: Ministerio, historial SIAPE, Salud Laboral, francos y Art. 26 cargados por los jefes.
            Fichada: marca del reloj dentro del turno (± 3 h; la noche se cierra con la salida del día siguiente).
            Turnos noche y 24 h cuentan el día en que entran.
            Sin fichada ni novedad se separa en: presente en SIAPE sin fichar, falta descargar SIAPE (días posteriores a la última descarga del historial) y sin fichaje ni novedad.
          </div>
        </>
      )}
    </Layout>
  );
}

// Detalle al hacer click en sector × turno: faltaron, sin fichaje ni novedad, presentes
function DetalleFila({ regs, rot, agentes }: { regs: Registro[]; rot: Registro[]; agentes: Map<string, Agente> }) {
  const nom = (r: Registro) => agentes.get(r.dni)?.nombre ?? r.dni;
  const orden = (a: Registro, b: Registro) => nom(a).localeCompare(nom(b), 'es');
  const faltaron = regs.filter(r => !['FICHO', 'SIN', 'FER', 'PSF', 'NOSIAPE'].includes(r.estado)).sort(orden);
  const psf = regs.filter(r => r.estado === 'PSF').sort(orden);
  const noSiape = regs.filter(r => r.estado === 'NOSIAPE').sort(orden);
  const feriado = regs.filter(r => r.estado === 'FER').sort(orden);
  const sin = regs.filter(r => r.estado === 'SIN').sort(orden);
  const presentes = regs.filter(r => r.estado === 'FICHO').sort(orden);

  const lista = (titulo: string, color: string, rs: Registro[], render: (r: Registro) => React.ReactNode) => (
    rs.length > 0 && (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color, marginBottom: 4 }}>{titulo} ({rs.length})</div>
        {rs.map(r => (
          <div key={r.dni} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '3px 8px', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ minWidth: 230, fontWeight: 600 }}>{nom(r)}</span>
            <span className="muted" style={{ minWidth: 80 }}>{r.dni}</span>
            <span className="muted" style={{ minWidth: 95 }}>{r.horario}</span>
            {render(r)}
          </div>
        ))}
      </div>
    )
  );

  return (
    <div style={{ padding: '10px 14px 4px 28px', background: 'rgba(0,0,0,0.18)' }}>
      {lista('Faltaron', '#fca5a5', faltaron, r => (
        <span>
          <b>{LABEL[r.estado]}</b>
          {r.novedad && <span className="muted"> · {r.novedad.detalle} ({fmtFecha(r.novedad.desde)}{r.novedad.hasta !== r.novedad.desde ? ` → ${fmtFecha(r.novedad.hasta)}` : ''})</span>}
        </span>
      ))}
      {lista('Sin fichaje ni novedad cargada', '#f87171', sin, () => <span style={{ color: '#f87171' }}>No fichó y no tiene novedad</span>)}
      {lista('Presente en SIAPE sin fichar', '#c4b5fd', psf, () => <span style={{ color: '#c4b5fd' }}>SIAPE lo da presente pero no hay marca en el reloj</span>)}
      {lista('Falta descargar SIAPE', '#94a3b8', noSiape, () => <span className="muted">No fichó; el historial de SIAPE todavía no llega a este día</span>)}
      {lista('No vinieron por feriado', '#a5b4fc', feriado, () => <span className="muted">Sin fichada, día feriado</span>)}
      {lista('No le tocaba por su rotación (no cuenta como teórico)', '#94a3b8', [...rot].sort(orden), () => <span className="muted">Franco de rotación</span>)}
      {lista('Presentes', '#86efac', presentes, r => (
        <span>Entrada {r.fichada?.primera ?? '—'}{r.fichada && r.fichada.ultima !== r.fichada.primera ? ` · Salida ${r.fichada.ultima}` : ''}</span>
      ))}
    </div>
  );
}

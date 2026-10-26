// src/pages/PresentismoSectorPage/Prediccion.tsx
// Pestaña "🔮 Próximos días" de Presentismo por turno: presentes esperados por sector × turno × día,
// con semáforo contra el mínimo que carga el jefe (hábil / fin de semana y feriado) y contra lo normal.
// Click en una celda → quién ya se sabe que no viene y quién puede faltar (probabilidad).
// Datos: GET /presentismo-sector/prediccion · PUT /presentismo-sector/minimos.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';

interface Conocido { dni: string; motivo: string; detalle: string; desde: string; hasta: string }
interface Restante { dni: string; p: number; historiaDias: number }
interface Fila {
  fecha: string; tipoDia: 'habil' | 'finde'; sector: string; turno: string; teoricos: number;
  conocidos: Conocido[]; restantes: Restante[]; rotacion: string[];
  esperados: number; normal: number | null; minimo: number | null; riesgo: number | null;
  nivel: 'ok' | 'amarillo' | 'rojo';
}
interface Resp {
  ok: boolean; error?: string;
  dias: string[]; filas: Fila[];
  feriados: { fecha: string; nombre: string }[];
  agentes: { dni: string; nombre: string; sector: string }[];
  minimos: { sector: string; turno: string; tipo_dia: string; minimo: number }[];
  rotacion: { desde: string; hasta: string; agentes: { dni: string }[] };
  modelo: { histDesde: string; histHasta: string; tasaServicio: number; factorMes: number[]; normalDesde: string; normalHasta: string };
  fuentes: { ministerioAl: string | null; fichadasError: string | null };
}

const TURNOS = ['Mañana', 'Tarde', 'Vespertino', 'Noche', '24 h'];
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MOTIVO: Record<string, string> = {
  ENF: 'Enfermedad', ART: 'Acc. trabajo', VAC: 'Vacaciones', COMP: 'Anual compl.',
  A26: 'Art. 26', FC: 'Franco comp.', INA: 'Inasist. 28', OTR: 'Otra licencia',
};
const COLOR = {
  rojo:     { bg: 'rgba(239,68,68,0.28)',  fg: '#fecaca' },
  amarillo: { bg: 'rgba(251,191,36,0.22)', fg: '#fde68a' },
  ok:       { bg: 'rgba(134,239,172,0.08)', fg: '#d1fae5' },
};
const fmtFecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dowDe = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const fmtDia = (iso: string) => `${DOW[dowDe(iso)]} ${fmtFecha(iso)}`;
const nombreSector = (s: string) => (s === '(SIN SECTOR)' ? 'Sin sector asignado' : s);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const thSt: React.CSSProperties = { padding: '5px 6px', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.12)', textAlign: 'center' };
const tdSt: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' };

export function Prediccion({ sectorOk, ordenSectores }: { sectorOk: (s: string) => boolean; ordenSectores: string[] }) {
  const [horizonte, setHorizonte] = useState(14);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);           // fecha|sector|turno
  const [guardando, setGuardando] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());   // sectores desplegados (arrancan colapsados)

  const cargar = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<Resp>(`/presentismo-sector/prediccion?dias=${horizonte}${refresh ? '&refresh=1' : ''}`);
      if (!res?.ok) throw new Error(res?.error || 'Error armando la predicción');
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Error armando la predicción');
    } finally {
      setLoading(false);
    }
  }, [horizonte]);

  useEffect(() => { void cargar(false); }, [cargar]);

  const nombres = useMemo(() => new Map((data?.agentes ?? []).map(a => [a.dni, a.nombre])), [data]);
  const feriados = useMemo(() => new Map((data?.feriados ?? []).map(f => [f.fecha, f.nombre])), [data]);
  const minimos = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.minimos ?? []) m.set(`${r.sector}|${r.turno}|${r.tipo_dia}`, r.minimo);
    return m;
  }, [data]);

  const filas = useMemo(() => (data?.filas ?? []).filter(f => sectorOk(f.sector)), [data, sectorOk]);
  const porClave = useMemo(() => {
    const m = new Map<string, Fila>();
    for (const f of filas) m.set(`${f.fecha}|${f.sector}|${f.turno}`, f);
    return m;
  }, [filas]);

  // Filas de la grilla: sector × turno que aparecen en el horizonte
  const grilla = useMemo(() => {
    const set = new Set(filas.map(f => `${f.sector}|${f.turno}`));
    const out: { sector: string; turno: string }[] = [];
    const sectores = [...new Set(filas.map(f => f.sector))].sort((a, b) => {
      const ia = ordenSectores.indexOf(a), ib = ordenSectores.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'es');
    });
    for (const s of sectores) for (const t of TURNOS) if (set.has(`${s}|${t}`)) out.push({ sector: s, turno: t });
    return out;
  }, [filas, ordenSectores]);

  // Fila resumen del sector por día: por agente (el de 06–18 está en Mañana y en Tarde), el peor color de sus turnos
  const resumenSector = useCallback((sector: string, d: string) => {
    const fs = TURNOS.map(t => porClave.get(`${d}|${sector}|${t}`)).filter(Boolean) as Fila[];
    if (!fs.length) return null;
    const teo = new Set<string>(), lic = new Set<string>(), esp = new Map<string, number>();
    for (const f of fs) {
      for (const c of f.conocidos) { teo.add(c.dni); lic.add(c.dni); }
      for (const r of f.restantes) { teo.add(r.dni); esp.set(r.dni, 1 - r.p); }
    }
    const nivel = fs.some(f => f.nivel === 'rojo') ? 'rojo' : fs.some(f => f.nivel === 'amarillo') ? 'amarillo' : 'ok';
    const enRojo = fs.filter(f => f.nivel === 'rojo').length;
    return { teoricos: teo.size, licencia: lic.size, esperados: [...esp.values()].reduce((a, b) => a + b, 0), nivel, enRojo } as const;
  }, [porClave]);
  const toggleSector = (s: string) => setAbiertos(prev => {
    const n = new Set(prev);
    if (n.has(s)) n.delete(s); else n.add(s);
    return n;
  });

  const alertas = useMemo(
    () => filas.filter(f => f.nivel === 'rojo')
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sector.localeCompare(b.sector, 'es')),
    [filas],
  );

  const guardarMinimo = async (sector: string, turno: string, tipo: string) => {
    const k = `${sector}|${turno}|${tipo}`;
    const txt = (borradores[k] ?? '').trim();
    const actual = minimos.get(k);
    if (txt === (actual != null ? String(actual) : '')) return;
    setGuardando(k);
    try {
      const res = await apiFetch<any>('/presentismo-sector/minimos', {
        method: 'PUT',
        body: JSON.stringify({ sector, turno, tipo_dia: tipo, minimo: txt === '' ? null : Number(txt) }),
      });
      if (!res?.ok) throw new Error(res?.error || 'No se pudo guardar el mínimo');
      setBorradores(b => { const n = { ...b }; delete n[k]; return n; });
      await cargar(false);
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar el mínimo');
    } finally {
      setGuardando(null);
    }
  };

  const inputMin = (sector: string, turno: string, tipo: 'habil' | 'finde') => {
    const k = `${sector}|${turno}|${tipo}`;
    const val = borradores[k] ?? (minimos.has(k) ? String(minimos.get(k)) : '');
    return (
      <input
        className="input"
        type="number"
        min={0}
        max={200}
        value={val}
        placeholder="—"
        disabled={guardando === k}
        title={tipo === 'habil' ? 'Mínimo de lunes a viernes' : 'Mínimo sábado, domingo y feriados'}
        onChange={e => setBorradores(b => ({ ...b, [k]: e.target.value }))}
        onBlur={() => guardarMinimo(sector, turno, tipo)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: 52, padding: '2px 4px', fontSize: '0.78rem', textAlign: 'center' }}
      />
    );
  };

  const filaSel = sel ? porClave.get(sel) : null;

  return (
    <>
      <div className="card" style={{ marginTop: 12, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: '0.8rem' }} className="muted">
            Presentes esperados por sector y turno. <span style={{ color: COLOR.rojo.fg }}>Rojo</span>: debajo del mínimo o
            menos del 70% de lo normal · <span style={{ color: COLOR.amarillo.fg }}>Amarillo</span>: riesgo de no llegar al
            mínimo ≥ 20% o menos del 85% de lo normal. Click en una celda para ver quiénes.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="input" value={horizonte} onChange={e => setHorizonte(Number(e.target.value))}>
              <option value={7}>Próximos 7 días</option>
              <option value={14}>Próximos 14 días</option>
              <option value={31}>Próximos 31 días</option>
            </select>
            <button className="btn" type="button" onClick={() => cargar(true)} disabled={loading}>
              {loading ? 'Calculando…' : '🔄 Recalcular'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginTop: 12, padding: 14, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>{error}</div>
      )}

      {data && !loading && (
        <>
          {/* Alertas */}
          <div className="card" style={{ marginTop: 12, padding: 14, border: alertas.length ? '1px solid rgba(239,68,68,0.4)' : undefined }}>
            <div style={{ fontWeight: 600, color: alertas.length ? '#f87171' : '#86efac', marginBottom: alertas.length ? 8 : 0 }}>
              {alertas.length ? `🚨 ${alertas.length} turnos en rojo` : '✅ Sin turnos en rojo en el período'}
            </div>
            {alertas.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {alertas.slice(0, 40).map(f => {
                  const k = `${f.fecha}|${f.sector}|${f.turno}`;
                  return (
                    <button key={k} type="button" className="btn" onClick={() => setSel(k)}
                      style={{ padding: '3px 8px', fontSize: '0.74rem', background: COLOR.rojo.bg, border: sel === k ? '1px solid #fecaca' : undefined }}>
                      {fmtDia(f.fecha)} · {nombreSector(f.sector)} · {f.turno}: <b>{f.esperados}</b>
                      {f.minimo != null ? ` / mín ${f.minimo}` : f.normal != null ? ` / normal ${f.normal}` : ''}
                    </button>
                  );
                })}
                {alertas.length > 40 && <span className="muted" style={{ fontSize: '0.75rem' }}>… y {alertas.length - 40} más en la grilla</span>}
              </div>
            )}
          </div>

          {/* Detalle de la celda elegida */}
          {filaSel && <Detalle f={filaSel} nombres={nombres} onClose={() => setSel(null)} />}

          <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center', fontSize: '0.78rem' }}>
            <span className="muted">Sectores</span>
            <button type="button" className="btn" style={{ padding: '3px 10px', fontSize: '0.75rem' }} onClick={() => setAbiertos(new Set())}>▸ Colapsar todos</button>
            <button type="button" className="btn" style={{ padding: '3px 10px', fontSize: '0.75rem' }}
              onClick={() => setAbiertos(new Set(grilla.map(g => g.sector)))}>▾ Abrir todos</button>
            <span className="muted">· click en el sector para ver sus turnos</span>
          </div>

          {/* Grilla */}
          <div className="card" style={{ marginTop: 12, padding: 0, overflowX: 'auto', width: 'min(calc(100vw - 32px), 1500px)', position: 'relative', left: '50%', transform: 'translateX(-50%)' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...thSt, textAlign: 'left' }}>Sector</th>
                  <th style={{ ...thSt, textAlign: 'left' }}>Turno</th>
                  <th style={thSt} title="Mínimo de lunes a viernes">Mín. L–V</th>
                  <th style={thSt} title="Mínimo sábado, domingo y feriados">Mín. S/D/F</th>
                  {data.dias.map(d => {
                    const finde = dowDe(d) === 0 || dowDe(d) === 6 || feriados.has(d);
                    return (
                      <th key={d} style={{ ...thSt, color: finde ? '#a5b4fc' : thSt.color }} title={feriados.get(d) || ''}>
                        {DOW[dowDe(d)]}<br />{fmtFecha(d)}{feriados.has(d) ? ' 🎌' : ''}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {grilla.map(({ sector, turno }, i) => {
                  const primero = i === 0 || grilla[i - 1].sector !== sector;
                  const abierto = abiertos.has(sector);
                  const resumen = primero && (
                    <tr key={`${sector}|resumen`} onClick={() => toggleSector(sector)} title="Click para ver u ocultar los turnos"
                      style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.03)', ...(i > 0 ? { borderTop: '2px solid rgba(255,255,255,0.12)' } : {}) }}>
                      <td style={{ ...tdSt, textAlign: 'left', fontWeight: 700 }}>{abierto ? '▾ ' : '▸ '}{nombreSector(sector)}</td>
                      <td style={{ ...tdSt, textAlign: 'left' }} className="muted">{abierto ? '' : 'Todos'}</td>
                      <td style={tdSt} /><td style={tdSt} />
                      {data.dias.map(d => {
                        const r = resumenSector(sector, d);
                        if (!r) return <td key={d} style={{ ...tdSt, color: 'rgba(255,255,255,0.15)' }}>·</td>;
                        const c = COLOR[r.nivel];
                        return (
                          <td key={d} title={`Agentes ${r.teoricos} · con licencia ${r.licencia} · esperados ${r.esperados.toFixed(1)}${r.enRojo ? ` · ${r.enRojo} turno(s) en rojo` : ''}`}
                            style={{ ...tdSt, background: c.bg, color: c.fg, fontWeight: r.nivel === 'ok' ? 400 : 700 }}>
                            {r.esperados.toFixed(1)}
                            <div style={{ fontSize: '0.62rem', opacity: 0.7, fontWeight: 400 }}>{r.teoricos}{r.licencia ? ` −${r.licencia}` : ''}</div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                  if (!abierto) return resumen || null;
                  return (
                    <React.Fragment key={`${sector}|${turno}`}>
                    {resumen}
                    <tr>
                      <td style={{ ...tdSt, textAlign: 'left' }} />
                      <td style={{ ...tdSt, textAlign: 'left' }}>{turno}</td>
                      <td style={tdSt}>{inputMin(sector, turno, 'habil')}</td>
                      <td style={tdSt}>{inputMin(sector, turno, 'finde')}</td>
                      {data.dias.map(d => {
                        const k = `${d}|${sector}|${turno}`;
                        const f = porClave.get(k);
                        if (!f) return <td key={d} style={{ ...tdSt, color: 'rgba(255,255,255,0.15)' }}>·</td>;
                        const c = COLOR[f.nivel];
                        return (
                          <td key={d} onClick={() => setSel(sel === k ? null : k)}
                            title={`Teóricos ${f.teoricos} · con licencia ${f.conocidos.length} · esperados ${f.esperados}`
                              + `${f.normal != null ? ` · normal ${f.normal}` : ''}${f.minimo != null ? ` · mínimo ${f.minimo}` : ''}`
                              + `${f.riesgo != null ? ` · riesgo ${pct(f.riesgo)}` : ''}`}
                            style={{ ...tdSt, cursor: 'pointer', background: c.bg, color: c.fg, fontWeight: f.nivel === 'ok' ? 400 : 700,
                              outline: sel === k ? '2px solid #e2e8f0' : undefined }}>
                            {f.esperados.toFixed(1)}
                            <div style={{ fontSize: '0.62rem', opacity: 0.7, fontWeight: 400 }}>
                              {f.teoricos}{f.conocidos.length ? ` −${f.conocidos.length}` : ''}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="muted" style={{ fontSize: '0.72rem', margin: '10px 2px 20px', lineHeight: 1.5 }}>
            Cada celda: presentes esperados (arriba) y teóricos − ya con licencia (abajo). La fila del sector suma por agente
            (el de 06 a 18 cuenta en Mañana y en Tarde, pero en el sector una sola vez) y toma el peor color de sus turnos.
            Sábados y domingos que HORARIOS.xlsx no tiene se toman de las fichadas si el agente vino seguido en las últimas 8 semanas.
            Teóricos = HORARIOS.xlsx sin los días que no les tocan por su rotación real (detectada en {data.rotacion?.agentes?.length ?? 0} agentes
            con las fichadas y el SIAPE de las últimas 8 semanas).
            Esperados = teóricos sin licencia cargada × (1 − probabilidad de ausencia no planificada de cada agente).
            La probabilidad sale del historial SIAPE {fmtFecha(data.modelo.histDesde)}/{data.modelo.histDesde.slice(0, 4)} –{' '}
            {fmtFecha(data.modelo.histHasta)}/{data.modelo.histHasta.slice(0, 4)} (enfermedad, sin aviso, causas particulares,
            familiar, accidente, duelo, paro; tasa del servicio {pct(data.modelo.tasaServicio)}), ajustada por mes
            (historial desde 2020: {data.modelo.factorMes.map((x, i) => `${MESES[i]} ${x}`).join(' · ')}) y por turno × día de semana.
            Normal = promedio de presentes fichados {fmtFecha(data.modelo.normalDesde)} – {fmtFecha(data.modelo.normalHasta)}.
            {data.fuentes.ministerioAl && <> Licencias del Ministerio al {data.fuentes.ministerioAl}: las cargadas después todavía no se ven.</>}
          </div>
        </>
      )}
    </>
  );
}

function Detalle({ f, nombres, onClose }: { f: Fila; nombres: Map<string, string>; onClose: () => void }) {
  const nom = (dni: string) => nombres.get(dni) ?? dni;
  const c = COLOR[f.nivel];
  return (
    <div className="card" style={{ marginTop: 12, padding: 14, border: `1px solid ${c.fg}55` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700 }}>{fmtDia(f.fecha)} · {nombreSector(f.sector)} · {f.turno}</div>
          <div style={{ fontSize: '0.82rem', marginTop: 4 }}>
            Teóricos <b>{f.teoricos}</b> · ya con licencia <b>{f.conocidos.length}</b> · presentes esperados{' '}
            <b style={{ color: c.fg }}>{f.esperados}</b>
            {f.normal != null && <> · normal <b>{f.normal}</b></>}
            {f.minimo != null && <> · mínimo <b>{f.minimo}</b></>}
            {f.riesgo != null && <> · riesgo de no llegar al mínimo <b style={{ color: f.riesgo >= 0.5 ? '#f87171' : f.riesgo >= 0.2 ? '#fcd34d' : '#86efac' }}>{pct(f.riesgo)}</b></>}
          </div>
        </div>
        <button className="btn" type="button" onClick={onClose}>✕</button>
      </div>

      {f.conocidos.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#fca5a5', marginBottom: 4 }}>
            Ya se sabe que no vienen ({f.conocidos.length})
          </div>
          {f.conocidos.map(x => (
            <div key={x.dni} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '3px 8px', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ minWidth: 230, fontWeight: 600 }}>{nom(x.dni)}</span>
              <span className="muted" style={{ minWidth: 80 }}>{x.dni}</span>
              <span><b>{MOTIVO[x.motivo] ?? x.motivo}</b> <span className="muted">· {x.detalle} ({fmtFecha(x.desde)}{x.hasta !== x.desde ? ` → ${fmtFecha(x.hasta)}` : ''})</span></span>
            </div>
          ))}
        </div>
      )}

      {f.rotacion.length > 0 && (
        <div className="muted" style={{ marginTop: 10, fontSize: '0.78rem' }}>
          🔄 No les toca por su rotación (no cuentan como teóricos): {f.rotacion.map(nom).sort((a, b) => a.localeCompare(b, 'es')).join(' · ')}
        </div>
      )}

      {f.restantes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#86efac', marginBottom: 4 }}>
            Deberían venir ({f.restantes.length}) · probabilidad de que falten
          </div>
          {f.restantes.map(x => (
            <div key={x.dni} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '3px 8px', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ minWidth: 230, fontWeight: 600 }}>{nom(x.dni)}</span>
              <span className="muted" style={{ minWidth: 80 }}>{x.dni}</span>
              <span style={{ minWidth: 50, fontWeight: 700, color: x.p >= 0.25 ? '#f87171' : x.p >= 0.12 ? '#fcd34d' : '#86efac' }}>{pct(x.p)}</span>
              {x.historiaDias < 60 && <span className="muted" style={{ fontSize: '0.72rem' }}>poca historia ({x.historiaDias} días): se usa el promedio del servicio</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

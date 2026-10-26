// src/pages/EnfermeriaDistribucionPage/index.tsx
// "Distribución de enfermería" — se abre desde Mi Sector (pestaña nueva).
// Cantidad de enfermeros por sector y su distribución por turno / franja horaria (HORARIOS.xlsx).
// Admin elige Hospital (Sala 24 + Dpto 34) / UPA 18 (38) / UPA 4 (51); el jefe de enfermería ve solo la suya.
// Datos: GET /presentismo-sector/distribucion-enfermeria.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../api/http';

interface Dia { entrada: string; salida: string; horas: number; turno: string }
export interface Agente {
  dni: string; nombre: string; servicioId: number; servicio: string;
  sector: string; ocupacion: string; enHorarios: boolean;
  dias: Record<string, Dia | null>;
}
interface Resp {
  ok: boolean; error?: string;
  dep: string; nombre: string; esAdmin: boolean;
  dependencias: { key: string; nombre: string }[];
  servicios: { id: number; nombre: string }[];
  agentes: Agente[];
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DIAS_LABEL: Record<string, string> = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb', domingo: 'Dom' };
const TURNOS = ['Mañana', 'Tarde', 'Vespertino', 'Noche', '24 h'];
const COLOR_TURNO: Record<string, string> = { 'Mañana': '#fcd34d', 'Tarde': '#fdba74', 'Vespertino': '#c4b5fd', 'Noche': '#a5b4fc', '24 h': '#f9a8d4' };
const COLOR_SERV = ['#86efac', '#93c5fd'];
const SIN = '(SIN SECTOR)';
const nombreSector = (s: string) => (s === SIN ? 'Sin sector asignado' : s);
const ordenSector = (a: string, b: string) => (a === SIN ? 1 : b === SIN ? -1 : a.localeCompare(b, 'es'));

const thSt: React.CSSProperties = { padding: '5px 6px', textAlign: 'right', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap' };
const tdSt: React.CSSProperties = { padding: '4px 6px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' };
const clickSt: React.CSSProperties = { cursor: 'pointer' };

// Línea legible del horario semanal: "Lun–Vie 07:00–14:00 · Sáb 07:00–19:00"
function resumenHorario(a: Agente): string {
  if (!a.enHorarios) return 'No figura en HORARIOS.xlsx';
  const grupos: { dias: string[]; h: string }[] = [];
  for (const d of DIAS) {
    const t = a.dias[d];
    if (!t) continue;
    const h = `${t.entrada}–${t.salida}`;
    const last = grupos[grupos.length - 1];
    const prev = last ? DIAS.indexOf(last.dias[last.dias.length - 1]) : -2;
    if (last && last.h === h && prev === DIAS.indexOf(d) - 1) last.dias.push(d);
    else grupos.push({ dias: [d], h });
  }
  if (!grupos.length) return 'Sin días cargados';
  return grupos.map(g => `${DIAS_LABEL[g.dias[0]]}${g.dias.length > 1 ? `–${DIAS_LABEL[g.dias[g.dias.length - 1]]}` : ''} ${g.h}`).join(' · ');
}

// Página completa (con selector de dependencia para el admin)
export function EnfermeriaDistribucionPage() {
  return (
    <Layout title="Distribución de enfermería">
      <DistribucionEnfermeria />
    </Layout>
  );
}

// Contenido reutilizable: también se usa embebido en la tarjeta de enfermería de Mi Sector (una pestaña por dependencia).
//   dep: fija la dependencia (HOSPITAL|UPA18|UPA4); vacío = la del usuario, con selector si es admin.
//   embebido: sin encabezado ni selector. conSectores: muestra totales y cantidad por sector.
export function DistribucionEnfermeria({ dep: depFija = '', embebido = false, conSectores = true }:
  { dep?: string; embebido?: boolean; conSectores?: boolean }) {
  const [dep, setDep] = useState<string>(depFija);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (d: string, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (d) qs.set('dep', d);
      if (refresh) qs.set('refresh', '1');
      const res = await apiFetch<Resp>(`/presentismo-sector/distribucion-enfermeria?${qs.toString()}`);
      if (!res?.ok) throw new Error(res?.error || 'Error cargando la distribución');
      setData(res);
      setDep(res.dep);
    } catch (e: any) {
      setError(e?.message || 'Error cargando la distribución');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void cargar(depFija); }, [cargar, depFija]);

  const servicios = data?.servicios ?? [];
  return (
    <div>
      {embebido && loading && <div className="muted" style={{ fontSize: '0.8rem', padding: '8px 0' }}>🔄 Cargando…</div>}
      {!embebido && <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="h2" style={{ margin: 0 }}>🩺 Distribución de enfermería</div>
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
              {data ? `${data.nombre} · ${servicios.map(s => s.nombre).join(' + ')}` : '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {(data?.dependencias.length ?? 0) > 1 && data!.dependencias.map(d => (
              <button key={d.key} type="button" className="btn" disabled={loading}
                onClick={() => { if (d.key !== dep) void cargar(d.key); }}
                style={{ padding: '5px 14px', opacity: d.key === dep ? 1 : 0.55, border: d.key === dep ? '1px solid #86efac' : undefined }}>
                {d.nombre}
              </button>
            ))}
            <button type="button" className="btn" disabled={loading} onClick={() => cargar(dep, true)}>
              {loading ? 'Cargando…' : '🔄 Actualizar'}
            </button>
          </div>
        </div>
      </div>}

      {error && (
        <div className="card" style={{ marginTop: 12, padding: 14, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>{error}</div>
      )}

      {data && !loading && <TablasDistribucion agentes={data.agentes} servicios={servicios} nombre={data.nombre} conSectores={conSectores} />}
    </div>
  );
}

// Tablas de dotación: totales, cantidad por sector, sector × turno, franjas horarias y modal con los agentes.
// La usan la distribución de enfermería y la dotación por categoría de Mi Sector.
export function TablasDistribucion({ agentes, servicios, nombre, conSectores = true,
  etiquetaTotal = 'Total enfermería', tituloSectores = 'Enfermeros por sector' }:
  { agentes: Agente[]; servicios: { id: number; nombre: string }[]; nombre: string; conSectores?: boolean;
    etiquetaTotal?: string; tituloSectores?: string }) {
  const [dia, setDia] = useState<string>('semana');           // 'semana' | lunes..domingo
  const [modal, setModal] = useState<{ titulo: string; agentes: Agente[] } | null>(null);
  const multiServ = servicios.length > 1;
  const etiquetaServ = (id: number) => {
    const n = servicios.find(s => s.id === id)?.nombre ?? '';
    return /SALA/i.test(n) ? 'SALA' : /DPTO/i.test(n) ? 'DPTO' : n;
  };

  // Cantidad por sector × servicio
  const porSector = useMemo(() => {
    const m = new Map<string, Agente[]>();
    for (const a of agentes) {
      if (!m.has(a.sector)) m.set(a.sector, []);
      m.get(a.sector)!.push(a);
    }
    return [...m.entries()].sort(([a], [b]) => ordenSector(a, b));
  }, [agentes]);

  // Turno de un agente para el día elegido (en "semana": cuántos días hace cada turno)
  const turnosDe = useCallback((a: Agente): string[] => {
    if (dia !== 'semana') { const t = a.dias[dia]; return t ? [t.turno] : []; }
    return DIAS.map(d => a.dias[d]?.turno).filter(Boolean) as string[];
  }, [dia]);

  // Sector × turno
  const matriz = useMemo(() => {
    const m = new Map<string, Record<string, Agente[]>>();
    for (const a of agentes) {
      if (!m.has(a.sector)) m.set(a.sector, {});
      const row = m.get(a.sector)!;
      const ts = dia === 'semana' ? [...new Set(turnosDe(a))] : turnosDe(a);
      for (const t of ts) (row[t] ??= []).push(a);
    }
    return m;
  }, [agentes, dia, turnosDe]);

  // Franja horaria real (entrada–salida) para el día elegido o el más habitual de la semana
  const franjas = useMemo(() => {
    const m = new Map<string, { turno: string; horas: number; agentes: Agente[]; porSector: Map<string, number> }>();
    for (const a of agentes) {
      let t: Dia | null = null;
      if (dia !== 'semana') t = a.dias[dia];
      else {
        const c = new Map<string, { n: number; d: Dia }>();
        for (const d of DIAS) {
          const x = a.dias[d];
          if (!x) continue;
          const k = `${x.entrada}–${x.salida}`;
          c.set(k, { n: (c.get(k)?.n ?? 0) + 1, d: x });
        }
        t = [...c.values()].sort((x, y) => y.n - x.n)[0]?.d ?? null;
      }
      if (!t) continue;
      const k = `${t.entrada}–${t.salida}`;
      if (!m.has(k)) m.set(k, { turno: t.turno, horas: t.horas, agentes: [], porSector: new Map() });
      const f = m.get(k)!;
      f.agentes.push(a);
      f.porSector.set(a.sector, (f.porSector.get(a.sector) ?? 0) + 1);
    }
    return [...m.entries()].sort((x, y) =>
      TURNOS.indexOf(x[1].turno) - TURNOS.indexOf(y[1].turno) || x[0].localeCompare(y[0]));
  }, [agentes, dia]);

  const totalTurno = (t: string) => {
    const s = new Set<string>();
    for (const row of matriz.values()) for (const a of row[t] ?? []) s.add(a.dni);
    return s.size;
  };
  const sinHorario = agentes.filter(a => !a.enHorarios);
  const sinDia = dia !== 'semana' ? agentes.filter(a => a.enHorarios && !a.dias[dia]).length : 0;

  const abrir = (titulo: string, lista: Agente[]) =>
    lista.length && setModal({ titulo, agentes: [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) });

  return (
    <div>
      <>
          {conSectores && <>
          {/* Totales */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {multiServ && servicios.map((s, i) => (
              <div key={s.id} className="card" style={{ padding: '8px 14px', minWidth: 130, textAlign: 'center', ...clickSt }}
                onClick={() => abrir(s.nombre, agentes.filter(a => a.servicioId === s.id))}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: COLOR_SERV[i] }}>{agentes.filter(a => a.servicioId === s.id).length}</div>
                <div className="muted" style={{ fontSize: '0.72rem' }}>{s.nombre}</div>
              </div>
            ))}
            <div className="card" style={{ padding: '8px 14px', minWidth: 130, textAlign: 'center', ...clickSt }} onClick={() => abrir(`${nombre} · Total`, agentes)}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fbbf24' }}>{agentes.length}</div>
              <div className="muted" style={{ fontSize: '0.72rem' }}>{etiquetaTotal}</div>
            </div>
          </div>

          {/* Cantidad por sector */}
          <div className="card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{tituloSectores}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead><tr>
                  <th style={{ ...thSt, textAlign: 'left' }}>Sector</th>
                  {multiServ && servicios.map((s, i) => <th key={s.id} style={{ ...thSt, color: COLOR_SERV[i] }}>{etiquetaServ(s.id)}</th>)}
                  <th style={{ ...thSt, color: '#fbbf24' }}>Total</th>
                </tr></thead>
                <tbody>
                  {porSector.map(([sec, lista]) => (
                    <tr key={sec}>
                      <td style={{ ...tdSt, textAlign: 'left', color: sec === SIN ? '#f87171' : undefined, fontStyle: sec === SIN ? 'italic' : undefined }}>{nombreSector(sec)}</td>
                      {multiServ && servicios.map((s, i) => {
                        const l = lista.filter(a => a.servicioId === s.id);
                        return <td key={s.id} style={{ ...tdSt, ...clickSt, color: l.length ? COLOR_SERV[i] : 'rgba(255,255,255,0.2)' }}
                          onClick={() => abrir(`${nombreSector(sec)} · ${etiquetaServ(s.id)}`, l)}>{l.length}</td>;
                      })}
                      <td style={{ ...tdSt, ...clickSt, fontWeight: 700, color: '#fbbf24' }} onClick={() => abrir(nombreSector(sec), lista)}>{lista.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {porSector.length === 1 && porSector[0][0] === SIN && (
              <div className="muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>
                Este servicio todavía no tiene sectores asignados: se cargan desde Mi Sector (pase a sector).
              </div>
            )}
          </div>
          </>}

          {/* Distribución por turno */}
          <div className="card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>Distribución por turno</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {['semana', ...DIAS].map(d => (
                  <button key={d} type="button" className="btn" onClick={() => setDia(d)}
                    style={{ padding: '3px 10px', fontSize: '0.75rem', opacity: dia === d ? 1 : 0.55, border: dia === d ? '1px solid #86efac' : undefined }}>
                    {d === 'semana' ? 'Semana' : DIAS_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>
            <div className="muted" style={{ fontSize: '0.74rem', marginBottom: 8 }}>
              {dia === 'semana'
                ? 'Semana: cuántos agentes hacen ese turno algún día de la semana (uno puede contar en más de un turno).'
                : `Agentes con turno el ${DIAS_LABEL[dia]} según HORARIOS.xlsx${sinDia ? ` · ${sinDia} no trabajan ese día` : ''}.`}
              {' '}Mañana: entra 05–10:59 · Tarde: 11–17:59 · Noche: resto · 24 h: guardia de 24 h.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead><tr>
                  <th style={{ ...thSt, textAlign: 'left' }}>Sector</th>
                  {TURNOS.map(t => <th key={t} style={{ ...thSt, color: COLOR_TURNO[t] }}>{t}</th>)}
                </tr></thead>
                <tbody>
                  {[...matriz.keys()].sort(ordenSector).map(sec => {
                    const row = matriz.get(sec)!;
                    return (
                      <tr key={sec}>
                        <td style={{ ...tdSt, textAlign: 'left', color: sec === SIN ? '#f87171' : undefined }}>{nombreSector(sec)}</td>
                        {TURNOS.map(t => {
                          const l = row[t] ?? [];
                          return <td key={t} style={{ ...tdSt, ...clickSt, color: l.length ? COLOR_TURNO[t] : 'rgba(255,255,255,0.2)', fontWeight: l.length ? 600 : undefined }}
                            onClick={() => abrir(`${nombreSector(sec)} · ${t}${dia !== 'semana' ? ` · ${DIAS_LABEL[dia]}` : ''}`, l)}>{l.length || '·'}</td>;
                        })}
                      </tr>
                    );
                  })}
                  <tr style={{ background: 'rgba(147,197,253,0.08)' }}>
                    <td style={{ ...tdSt, textAlign: 'left', fontWeight: 700 }}>Total</td>
                    {TURNOS.map(t => <td key={t} style={{ ...tdSt, fontWeight: 700 }}>{totalTurno(t) || '·'}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Franjas horarias reales */}
          <div className="card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Por franja horaria</div>
            <div className="muted" style={{ fontSize: '0.74rem', marginBottom: 8 }}>
              {dia === 'semana' ? 'Horario más habitual de cada agente en la semana.' : `Horario del ${DIAS_LABEL[dia]}.`} Click en el número para ver quiénes son.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead><tr>
                  <th style={{ ...thSt, textAlign: 'left' }}>Horario</th>
                  <th style={{ ...thSt, textAlign: 'left' }}>Turno</th>
                  <th style={thSt}>Hs</th>
                  <th style={{ ...thSt, color: '#fbbf24' }}>Agentes</th>
                  <th style={{ ...thSt, textAlign: 'left' }}>Por sector</th>
                </tr></thead>
                <tbody>
                  {franjas.map(([h, f]) => (
                    <tr key={h}>
                      <td style={{ ...tdSt, textAlign: 'left', fontWeight: 600 }}>{h}</td>
                      <td style={{ ...tdSt, textAlign: 'left', color: COLOR_TURNO[f.turno] }}>{f.turno}</td>
                      <td style={tdSt} className="muted">{f.horas}</td>
                      <td style={{ ...tdSt, ...clickSt, fontWeight: 700, color: '#fbbf24' }} onClick={() => abrir(`Horario ${h}`, f.agentes)}>{f.agentes.length}</td>
                      <td style={{ ...tdSt, textAlign: 'left', whiteSpace: 'normal', fontSize: '0.75rem' }} className="muted">
                        {[...f.porSector.entries()].sort(([a], [b]) => ordenSector(a, b)).map(([s, n]) => `${nombreSector(s)} ${n}`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {sinHorario.length > 0 && (
            <div className="card" style={{ marginTop: 12, padding: 12, fontSize: '0.8rem', border: '1px solid rgba(251,191,36,0.35)' }}>
              ⚠️ {sinHorario.length} agente(s) no figuran en HORARIOS.xlsx y no entran en la distribución por horario:{' '}
              <span className="muted">{sinHorario.map(a => a.nombre).join(' · ')}</span>
            </div>
          )}
          <div className="muted" style={{ fontSize: '0.72rem', margin: '10px 2px 20px' }}>
            Padrón: agentes activos con pase abierto en el servicio y su sector vigente (igual que Mi Sector). Horarios: HORARIOS.xlsx.
          </div>
        </>

      {/* En portal: dentro de la tarjeta de Mi Sector el modal quedaba recortado y no se veía */}
      {modal && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setModal(null)}>
          <div style={{ background: '#1e2235', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 12, padding: '20px 24px', maxWidth: 820, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 12 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#a5b4fc' }}>{modal.titulo}</div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>{modal.agentes.length} agente{modal.agentes.length !== 1 ? 's' : ''} · click fuera para cerrar</div>
              </div>
              <button className="btn" type="button" onClick={() => setModal(null)}>✕</button>
            </div>
            <div style={{ overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead><tr>
                  <th style={{ ...thSt, textAlign: 'left' }}>Agente</th>
                  <th style={{ ...thSt, textAlign: 'left' }}>DNI</th>
                  <th style={{ ...thSt, textAlign: 'left' }}>Ocupación</th>
                  {multiServ && <th style={{ ...thSt, textAlign: 'left' }}>Servicio</th>}
                  <th style={{ ...thSt, textAlign: 'left' }}>Sector</th>
                  <th style={{ ...thSt, textAlign: 'left' }}>Horario</th>
                </tr></thead>
                <tbody>
                  {modal.agentes.map(a => (
                    <tr key={a.dni}>
                      <td style={{ ...tdSt, textAlign: 'left', fontWeight: 600 }}>{a.nombre}</td>
                      <td style={{ ...tdSt, textAlign: 'left' }} className="muted">{a.dni}</td>
                      <td style={{ ...tdSt, textAlign: 'left', whiteSpace: 'normal' }}>{a.ocupacion}</td>
                      {multiServ && <td style={{ ...tdSt, textAlign: 'left' }}>{etiquetaServ(a.servicioId)}</td>}
                      <td style={{ ...tdSt, textAlign: 'left' }}>{nombreSector(a.sector)}</td>
                      <td style={{ ...tdSt, textAlign: 'left', whiteSpace: 'normal', color: a.enHorarios ? undefined : '#fbbf24' }}>{resumenHorario(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

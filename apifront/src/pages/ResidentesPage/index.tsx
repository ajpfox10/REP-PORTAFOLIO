// src/pages/ResidentesPage/index.tsx
// Página SOLO residentes: buscador de Gestión + fichaje/horarios + novedades
// (licencias del Ministerio) + expedientes, todo por agente y por mes.
//
// Datos:
//  - Perfil:      GET /personal/:dni            (via useAgenteSearch)
//  - Fichaje/hor/novedades: GET /asistencia/agente-mes?dni=&periodo=YYYY-MM
//  - Expedientes: GET /expedientes?dni=
//
// Residente = ley_id 11 ("RESIDENTES") o ocupacion_id 132 ("RESIDENTE").
// Activo    = estado_empleo === 'ACTIVO'.
import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';

import { useAgenteSearch } from '../Gesytionpage/hooks/useAgenteSearch';
import { useDebounce } from '../Gesytionpage/hooks/useDebounce';
import { AgenteSearchForm } from '../Gesytionpage/components/components/AgenteSearchForm';
import { MatchesList } from '../Gesytionpage/components/components/MatchesList';

// ─── Identificación de residente ──────────────────────────────────────────────
const LEY_RESIDENTES = 11;
const OCUPACION_RESIDENTE = 132;

function esResidente(row: any): boolean {
  if (!row) return false;
  if (Number(row.ley_id) === LEY_RESIDENTES) return true;
  if (Number(row.ocupacion_id) === OCUPACION_RESIDENTE) return true;
  const ley = String(row.ley_nombre || '').toUpperCase();
  const ocu = String(row.ocupacion_nombre || '').toUpperCase();
  return ley.includes('RESIDENTE') || ocu.includes('RESIDENTE');
}

function esActivo(row: any): boolean {
  return String(row?.estado_empleo || '').toUpperCase() === 'ACTIVO';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtFecha(f?: string | null) {
  if (!f) return '—';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f);
}

interface DiaRow {
  fecha: string;
  diaSemana: string;
  novedadesSiap: { novedad: string; justificado: string }[];
  novedadesMin: string[];
  esAusente: boolean;
  tieneFichaje: boolean;
  entrada: string | null;
  salida: string | null;
  horarioEntrada: string | null;
}

interface Expediente {
  id: number;
  numero: string | null;
  caratula: string | null;
  fecha: string | null;
  estado: string | null;
}

type ResidentesResumen = {
  totals: {
    residentes: number;
    servicios: number;
    rotacionesActivas: number;
    rotacionesPasadas: number;
    licenciasConDias: number;
    diasLicencia: number;
    sinEmail: number;
    sinTelefono: number;
  };
  porServicio: Array<{ servicio_id: number | null; servicio_nombre: string; total: number }>;
  rotacionesActivas: any[];
  rotacionesPasadas: any[];
  licencias: Array<{ dni: number; apellido_nombre: string; total_dias: number; tipos: string[] }>;
  contacto: {
    sinEmail: Array<{ dni: number; apellido: string; nombre: string; servicio_nombre: string | null }>;
    sinTelefono: Array<{ dni: number; apellido: string; nombre: string; servicio_nombre: string | null }>;
  };
  sources: { licencias: string | null; licenciasError: string | null };
};

function personaLabel(row: any) {
  return [row?.apellido, row?.nombre].filter(Boolean).join(', ') || row?.apellido_nombre || `DNI ${row?.dni || ''}`;
}

// ─── Página ───────────────────────────────────────────────────────────────────
export function ResidentesPage() {
  const agenteSearch = useAgenteSearch();
  const debouncedDni = useDebounce(agenteSearch.dni, 500);
  const row = agenteSearch.row;

  const [periodo, setPeriodo] = useState<string>(mesActual());

  const [dias, setDias]         = useState<DiaRow[]>([]);
  const [diasLoading, setDiasL] = useState(false);
  const [diasError, setDiasErr] = useState<string | null>(null);
  const [dbError, setDbError]   = useState<string | null>(null);

  const [expedientes, setExpedientes] = useState<Expediente[]>([]);
  const [expLoading, setExpL]         = useState(false);
  const [resumen, setResumen] = useState<ResidentesResumen | null>(null);
  const [resumenLoading, setResumenLoading] = useState(false);
  const [resumenError, setResumenError] = useState<string | null>(null);

  // Auto-buscar al tipear DNI (igual que Gestión)
  useEffect(() => {
    const d = String(debouncedDni || '');
    if (d && d.replace(/\D/g, '').length >= 7) agenteSearch.onSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDni]);

  useEffect(() => {
    setResumenLoading(true);
    setResumenError(null);
    apiFetch<{ ok: boolean; data: ResidentesResumen }>('/residentes/resumen')
      .then(r => setResumen(r.data || null))
      .catch((e: any) => setResumenError(e?.message || 'No se pudo cargar resumen'))
      .finally(() => setResumenLoading(false));
  }, []);

  const dni = agenteSearch.cleanDni;
  const residente = esResidente(row);
  const activo = esActivo(row);

  // Cargar fichaje/horarios/novedades del mes
  const cargarMes = useCallback(async () => {
    if (!dni || !residente) { setDias([]); return; }
    setDiasL(true); setDiasErr(null); setDbError(null);
    try {
      const params = new URLSearchParams({ dni, periodo });
      const r = await apiFetch<any>(`/asistencia/agente-mes?${params}`);
      if (!r?.ok) throw new Error(r?.error || 'Error al cargar asistencia');
      setDias(Array.isArray(r.data) ? r.data : []);
      setDbError(r.dbError || null);
    } catch (e: any) {
      setDias([]);
      setDiasErr(e?.message || 'Error al cargar');
    } finally {
      setDiasL(false);
    }
  }, [dni, residente, periodo]);

  useEffect(() => { cargarMes(); }, [cargarMes]);

  // Cargar expedientes
  useEffect(() => {
    if (!dni || !residente) { setExpedientes([]); return; }
    setExpL(true);
    apiFetch<any>(`/expedientes?dni=${dni}&limit=200&sort=-fecha`)
      .then(r => setExpedientes(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setExpedientes([]))
      .finally(() => setExpL(false));
  }, [dni, residente]);

  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', fontSize: '0.72rem', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 10px', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.04)' };

  return (
    <Layout title="Residentes" showBack>
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>

        {/* ── IZQUIERDA: buscador ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: '10px 14px' }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 2 }}>🩺 Residentes</div>
            <div className="muted" style={{ fontSize: '0.76rem' }}>
              Buscá un residente por DNI o apellido. Solo agentes con ley/ocupación RESIDENTE.
            </div>
          </div>

          <AgenteSearchForm
            dni={agenteSearch.dni}
            fullName={agenteSearch.fullName}
            loading={agenteSearch.loading}
            onDniChange={e => agenteSearch.setDni(String(e.target.value))}
            onFullNameChange={e => agenteSearch.setFullName(e.target.value)}
            onSearch={() => agenteSearch.onSearch()}
            onSearchByName={agenteSearch.onSearchByName}
          />

          {agenteSearch.loading && <div className="card" style={{ padding: 14 }}>🔄 Cargando…</div>}

          {agenteSearch.matches.length > 0 && (
            <MatchesList matches={agenteSearch.matches} onSelect={agenteSearch.loadByDni} />
          )}
        </div>

        {/* ── DERECHA: datos ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem' }}>Resumen de residentes</div>
                <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                  Servicios, rotaciones, licencias y datos de contacto cargados.
                </div>
              </div>
              <button className="btn" type="button" onClick={() => {
                setResumenLoading(true);
                setResumenError(null);
                apiFetch<{ ok: boolean; data: ResidentesResumen }>('/residentes/resumen')
                  .then(r => setResumen(r.data || null))
                  .catch((e: any) => setResumenError(e?.message || 'No se pudo cargar resumen'))
                  .finally(() => setResumenLoading(false));
              }} disabled={resumenLoading}>
                {resumenLoading ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>

            {resumenError ? (
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: '0.84rem' }}>
                {resumenError}
              </div>
            ) : resumenLoading && !resumen ? (
              <div className="muted" style={{ padding: 18, textAlign: 'center' }}>Cargando resumen...</div>
            ) : resumen ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
                  {[
                    ['Residentes activos', resumen.totals.residentes, '#22c55e'],
                    ['Servicios', resumen.totals.servicios, '#38bdf8'],
                    ['Rotaciones activas', resumen.totals.rotacionesActivas, '#a78bfa'],
                    ['Rotaciones pasadas', resumen.totals.rotacionesPasadas, '#f59e0b'],
                    ['Con dias licencia', resumen.totals.licenciasConDias, '#14b8a6'],
                    ['Dias licencia', resumen.totals.diasLicencia, '#2dd4bf'],
                    ['Sin email', resumen.totals.sinEmail, '#f97316'],
                    ['Sin telefono', resumen.totals.sinTelefono, '#fb7185'],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: String(color) }}>{value}</div>
                      <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 10 }}>
                  <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 10px', fontWeight: 700, fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      Residentes por servicio
                    </div>
                    <div style={{ maxHeight: 210, overflowY: 'auto' }}>
                      {resumen.porServicio.slice(0, 12).map(s => (
                        <div key={`${s.servicio_id}-${s.servicio_nombre}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.8rem' }}>
                          <span>{s.servicio_nombre || 'Sin servicio'}</span>
                          <strong style={{ color: '#86efac' }}>{s.total}</strong>
                        </div>
                      ))}
                      {!resumen.porServicio.length && <div className="muted" style={{ padding: 10, fontSize: '0.8rem' }}>Sin servicios para mostrar.</div>}
                    </div>
                  </div>

                  <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 10px', fontWeight: 700, fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      Licencias pendientes
                    </div>
                    <div style={{ maxHeight: 210, overflowY: 'auto' }}>
                      {resumen.licencias.map(l => (
                        <div key={l.dni} style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <strong>{l.apellido_nombre || `DNI ${l.dni}`}</strong>
                            <span style={{ color: '#2dd4bf', fontWeight: 700 }}>{l.total_dias} d</span>
                          </div>
                          <div className="muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>DNI {l.dni} - {l.tipos.slice(0, 2).join(', ')}</div>
                        </div>
                      ))}
                      {!resumen.licencias.length && <div className="muted" style={{ padding: 10, fontSize: '0.8rem' }}>{resumen.sources.licenciasError || 'Sin dias pendientes para residentes.'}</div>}
                    </div>
                  </div>

                  <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 10px', fontWeight: 700, fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      Rotaciones activas
                    </div>
                    <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                      {resumen.rotacionesActivas.map(r => (
                        <div key={r.id} style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
                          <strong>{personaLabel(r)}</strong>
                          <div className="muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                            {r.servicio || 'Sin servicio'} - desde {fmtFecha(r.fecha_desde)}{r.fecha_hasta ? ` hasta ${fmtFecha(r.fecha_hasta)}` : ' - en curso'}
                          </div>
                        </div>
                      ))}
                      {!resumen.rotacionesActivas.length && <div className="muted" style={{ padding: 10, fontSize: '0.8rem' }}>Sin rotaciones activas.</div>}
                    </div>
                  </div>

                  <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 10px', fontWeight: 700, fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      Rotaciones pasadas
                    </div>
                    <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                      {resumen.rotacionesPasadas.map(r => (
                        <div key={r.id} style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
                          <strong>{personaLabel(r)}</strong>
                          <div className="muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                            {r.servicio || 'Sin servicio'} - {fmtFecha(r.fecha_desde)} a {fmtFecha(r.fecha_hasta)}
                          </div>
                        </div>
                      ))}
                      {!resumen.rotacionesPasadas.length && <div className="muted" style={{ padding: 10, fontSize: '0.8rem' }}>Sin rotaciones pasadas.</div>}
                    </div>
                  </div>
                </div>

                {(resumen.contacto.sinEmail.length || resumen.contacto.sinTelefono.length) ? (
                  <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#facc15', fontSize: '0.78rem' }}>
                    Datos incompletos: revisar {resumen.totals.sinEmail} sin email y {resumen.totals.sinTelefono} sin telefono.
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {!row && (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
              Buscá un residente para ver su fichaje, licencias y expedientes.
            </div>
          )}

          {/* No es residente → bloqueo con aviso */}
          {row && !residente && (
            <div className="card" style={{ padding: 18, borderLeft: '3px solid #ef4444' }}>
              <div style={{ fontWeight: 700, color: '#fca5a5', marginBottom: 4 }}>⛔ No es residente</div>
              <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                <b>{row.apellido}, {row.nombre}</b> (DNI {row.dni}) no figura como residente
                (ley: {row.ley_nombre || '—'} · ocupación: {row.ocupacion_nombre || '—'}).
                Esta página es solo para residentes.
              </div>
            </div>
          )}

          {row && residente && (
            <>
              {/* Cabecera del agente */}
              <div className="card" style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>{row.apellido}, {row.nombre}</div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 2 }}>
                      DNI {row.dni}{row.legajo ? ` · Leg. ${row.legajo}` : ''} · {row.ley_nombre || '—'} · {row.ocupacion_nombre || '—'}
                    </div>
                    {row.servicio_nombre && (
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>🏥 {row.servicio_nombre}</div>
                    )}
                    <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: 4 }}>
                      Email: {row.email || 'sin cargar'} - Telefono: {row.telefono || 'sin cargar'}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                    background: activo ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.18)',
                    color: activo ? '#86efac' : '#fca5a5',
                    border: `1px solid ${activo ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.35)'}`,
                  }}>
                    {activo ? '● ACTIVO' : `● NO ACTIVO (${row.estado_empleo || 's/estado'})`}
                  </span>
                </div>

                {/* Aviso destacado si NO está activo */}
                {!activo && (
                  <div style={{
                    marginTop: 10, padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                    color: '#fca5a5', fontSize: '0.8rem', fontWeight: 600,
                  }}>
                    ⚠️ Atención: este residente NO está activo (estado: {row.estado_empleo || 's/estado'}).
                  </div>
                )}
              </div>

              {/* Selector de período + Fichaje */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>📅 Fichaje, horarios y licencias — por día</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="month" className="input" style={{ fontSize: '0.8rem', width: 150 }}
                      value={periodo} onChange={e => setPeriodo(e.target.value)} max={mesActual()} />
                    <button className="btn" type="button" onClick={cargarMes} disabled={diasLoading}>
                      {diasLoading ? '…' : '↻'}
                    </button>
                  </div>
                </div>

                {dbError && (
                  <div style={{ padding: '6px 14px', fontSize: '0.74rem', color: '#fbbf24', background: 'rgba(251,191,36,0.06)' }}>
                    ⚠️ Fichaje biométrico: {dbError}
                  </div>
                )}

                {diasLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>🔄 Cargando mes…</div>
                ) : diasError ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#fca5a5' }}>{diasError}</div>
                ) : dias.length === 0 ? (
                  <div className="muted" style={{ padding: 20, textAlign: 'center' }}>Sin datos para el período.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Fecha</th><th style={th}>Día</th>
                          <th style={th}>Horario</th><th style={th}>Entrada</th><th style={th}>Salida</th>
                          <th style={th}>Licencias / novedades</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dias.map(d => {
                          const finde = d.diaSemana === 'Sáb' || d.diaSemana === 'Dom';
                          return (
                            <tr key={d.fecha} style={{ background: d.esAusente ? 'rgba(239,68,68,0.06)' : finde ? 'rgba(255,255,255,0.015)' : undefined }}>
                              <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtFecha(d.fecha)}</td>
                              <td style={{ ...td, color: finde ? '#64748b' : '#cbd5e1' }}>{d.diaSemana}</td>
                              <td style={{ ...td, color: '#94a3b8' }}>{d.horarioEntrada || '—'}</td>
                              <td style={{ ...td, fontFamily: 'monospace', color: d.entrada ? '#86efac' : '#475569' }}>{d.entrada || '—'}</td>
                              <td style={{ ...td, fontFamily: 'monospace', color: d.salida ? '#93c5fd' : '#475569' }}>{d.salida || '—'}</td>
                              <td style={td}>
                                {d.novedadesMin.length === 0 && d.novedadesSiap.length === 0 ? (
                                  <span style={{ color: '#475569' }}>—</span>
                                ) : (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {d.novedadesMin.map((n, i) => (
                                      <span key={`m${i}`} style={{ fontSize: '0.68rem', padding: '1px 7px', borderRadius: 5, background: 'rgba(124,58,237,0.18)', color: '#c4b5fd', fontWeight: 600 }}>{n}</span>
                                    ))}
                                    {d.novedadesSiap.map((n, i) => (
                                      <span key={`s${i}`} style={{ fontSize: '0.68rem', padding: '1px 7px', borderRadius: 5, background: 'rgba(59,130,246,0.15)', color: '#93c5fd' }} title={n.justificado ? `Justificado: ${n.justificado}` : undefined}>{n.novedad}</span>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Expedientes */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  📁 Expedientes {expedientes.length > 0 && <span style={{ color: '#94a3b8', fontWeight: 400 }}>({expedientes.length})</span>}
                </div>
                {expLoading ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>🔄 Cargando…</div>
                ) : expedientes.length === 0 ? (
                  <div className="muted" style={{ padding: 16, textAlign: 'center', fontSize: '0.82rem' }}>Sin expedientes registrados.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Número</th><th style={th}>Carátula</th>
                          <th style={th}>Fecha</th><th style={th}>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expedientes.map(e => (
                          <tr key={e.id}>
                            <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{e.numero || '—'}</td>
                            <td style={td}>{e.caratula || '—'}</td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtFecha(e.fecha)}</td>
                            <td style={td}>
                              {e.estado
                                ? <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5, background: 'rgba(124,58,237,0.2)', color: '#c4b5fd', fontWeight: 600 }}>{e.estado}</span>
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

export default ResidentesPage;

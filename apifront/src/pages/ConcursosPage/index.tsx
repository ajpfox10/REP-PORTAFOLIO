// src/pages/ConcursosPage/index.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Layout }         from '../../components/Layout';
import { apiFetch }       from '../../api/http';
import { exportToExcel }  from '../../utils/export';
import { useToast }       from '../../ui/toast';
import { useAgenteSearch } from '../Gesytionpage/hooks/useAgenteSearch';
import { AgenteSearchForm } from '../Gesytionpage/components/components/AgenteSearchForm';
import { MatchesList } from '../Gesytionpage/components/components/MatchesList';
import { ConcursosFuncionesExamenes } from './ConcursosFuncionesExamenes';

interface IngresoPersonalRow {
  dni: number;
  apellido: string;
  nombre: string;
  legajo: number | null;
  fecha_ingreso: string | null;
  anio_ingreso: number | null;
  ley_id: number | null;
  ley_nombre: string | null;
  ocupacion_id: number | null;
  ocupacion_nombre: string | null;
  servicio_id: number | null;
  servicio_nombre: string | null;
  sector_nombre: string | null;
  estado_empleo: string | null;
  antiguedad_anios?: number | null;
  antiguedad_meses?: number | null;
  fecha_planta?: string | null;
  planta_anios?: number | null;
}

type CargoListado = 'sala' | 'servicio' | 'jurado';

const fmtFecha = (v: string | null | undefined): string => {
  if (!v) return '—';
  const [y, m, d] = String(v).split('T')[0].split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

const S: Record<string, React.CSSProperties> = {
  card:   { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 20, marginBottom: 16 },
  label:  { fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 4, display: 'block' },
  input:  { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.85rem' },
  select: { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.85rem' },
  btn:    { cursor: 'pointer', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: '0.84rem', border: 'none' },
  h3:     { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 12, color: '#94a3b8' },
  chkRow: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 6 },
  chk:    { width: 17, height: 17, cursor: 'pointer', flexShrink: 0 },
};

function uniqueOptions(rows: IngresoPersonalRow[], idKey: keyof IngresoPersonalRow, labelKey: keyof IngresoPersonalRow) {
  const map = new Map<string, string>();
  for (const r of rows) {
    const id = r[idKey];
    const label = r[labelKey];
    if (id !== null && id !== undefined && label) map.set(String(id), String(label));
  }
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
}

export function ConcursosPage() {
  const toast = useToast();
  const search = useAgenteSearch();
  const [tab, setTab] = useState<'concurso' | 'funciones'>('concurso');
  const [servicioId, setServicioId] = useState('');
  const [ocupacionId, setOcupacionId] = useState('');
  const [funcionServicioId, setFuncionServicioId] = useState('');
  const [funcionOcupacionId, setFuncionOcupacionId] = useState('');
  const [cargoListado, setCargoListado] = useState<CargoListado>('sala');
  const [soloActivos, setSoloActivos] = useState(true);
  const [rows, setRows] = useState<IngresoPersonalRow[]>([]);
  const [funcionRows, setFuncionRows] = useState<IngresoPersonalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingFunciones, setLoadingFunciones] = useState(false);
  const [dniFiltro, setDniFiltro] = useState('');

  useEffect(() => {
    if (search.cleanDni) setDniFiltro(search.cleanDni);
  }, [search.cleanDni]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (servicioId) qs.set('servicio_id', servicioId);
      if (ocupacionId) qs.set('ocupacion_id', ocupacionId);
      if (dniFiltro) qs.set('dni', dniFiltro);
      const res = await apiFetch<any>(`/herramientas/ingresos?${qs.toString()}`);
      setRows(Array.isArray(res?.data) ? res.data : []);
    } catch (e: any) {
      toast.error('Error cargando ingresos', e?.message || 'Error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [servicioId, ocupacionId, dniFiltro, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const cargarFunciones = useCallback(async () => {
    setLoadingFunciones(true);
    try {
      const qs = new URLSearchParams();
      qs.set('cargo', cargoListado);
      if (funcionServicioId) qs.set('servicio_id', funcionServicioId);
      if (funcionOcupacionId) qs.set('ocupacion_id', funcionOcupacionId);
      if (dniFiltro) qs.set('dni', dniFiltro);
      qs.set('solo_activos', soloActivos ? '1' : '0');
      const res = await apiFetch<any>(`/herramientas/concurso-funciones?${qs.toString()}`);
      setFuncionRows(Array.isArray(res?.data) ? res.data : []);
    } catch (e: any) {
      toast.error('Error cargando concurso de funciones', e?.message || 'Error');
      setFuncionRows([]);
    } finally {
      setLoadingFunciones(false);
    }
  }, [cargoListado, funcionServicioId, funcionOcupacionId, dniFiltro, soloActivos, toast]);

  useEffect(() => { cargarFunciones(); }, [cargarFunciones]);

  const servicios = useMemo(() => uniqueOptions(rows, 'servicio_id', 'servicio_nombre'), [rows]);
  const ocupaciones = useMemo(() => uniqueOptions(rows, 'ocupacion_id', 'ocupacion_nombre'), [rows]);
  const funcionServicios = useMemo(() => uniqueOptions(funcionRows, 'servicio_id', 'servicio_nombre'), [funcionRows]);
  const funcionOcupaciones = useMemo(() => uniqueOptions(funcionRows, 'ocupacion_id', 'ocupacion_nombre'), [funcionRows]);

  const exportRows = rows.map(r => ({
    'Fecha de ingreso': fmtFecha(r.fecha_ingreso),
    'Año': r.anio_ingreso ?? '',
    'Apellido': r.apellido ?? '',
    'Nombre': r.nombre ?? '',
    'DNI': r.dni ?? '',
    'Legajo': r.legajo ?? '',
    'Ocupación': r.ocupacion_nombre ?? '',
    'Servicio': r.servicio_nombre ?? '',
    'Sector': r.sector_nombre ?? '',
    'Ley': r.ley_nombre ?? '',
    'Estado': r.estado_empleo ?? '',
  }));

  const exportar = () => {
    if (!exportRows.length) return toast.error('Sin datos para exportar');
    exportToExcel('concurso_ingreso_interinos_ley_10471', exportRows);
  };

  const exportarFunciones = () => {
    const data = funcionRows.map(r => ({
      'Fecha de ingreso': fmtFecha(r.fecha_ingreso),
      'Antigüedad': `${r.antiguedad_anios ?? ''} años`,
      'Pase a planta': fmtFecha(r.fecha_planta),
      'Apellido': r.apellido ?? '',
      'Nombre': r.nombre ?? '',
      'DNI': r.dni ?? '',
      'Legajo': r.legajo ?? '',
      'Ocupación': r.ocupacion_nombre ?? '',
      'Servicio': r.servicio_nombre ?? '',
      'Sector': r.sector_nombre ?? '',
      'Ley': r.ley_nombre ?? '',
      'Estado': r.estado_empleo ?? '',
    }));
    if (!data.length) return toast.error('Sin datos para exportar');
    exportToExcel(`concurso_funciones_ley_10471_${cargoListado}`, data);
  };

  const limpiarAgente = () => {
    setDniFiltro('');
    search.setDni('');
    search.setFullName('');
  };

  return (
    <Layout title="Concursos Ley 10471">
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <button type="button" className={`btn${tab === 'concurso' ? ' active' : ''}`} onClick={() => setTab('concurso')}>
            Concurso de ingreso
          </button>
          <button type="button" className={`btn${tab === 'funciones' ? ' active' : ''}`} onClick={() => setTab('funciones')}>
            Concurso de funciones
          </button>
        </div>

        {tab === 'concurso' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 4 }}>Concurso de ingreso</h1>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
                Agentes activos interinos de la Ley 10471, sin restricción por año de ingreso.
              </p>
            </div>

            <ConcursosFuncionesExamenes tipo="ingreso" />

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) 1fr', gap: 16, alignItems: 'start' }}>
              <div>
                <AgenteSearchForm
                  dni={search.dni}
                  fullName={search.fullName}
                  loading={search.loading}
                  onDniChange={e => search.setDni(e.target.value)}
                  onFullNameChange={e => search.setFullName(e.target.value)}
                  onSearch={() => search.onSearch()}
                  onSearchByName={search.onSearchByName}
                />
                <MatchesList matches={search.matches} onSelect={dni => search.loadByDni(dni)} />
                {dniFiltro && (
                  <div className="card gp-card-14">
                    <div style={{ fontWeight: 700 }}>{search.row?.apellido}, {search.row?.nombre}</div>
                    <div className="muted" style={{ fontSize: '0.78rem', marginTop: 3 }}>DNI {dniFiltro}</div>
                    <button className="btn" type="button" style={{ marginTop: 10, fontSize: '0.78rem' }} onClick={limpiarAgente}>
                      Limpiar agente
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div style={S.card}>
                  <div style={S.h3}>Filtros</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))', gap: 12 }}>
                    <div>
                      <label style={S.label} htmlFor="ci-servicio">Servicio</label>
                      <select id="ci-servicio" style={S.select} value={servicioId} onChange={e => setServicioId(e.target.value)}>
                        <option value="">Todos</option>
                        {servicios.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={S.label} htmlFor="ci-ocupacion">Ocupación</label>
                      <select id="ci-ocupacion" style={S.select} value={ocupacionId} onChange={e => setOcupacionId(e.target.value)}>
                        <option value="">Todas</option>
                        {ocupaciones.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    </div>
                    <div style={{ alignSelf: 'end', padding: '8px 10px', borderRadius: 8, background: 'rgba(16,185,129,0.10)', color: '#6ee7b7', fontSize: '0.78rem' }}>
                      Solo activos · interinos · Ley 10471
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                    <button className="btn" type="button" onClick={cargar} disabled={loading}>
                      {loading ? 'Cargando...' : 'Actualizar'}
                    </button>
                    <button className="btn" type="button" onClick={exportar} disabled={loading || !rows.length}>
                      Exportar Excel
                    </button>
                    <span className="muted" style={{ alignSelf: 'center', fontSize: '0.78rem' }}>
                      {rows.length} registro{rows.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                <div style={S.card}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                          {['Fecha de ingreso', 'Apellido', 'Nombre', 'Legajo', 'Ocupación', 'Servicio', 'Ley'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#94a3b8', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={`${r.dni}-${r.fecha_ingreso}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtFecha(r.fecha_ingreso)}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 700 }}>{r.apellido}</td>
                            <td style={{ padding: '8px 10px' }}>{r.nombre}</td>
                            <td style={{ padding: '8px 10px' }}>{r.legajo ?? '—'}</td>
                            <td style={{ padding: '8px 10px' }}>{r.ocupacion_nombre ?? '—'}</td>
                            <td style={{ padding: '8px 10px' }}>{r.servicio_nombre ?? '—'}</td>
                            <td style={{ padding: '8px 10px' }}>{r.ley_nombre ?? '—'}</td>
                          </tr>
                        ))}
                        {!rows.length && (
                          <tr><td colSpan={7} style={{ padding: 22, textAlign: 'center', color: '#64748b' }}>
                            {loading ? 'Cargando...' : 'Sin ingresos para los filtros seleccionados.'}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'funciones' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 4 }}>Concurso de funciones</h1>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
                Titulares (planta permanente) de Ley 10471, Planta o Guardia. Para inscribirse: +1 año desde el pase a planta (Jefatura de Sala) o +2 años (Jefatura de Servicio). Para ser jurado: +15 años de antigüedad.
              </p>
            </div>

            <ConcursosFuncionesExamenes tipo="funciones" />

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) 1fr', gap: 16, alignItems: 'start' }}>
              <div>
                <AgenteSearchForm
                  dni={search.dni}
                  fullName={search.fullName}
                  loading={search.loading}
                  onDniChange={e => search.setDni(e.target.value)}
                  onFullNameChange={e => search.setFullName(e.target.value)}
                  onSearch={() => search.onSearch()}
                  onSearchByName={search.onSearchByName}
                />
                <MatchesList matches={search.matches} onSelect={dni => search.loadByDni(dni)} />
                {dniFiltro && (
                  <div className="card gp-card-14">
                    <div style={{ fontWeight: 700 }}>{search.row?.apellido}, {search.row?.nombre}</div>
                    <div className="muted" style={{ fontSize: '0.78rem', marginTop: 3 }}>DNI {dniFiltro}</div>
                    <button className="btn" type="button" style={{ marginTop: 10, fontSize: '0.78rem' }} onClick={limpiarAgente}>
                      Limpiar agente
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div style={S.card}>
                  <div style={S.h3}>Filtros</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))', gap: 12 }}>
                    <div>
                      <label style={S.label} htmlFor="cf-cargo">Listado para</label>
                      <select id="cf-cargo" style={S.select} value={cargoListado} onChange={e => setCargoListado(e.target.value as CargoListado)}>
                        <option value="sala">Inscripción — Jef. de Sala (+1 año de planta)</option>
                        <option value="servicio">Inscripción — Jef. de Servicio (+2 años de planta)</option>
                        <option value="jurado">Jurados (+15 años de antigüedad)</option>
                      </select>
                    </div>
                    <div>
                      <label style={S.label} htmlFor="cf-servicio">Servicio</label>
                      <select id="cf-servicio" style={S.select} value={funcionServicioId} onChange={e => setFuncionServicioId(e.target.value)}>
                        <option value="">Todos</option>
                        {funcionServicios.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={S.label} htmlFor="cf-ocupacion">Ocupación</label>
                      <select id="cf-ocupacion" style={S.select} value={funcionOcupacionId} onChange={e => setFuncionOcupacionId(e.target.value)}>
                        <option value="">Todas</option>
                        {funcionOcupaciones.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    </div>
                    <label style={{ ...S.chkRow, marginTop: 22 }}>
                      <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} style={S.chk} />
                      <span style={{ fontSize: '0.84rem' }}>Solo activos</span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                    <button className="btn" type="button" onClick={cargarFunciones} disabled={loadingFunciones}>
                      {loadingFunciones ? 'Cargando...' : 'Actualizar'}
                    </button>
                    <button className="btn" type="button" onClick={exportarFunciones} disabled={loadingFunciones || !funcionRows.length}>
                      Exportar Excel
                    </button>
                    <span className="muted" style={{ alignSelf: 'center', fontSize: '0.78rem' }}>
                      {funcionRows.length} agente{funcionRows.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                <div style={S.card}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                          {['Fecha de ingreso', 'Antigüedad', 'Pase a planta', 'Apellido', 'Nombre', 'Legajo', 'Ocupación', 'Servicio'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#94a3b8', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {funcionRows.map(r => (
                          <tr key={`${r.dni}-${r.fecha_ingreso}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtFecha(r.fecha_ingreso)}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 700 }}>{r.antiguedad_anios ?? '—'} años</td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmtFecha(r.fecha_planta)}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 700 }}>{r.apellido}</td>
                            <td style={{ padding: '8px 10px' }}>{r.nombre}</td>
                            <td style={{ padding: '8px 10px' }}>{r.legajo ?? '—'}</td>
                            <td style={{ padding: '8px 10px' }}>{r.ocupacion_nombre ?? '—'}</td>
                            <td style={{ padding: '8px 10px' }}>{r.servicio_nombre ?? '—'}</td>
                          </tr>
                        ))}
                        {!funcionRows.length && (
                          <tr><td colSpan={8} style={{ padding: 22, textAlign: 'center', color: '#64748b' }}>
                            {loadingFunciones ? 'Cargando...' : 'Sin agentes para los filtros seleccionados.'}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

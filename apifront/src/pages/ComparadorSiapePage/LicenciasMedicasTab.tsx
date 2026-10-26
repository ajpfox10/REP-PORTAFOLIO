// Pestaña "Licencias médicas" del Comparador: cada licencia médica del SIAPE
// (LICENCIAS_MEDICAS.xlsx, solo agentes propios) contra cómo se cargó en el Ministerio
// (ministerio_novedades_anual) y cómo debería cargarse según el mapeo (regla por CIE o general).
// Solo lectura: sirve para detectar errores de carga.
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';

type Estado = 'OK' | 'DISTINTO' | 'NO_CARGADA' | 'SIN_CIE';

interface Fila {
  dni: string;
  nombre: string;
  legajo: string;
  novedad_siape: string;
  resolucion: string;
  desde: string;
  hasta: string;
  dias: number | null;
  cie: string;
  cie_relleno: boolean;
  diagnostico_siape: string;
  diagnostico_cie: string | null;
  esperado: string;
  esperado_codigo: string;
  por_cie: boolean;
  cargado_codigos: string[];
  cargado: string[];
  dependencia: string;
  robot_estado: string | null;
  robot_detalle: string | null;
  estado: Estado;
}

interface Resp {
  ok: boolean;
  error?: string;
  archivo: string | null;
  actualizado: string | null;
  ministerio_descargado: string | null;
  total_region: number;
  filas: Fila[];
}

const ESTADOS: Record<Estado, { label: string; color: string; ayuda: string }> = {
  OK:         { label: '✅ Bien',            color: '#10b981', ayuda: 'Cargada en el Ministerio con el código que corresponde' },
  DISTINTO:   { label: '❌ Código distinto', color: '#ef4444', ayuda: 'En el Ministerio figura con otro código del que corresponde' },
  NO_CARGADA: { label: '⏳ No está',         color: '#f59e0b', ayuda: 'No hay nada en el Ministerio para esas fechas (o se cargó después de la última descarga)' },
  SIN_CIE:    { label: '⚠️ CIE de relleno',  color: '#a78bfa', ayuda: 'El CIE decide el código pero vino vacío o de relleno (-, 999, 66666666…)' },
};

const norm = (s: any) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const fmt = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : iso);
const cargadoKey = (f: Fila) => (f.cargado_codigos.length ? f.cargado_codigos.join('+') : 'sin cargar');

export function LicenciasMedicasTab() {
  const anio = new Date().getFullYear();
  const [desde, setDesde] = useState(`${anio}-01-01`);
  const [hasta, setHasta] = useState(`${anio}-12-31`);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fEstado, setFEstado] = useState<Estado | ''>('');
  const [fCargado, setFCargado] = useState('');
  const [fEsperado, setFEsperado] = useState('');
  const [fNovedad, setFNovedad] = useState('');
  const [fDep, setFDep] = useState('');
  const [fCie, setFCie] = useState('');
  const [fTexto, setFTexto] = useState('');
  const [soloPorCie, setSoloPorCie] = useState(false);

  const cargar = () => {
    setLoading(true);
    setError(null);
    apiFetch<Resp>(`/comparacion-v2/licencias-medicas?desde=${desde}&hasta=${hasta}`)
      .then((r) => {
        if (!r?.ok) throw new Error(r?.error || 'Error');
        setData(r);
      })
      .catch((e) => setError(e?.message || 'Error'))
      .finally(() => setLoading(false));
  };
  useEffect(cargar, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filas = data?.filas ?? [];

  // filtros sin el de "se cargó como": así los chips muestran cuántas hay de cada código
  const base = useMemo(() => {
    const cie = norm(fCie);
    const txt = norm(fTexto);
    return filas.filter((f) => {
      if (fEstado && f.estado !== fEstado) return false;
      if (fEsperado && f.esperado_codigo !== fEsperado) return false;
      if (fNovedad && f.novedad_siape !== fNovedad) return false;
      if (fDep && !f.dependencia.includes(fDep)) return false;
      if (soloPorCie && !f.por_cie) return false;
      if (cie && !norm(f.cie).startsWith(cie)) return false;
      if (txt && !norm(`${f.nombre} ${f.dni} ${f.legajo} ${f.diagnostico_siape} ${f.diagnostico_cie ?? ''}`).includes(txt)) return false;
      return true;
    });
  }, [filas, fEstado, fEsperado, fNovedad, fDep, fCie, fTexto, soloPorCie]);

  const vista = useMemo(() => (fCargado ? base.filter((f) => cargadoKey(f) === fCargado) : base), [base, fCargado]);

  const contar = (arr: Fila[], key: (f: Fila) => string) => {
    const m = new Map<string, number>();
    for (const f of arr) m.set(key(f), (m.get(key(f)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const chipsCargado = contar(base, cargadoKey);
  const porEstado = contar(filas, (f) => f.estado);
  const opcionesEsperado = contar(filas, (f) => f.esperado_codigo || '—').map(([k]) => k).sort();
  const opcionesNovedad = contar(filas, (f) => f.novedad_siape).map(([k]) => k).sort();
  const opcionesDep = [...new Set(filas.flatMap((f) => f.dependencia.split(', ').filter(Boolean)))].sort();

  const exportar = () =>
    exportToExcel(
      `licencias_medicas_control_${desde}_${hasta}`,
      vista.map((f) => ({
        Estado: ESTADOS[f.estado].label.replace(/^\S+\s/, ''),
        DNI: f.dni,
        Legajo: f.legajo,
        Nombre: f.nombre,
        'Novedad SIAPE': f.novedad_siape,
        Resolución: f.resolucion,
        Desde: f.desde,
        Hasta: f.hasta,
        Días: f.dias ?? '',
        CIE: f.cie,
        'Diagnóstico SIAPE': f.diagnostico_siape,
        'Diagnóstico CIE-10': f.diagnostico_cie ?? '',
        'Debería ir como': f.esperado,
        'Por regla CIE': f.por_cie ? 'SI' : '',
        'Se cargó como': f.cargado.join(' | '),
        Dependencia: f.dependencia,
        'Robot carga': f.robot_estado ? `${f.robot_estado} ${f.robot_detalle ?? ''}`.trim() : '',
      }))
    );

  const lbl: React.CSSProperties = { fontSize: '0.67rem', color: '#94a3b8', marginBottom: 3 };
  const inp: React.CSSProperties = { fontSize: '0.8rem', padding: '5px 8px' };
  const chip = (activo: boolean, color: string): React.CSSProperties => ({
    cursor: 'pointer',
    fontSize: '0.76rem',
    padding: '4px 10px',
    borderRadius: 999,
    border: `1px solid ${activo ? color : 'rgba(255,255,255,.12)'}`,
    background: activo ? `${color}33` : 'rgba(15,23,42,.6)',
    color: activo ? '#fff' : 'var(--text)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="muted" style={{ fontSize: '0.75rem' }}>
        Licencias médicas del SIAPE ({data?.archivo ?? 'LICENCIAS_MEDICAS'}
        {data?.actualizado ? `, ${new Date(data.actualizado).toLocaleString('es-AR')}` : ''}) de nuestros agentes, contra cómo
        figuran en el Ministerio (descarga anual{data?.ministerio_descargado ? ` del ${data.ministerio_descargado}` : ''}) y cómo
        deberían cargarse según el mapeo (regla por CIE, si no la general). Lo cargado después de esa descarga figura como “No está”.
      </div>

      {/* Período */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <div>
          <div style={lbl}>DESDE</div>
          <input type="date" className="input" style={inp} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div>
          <div style={lbl}>HASTA</div>
          <input type="date" className="input" style={inp} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <button className="btn" onClick={cargar} disabled={loading}>
          {loading ? '⏳ Leyendo…' : '🔄 Actualizar'}
        </button>
        <button className="btn" onClick={exportar} disabled={!vista.length} style={{ marginLeft: 'auto' }}>
          📥 Exportar ({vista.length})
        </button>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)', padding: 12 }}>Error: {error}</div>}
      {loading && !data && <div className="card muted" style={{ padding: 24, textAlign: 'center' }}>⏳ Leyendo licencias…</div>}

      {data && (
        <>
          {/* Estados */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(Object.keys(ESTADOS) as Estado[]).map((e) => {
              const n = porEstado.find(([k]) => k === e)?.[1] ?? 0;
              return (
                <div
                  key={e}
                  className="card"
                  title={ESTADOS[e].ayuda}
                  onClick={() => setFEstado(fEstado === e ? '' : e)}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 16px',
                    minWidth: 140,
                    textAlign: 'center',
                    border: fEstado === e ? `1px solid ${ESTADOS[e].color}` : undefined,
                  }}
                >
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: ESTADOS[e].color }}>{n}</div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{ESTADOS[e].label}</div>
                </div>
              );
            })}
            <div className="card" style={{ padding: '10px 16px', minWidth: 140, textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{filas.length}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }} title={`${data.total_region} en todo el export del SIAPE`}>
                licencias de agentes propios
              </div>
            </div>
          </div>

          {/* Se cargó como */}
          <div>
            <div style={lbl}>SE CARGÓ EN EL MINISTERIO COMO — clic para filtrar</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={chip(!fCargado, '#7c3aed')} onClick={() => setFCargado('')}>
                Todos ({base.length})
              </span>
              {chipsCargado.map(([k, n]) => (
                <span key={k} style={chip(fCargado === k, '#7c3aed')} onClick={() => setFCargado(fCargado === k ? '' : k)}>
                  {k} ({n})
                </span>
              ))}
            </div>
          </div>

          {/* Filtros */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div>
              <div style={lbl}>DEBERÍA IR COMO</div>
              <select className="input" style={inp} value={fEsperado} onChange={(e) => setFEsperado(e.target.value)}>
                <option value="">Todos</option>
                {opcionesEsperado.map((o) => (
                  <option key={o} value={o === '—' ? '' : o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={lbl}>NOVEDAD SIAPE</div>
              <select className="input" style={inp} value={fNovedad} onChange={(e) => setFNovedad(e.target.value)}>
                <option value="">Todas</option>
                {opcionesNovedad.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={lbl}>DEPENDENCIA</div>
              <select className="input" style={inp} value={fDep} onChange={(e) => setFDep(e.target.value)}>
                <option value="">Todas</option>
                {opcionesDep.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={lbl}>CÓDIGO CIE (empieza con)</div>
              <input className="input" style={inp} placeholder="C50, O20, I…" value={fCie} onChange={(e) => setFCie(e.target.value)} />
            </div>
            <div>
              <div style={lbl}>NOMBRE, DNI O DIAGNÓSTICO</div>
              <input className="input" style={inp} placeholder="buscar…" value={fTexto} onChange={(e) => setFTexto(e.target.value)} />
            </div>
            <label style={{ fontSize: '0.78rem', display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 6 }}>
              <input type="checkbox" checked={soloPorCie} onChange={(e) => setSoloPorCie(e.target.checked)} />
              Solo las que van por regla CIE
            </label>
          </div>

          {/* Tabla */}
          <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '65vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'rgba(15,23,42,.97)', zIndex: 1 }}>
                <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                  {['Estado', 'Agente', 'Novedad SIAPE', 'Desde', 'Hasta', 'Días', 'CIE', 'Diagnóstico', 'Debería ir como', 'Se cargó como', 'Dep.', 'Robot'].map((h) => (
                    <th key={h} style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vista.slice(0, 1000).map((f, i) => (
                  <tr key={`${f.dni}-${f.desde}-${i}`} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: ESTADOS[f.estado].color }} title={ESTADOS[f.estado].ayuda}>
                      {ESTADOS[f.estado].label}
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <div style={{ fontWeight: 600 }}>{f.nombre}</div>
                      <div className="muted" style={{ fontSize: '0.7rem' }}>{f.dni}{f.legajo && f.legajo !== '-' ? ` · leg. ${f.legajo}` : ''}</div>
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      {f.novedad_siape}
                      {f.resolucion && f.resolucion !== 'OTORGADA' && (
                        <div style={{ fontSize: '0.7rem', color: '#f59e0b' }}>{f.resolucion}</div>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{fmt(f.desde)}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{fmt(f.hasta)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{f.dias ?? ''}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 700, color: f.cie_relleno ? 'var(--muted)' : undefined }}>{f.cie || '—'}</td>
                    <td style={{ padding: '5px 8px', maxWidth: 280 }}>
                      {f.diagnostico_cie ?? f.diagnostico_siape}
                      {f.diagnostico_cie && norm(f.diagnostico_cie) !== norm(f.diagnostico_siape) && f.diagnostico_siape && (
                        <div className="muted" style={{ fontSize: '0.7rem' }}>SIAPE: {f.diagnostico_siape}</div>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px' }} title={f.esperado}>
                      <b>{f.esperado_codigo || '—'}</b>
                      {f.por_cie && <span style={{ fontSize: '0.68rem', color: '#fbbf24' }}> · por CIE</span>}
                    </td>
                    <td style={{ padding: '5px 8px' }} title={f.cargado.join('\n')}>
                      {f.cargado_codigos.length ? (
                        <b style={{ color: f.estado === 'DISTINTO' ? '#ef4444' : undefined }}>{f.cargado_codigos.join(' + ')}</b>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{f.dependencia || '—'}</td>
                    <td style={{ padding: '5px 8px', fontSize: '0.7rem' }} title={f.robot_detalle ?? ''}>{f.robot_estado ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vista.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Nada coincide con los filtros.</div>}
            {vista.length > 1000 && (
              <div className="muted" style={{ padding: 10, textAlign: 'center', fontSize: '0.75rem' }}>
                Se muestran 1000 de {vista.length}: filtrá o exportá para ver todo.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

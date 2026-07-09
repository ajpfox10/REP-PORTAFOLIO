// src/pages/AsistenciaPage/LicenciasPdfSection.tsx
// Comparador PDF: cruza listados ANUAL/COMPLEMENTARIA del Ministerio
// contra el parte de novedades (NOVEDADES PDF) usando el mapeo de la página.

import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ArchivoInfo {
  nombre: string;
  tamaño: number;
  modificado: string;
}

interface FilaComparacion {
  legajo: string;
  nombre: string;
  tipo: 'ANUAL' | 'COMPLEMENTARIA';
  desde: string;
  hasta: string;
  diasEnMes: number[];
  codigosPorDia: Record<number, string>;
  codigosEsperados: string[];
  estado: 'OK' | 'FALTA_EN_NOVEDADES' | 'CODIGO_INCORRECTO' | 'SIN_LEGAJO';
  motivo?: string;
  archivoAnual: string;
  archivoNovedades: string;
}

interface FilaSobrante {
  legajo: string;
  nombre: string;
  cargo: string;
  diasConCodigo: number[];
  codigo: string;
  estado: 'EXCESO';
  motivo: string;
  archivoNovedades: string;
}

interface Resultado {
  periodo?: { anio: number; mes: number };
  archivosDetectados: Array<{ archivo: string; tipo: string }>;
  filas: FilaComparacion[];
  sobrantes: FilaSobrante[];
  totales: {
    ok: number;
    faltanEnNovedades: number;
    codigoIncorrecto: number;
    sinLegajo: number;
    sobrantes: number;
  };
}

// ── Estilos de badge ──────────────────────────────────────────────────────────

const BADGE: Record<string, React.CSSProperties> = {
  OK: {
    background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.4)',
    color: '#10b981', borderRadius: 8, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600,
  },
  FALTA_EN_NOVEDADES: {
    background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.45)',
    color: '#ef4444', borderRadius: 8, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600,
  },
  CODIGO_INCORRECTO: {
    background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.4)',
    color: '#fbbf24', borderRadius: 8, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600,
  },
  SIN_LEGAJO: {
    background: 'rgba(148,163,184,.1)', border: '1px solid rgba(148,163,184,.3)',
    color: '#94a3b8', borderRadius: 8, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600,
  },
  EXCESO: {
    background: 'rgba(168,85,247,.15)', border: '1px solid rgba(168,85,247,.4)',
    color: '#c084fc', borderRadius: 8, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600,
  },
};

const LABELS: Record<string, string> = {
  OK:                  'OK',
  FALTA_EN_NOVEDADES:  'FALTA CARGAR',
  CODIGO_INCORRECTO:   'CÓDIGO INCORRECTO',
  SIN_LEGAJO:          'SIN LEGAJO',
  EXCESO:              'EXCESO',
};

const TIPO_COLOR: Record<string, string> = {
  NOVEDADES:       '#60a5fa',
  ANUAL:           '#34d399',
  COMPLEMENTARIA:  '#f59e0b',
  DESCONOCIDO:     '#94a3b8',
};

// ── Export XLSX ───────────────────────────────────────────────────────────────

function exportar(resultado: Resultado) {
  const wb = XLSX.utils.book_new();

  const hdrs = ['Legajo','Nombre','Tipo','Desde','Hasta','Días en mes','Códigos esperados','Códigos cargados','Estado','Motivo','Archivo ANUAL'];
  const data = resultado.filas.map((f) => [
    f.legajo,
    f.nombre,
    f.tipo,
    f.desde,
    f.hasta,
    f.diasEnMes.join(', '),
    f.codigosEsperados.join('/'),
    f.diasEnMes.map((d) => f.codigosPorDia[d] ?? '—').join(', '),
    LABELS[f.estado] ?? f.estado,
    f.motivo ?? '',
    f.archivoAnual,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([hdrs, ...data]);
  ws['!cols'] = [8,30,14,10,10,18,18,18,18,35,30].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Comparacion');

  if (resultado.sobrantes.length) {
    const hs = ['Legajo','Nombre','Cargo','Código','Días','Motivo','Archivo Novedades'];
    const ds = resultado.sobrantes.map((s) => [
      s.legajo, s.nombre, s.cargo, s.codigo, s.diasConCodigo.join(', '), s.motivo, s.archivoNovedades,
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([hs, ...ds]);
    ws2['!cols'] = [8,30,16,10,18,35,25].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws2, 'Sobrantes');
  }

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  saveAs(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `licencias_pdf_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

// ── Componente ────────────────────────────────────────────────────────────────

type FiltroEstado = 'TODOS' | 'OK' | 'FALTA_EN_NOVEDADES' | 'CODIGO_INCORRECTO' | 'SIN_LEGAJO' | 'EXCESO';

export function LicenciasPdfSection() {
  const toast = useToast();
  const [archivos, setArchivos] = useState<ArchivoInfo[] | null>(null);
  const [dir, setDir] = useState<string>('');
  const [cargando, setCargando] = useState(false);
  const [comparando, setComparando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [filtro, setFiltro] = useState<FiltroEstado>('TODOS');
  const [filtroNombre, setFiltroNombre] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | 'ANUAL' | 'COMPLEMENTARIA'>('TODOS');

  const cargarArchivos = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch<any>('/asistencia/licencias-pdf/archivos');
      if (r?.ok) {
        setArchivos(r.archivos ?? []);
        setDir(r.dir ?? '');
      }
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setCargando(false);
    }
  }, [toast]);

  const comparar = useCallback(async () => {
    setComparando(true);
    setResultado(null);
    try {
      const r = await apiFetch<any>('/asistencia/licencias-pdf/comparar');
      if (!r?.ok) throw new Error(r?.error || 'Error');
      setResultado(r.data);
      toast.ok('Comparación completa', `${r.data?.filas?.length ?? 0} registros`);
    } catch (e: any) {
      toast.error('Error al comparar', e?.message);
    } finally {
      setComparando(false);
    }
  }, [toast]);

  // Cargar archivos al montar
  React.useEffect(() => { cargarArchivos(); }, [cargarArchivos]);

  const lbl: React.CSSProperties = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 3 };
  const sh: React.CSSProperties = { fontSize: '0.68rem', color: '#64748b', fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 };

  // Filtrar filas + sobrantes
  const todasFilas: Array<FilaComparacion | FilaSobrante> = resultado
    ? [
        ...resultado.filas,
        ...(filtro === 'EXCESO' || filtro === 'TODOS' ? resultado.sobrantes : []),
      ]
    : [];

  const filtradas = todasFilas.filter((f) => {
    if (filtro !== 'TODOS' && f.estado !== filtro) return false;
    if (filtroNombre && !f.nombre.toLowerCase().includes(filtroNombre.toLowerCase()) && !f.legajo.includes(filtroNombre)) return false;
    if (filtroTipo !== 'TODOS' && 'tipo' in f && f.tipo !== filtroTipo) return false;
    return true;
  });

  const meses = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Panel superior ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>

        {/* Carpeta y archivos */}
        <div className="card gp-card-14" style={{ padding: 16 }}>
          <div style={sh}>CARPETA DE PDFs</div>
          {dir && (
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 10, wordBreak: 'break-all' }}>
              {dir}
            </div>
          )}
          {archivos === null ? (
            <div style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Cargando…</div>
          ) : archivos.length === 0 ? (
            <div style={{ color: '#ef4444', fontSize: '0.82rem' }}>
              No se encontraron PDFs en la carpeta.<br />
              <span style={{ color: '#64748b' }}>Configurá LICENCIAS_PDF_DIR en el .env del servidor.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {resultado?.archivosDetectados
                ? resultado.archivosDetectados.map((a) => (
                    <div key={a.archivo} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.8rem' }}>
                      <span style={{ color: TIPO_COLOR[a.tipo] ?? '#94a3b8', fontWeight: 600, minWidth: 120 }}>
                        {a.tipo}
                      </span>
                      <span style={{ color: '#cbd5e1' }}>{a.archivo}</span>
                    </div>
                  ))
                : archivos.map((a) => (
                    <div key={a.nombre} style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      📄 {a.nombre}
                    </div>
                  ))
              }
            </div>
          )}
          <button
            className="btn"
            style={{ marginTop: 10, fontSize: '0.78rem', padding: '4px 12px' }}
            onClick={cargarArchivos}
            disabled={cargando}
          >
            {cargando ? 'Actualizando…' : 'Refrescar'}
          </button>
        </div>

        {/* Botón comparar + resumen */}
        <div className="card gp-card-14" style={{ padding: 16 }}>
          <div style={sh}>COMPARACIÓN</div>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
            Compara los PDFs de licencias anuales (ANUAL / COMPLEMENTARIA) contra el parte de novedades,
            usando el mapeo configurado en esta página.
          </div>

          <button
            className="btn btn-primary"
            style={{ fontSize: '0.84rem', padding: '7px 18px' }}
            onClick={comparar}
            disabled={comparando || !archivos?.length}
          >
            {comparando ? 'Comparando…' : 'Comparar PDFs'}
          </button>

          {resultado && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {resultado.periodo && (
                <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  Período novedades: <strong style={{ color: '#cbd5e1' }}>
                    {meses[resultado.periodo.mes]} {resultado.periodo.anio}
                  </strong>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'OK', val: resultado.totales.ok, color: '#10b981' },
                  { label: 'Falta cargar', val: resultado.totales.faltanEnNovedades, color: '#ef4444' },
                  { label: 'Cód. incorrecto', val: resultado.totales.codigoIncorrecto, color: '#fbbf24' },
                  { label: 'Sin legajo', val: resultado.totales.sinLegajo, color: '#94a3b8' },
                  { label: 'Sobrantes', val: resultado.totales.sobrantes, color: '#c084fc' },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{val}</span>
                    <span style={{ fontSize: '0.66rem', color: '#64748b' }}>{label}</span>
                  </div>
                ))}
              </div>
              <button
                className="btn"
                style={{ fontSize: '0.76rem', padding: '4px 12px', marginTop: 4, width: 'fit-content' }}
                onClick={() => exportar(resultado)}
              >
                Exportar XLSX
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Resultados ── */}
      {resultado && (
        <div className="card gp-card-14" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={sh}>RESULTADOS</div>

            {/* Filtro estado */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['TODOS','OK','FALTA_EN_NOVEDADES','CODIGO_INCORRECTO','SIN_LEGAJO','EXCESO'] as FiltroEstado[]).map((e) => (
                <button
                  key={e}
                  onClick={() => setFiltro(e)}
                  style={{
                    ...BADGE[e] ?? {},
                    cursor: 'pointer',
                    opacity: filtro === e ? 1 : 0.45,
                    fontWeight: filtro === e ? 700 : 400,
                    fontSize: '0.72rem',
                    padding: '3px 10px',
                    borderRadius: 8,
                    border: filtro === e ? undefined : '1px solid rgba(255,255,255,.1)',
                    background: filtro === e ? undefined : 'transparent',
                    color: filtro === e ? undefined : '#64748b',
                  }}
                >
                  {e === 'TODOS' ? 'Todos' : LABELS[e]}
                </button>
              ))}
            </div>

            {/* Filtro tipo */}
            <select
              className="input"
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as any)}
              style={{ fontSize: '0.78rem', width: 'auto', minWidth: 120 }}
            >
              <option value="TODOS">Todos los tipos</option>
              <option value="ANUAL">ANUAL</option>
              <option value="COMPLEMENTARIA">COMPLEMENTARIA</option>
            </select>

            {/* Filtro nombre/legajo */}
            <input
              className="input"
              placeholder="Buscar nombre o legajo…"
              value={filtroNombre}
              onChange={(e) => setFiltroNombre(e.target.value)}
              style={{ fontSize: '0.78rem', width: 180 }}
            />

            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#64748b' }}>
              {filtradas.length} registros
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.77rem', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 80 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 120 }} />
                <col />
              </colgroup>
              <thead>
                <tr style={{ color: '#64748b', fontSize: '0.68rem', letterSpacing: '0.06em' }}>
                  {['Legajo','Nombre','Tipo','Desde','Hasta','Días en mes','Estado','Detalle'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,.06)', fontWeight: 700 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                      Sin registros con este filtro
                    </td>
                  </tr>
                )}
                {filtradas.map((f, i) => {
                  const esSobrante = f.estado === 'EXCESO';
                  const fila = f as FilaComparacion;
                  const sob  = f as FilaSobrante;

                  const diasStr = esSobrante
                    ? sob.diasConCodigo.join(', ')
                    : fila.diasEnMes.map((d) => {
                        const cod = fila.codigosPorDia[d];
                        const ok = cod && fila.codigosEsperados.includes(cod);
                        return (
                          <span key={d} title={cod ? `Día ${d}: ${cod}` : `Día ${d}: sin código`}
                            style={{ color: ok ? '#10b981' : cod ? '#fbbf24' : '#ef4444', marginRight: 3 }}>
                            {d}
                          </span>
                        );
                      });

                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: '#94a3b8' }}>
                        {f.legajo || '—'}
                      </td>
                      <td style={{ padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.nombre || '—'}
                      </td>
                      <td style={{ padding: '5px 8px', color: esSobrante ? '#c084fc' : TIPO_COLOR[fila.tipo] ?? '#94a3b8', fontWeight: 600, fontSize: '0.7rem' }}>
                        {esSobrante ? `EXCESO (${sob.codigo})` : fila.tipo}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#94a3b8' }}>
                        {esSobrante ? '—' : fila.desde}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#94a3b8' }}>
                        {esSobrante ? '—' : fila.hasta}
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        {Array.isArray(diasStr) ? diasStr : <span style={{ color: '#94a3b8' }}>{diasStr}</span>}
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={BADGE[f.estado]}>{LABELS[f.estado] ?? f.estado}</span>
                      </td>
                      <td style={{ padding: '5px 8px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.motivo || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

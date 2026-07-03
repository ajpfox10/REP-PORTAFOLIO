import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel } from '../../utils/export';
import { GestionDocumentPreview } from '../Gesytionpage/components/components/GestionDocumentPreview';

const PAGE_SIZE = 50;

interface ReclamoMedico {
  id: number;
  dni: number;
  apellido: string | null;
  nombre: string | null;
  documento_nombre: string | null;
  tipo: string | null;
  numero: string | null;
  fecha_reclamo: string | null;
  descripcion_archivo: string | null;
  nombre_archivo_original: string | null;
  fecha_carga: string | null;
  cargado_por_id: number | null;
  cargado_por_nombre: string | null;
  cargado_por_email: string | null;
}

interface Opcion {
  id?: number | null;
  nombre?: string | null;
  mes?: string | null;
  total?: number | string;
}

function fmt(value?: string | null, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return withTime ? date.toLocaleString('es-AR') : date.toLocaleDateString('es-AR');
}

function nombreAgente(row: ReclamoMedico) {
  return [row.apellido, row.nombre].filter(Boolean).join(', ') || 'Sin datos personales';
}

export function ReclamosLicenciasMedicasTab() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [dni, setDni] = useState('');
  const [mes, setMes] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [cargadoPor, setCargadoPor] = useState('');
  const [rows, setRows] = useState<ReclamoMedico[]>([]);
  const [cargadores, setCargadores] = useState<Opcion[]>([]);
  const [meses, setMeses] = useState<Opcion[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewer, setViewer] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    objectUrl: string | null;
    filename: string | null;
    contentType: string | null;
  }>({ open: false, loading: false, error: null, objectUrl: null, filename: null, contentType: null });

  const params = useCallback((pageNum: number, limit = PAGE_SIZE, clear = false) => {
    const p = new URLSearchParams({ page: String(pageNum), limit: String(limit) });
    if (!clear) {
      if (q.trim()) p.set('q', q.trim());
      if (dni.trim()) p.set('dni', dni.trim());
      if (mes) p.set('mes', mes);
      if (fechaDesde) p.set('fecha_desde', fechaDesde);
      if (fechaHasta) p.set('fecha_hasta', fechaHasta);
      if (cargadoPor) p.set('cargado_por', cargadoPor);
    }
    return p;
  }, [q, dni, mes, fechaDesde, fechaHasta, cargadoPor]);

  const buscar = useCallback(async (pageNum = 1, clear = false) => {
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/licencias/reclamos-medicos?${params(pageNum, PAGE_SIZE, clear)}`);
      setRows(Array.isArray(res?.data) ? res.data : []);
      setTotal(Number(res?.meta?.total ?? 0));
      setPages(Number(res?.meta?.pages ?? 1));
      setPage(pageNum);
      setCargadores(Array.isArray(res?.meta?.cargadores) ? res.meta.cargadores : []);
      setMeses(Array.isArray(res?.meta?.meses) ? res.meta.meses : []);
    } catch (e: any) {
      toast.error('Error al buscar reclamos', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [params, toast]);

  useEffect(() => { buscar(1); }, []);

  const limpiar = () => {
    setQ('');
    setDni('');
    setMes('');
    setFechaDesde('');
    setFechaHasta('');
    setCargadoPor('');
    buscar(1, true);
  };

  const exportar = async () => {
    setExporting(true);
    try {
      const res = await apiFetch<any>(`/licencias/reclamos-medicos?${params(1, 5000)}`);
      const data: ReclamoMedico[] = Array.isArray(res?.data) ? res.data : [];
      exportToExcel('reclamos_licencias_medicas', data.map(r => ({
        DNI: r.dni,
        Agente: nombreAgente(r),
        'Fecha del reclamo': fmt(r.fecha_reclamo),
        Documento: r.documento_nombre || r.nombre_archivo_original || `Documento #${r.id}`,
        'Cargado por': r.cargado_por_nombre || r.cargado_por_email || 'Migración histórica',
        'Fecha de carga': fmt(r.fecha_carga, true),
      })));
      toast.ok('Exportado', `${data.length} reclamo(s)`);
    } catch (e: any) {
      toast.error('Error al exportar', e?.message || 'Error');
    } finally {
      setExporting(false);
    }
  };

  const abrirDocumento = async (row: ReclamoMedico) => {
    setViewer({ open: true, loading: true, error: null, objectUrl: null, filename: null, contentType: null });
    try {
      const { blob, filename, contentType } = await apiFetchBlobWithMeta(`/documents/${row.id}/file`);
      setViewer({
        open: true,
        loading: false,
        error: null,
        objectUrl: URL.createObjectURL(blob),
        filename: filename || row.nombre_archivo_original || row.documento_nombre || `documento-${row.id}`,
        contentType,
      });
    } catch (e: any) {
      setViewer(v => ({ ...v, loading: false, error: e?.message || 'No se pudo abrir el documento' }));
    }
  };

  const cerrarViewer = () => {
    if (viewer.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(viewer.objectUrl);
    setViewer({ open: false, loading: false, error: null, objectUrl: null, filename: null, contentType: null });
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="h2" style={{ marginBottom: 4 }}>Buscador de reclamos de licencias médicas</div>
        <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 14 }}>
          Consulta documentos identificados como reclamos de certificados médicos. El rango corresponde a la fecha registrada del documento.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <Field label="Agente o documento">
            <input className="input" value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscar(1)} placeholder="Apellido, nombre o documento" />
          </Field>
          <Field label="DNI">
            <input className="input" value={dni} onChange={e => setDni(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && buscar(1)} placeholder="DNI exacto" />
          </Field>
          <Field label="Mes">
            <select className="input" value={mes} onChange={e => setMes(e.target.value)}>
              <option value="">Todos los meses</option>
              {meses.map(m => <option key={m.mes} value={m.mes || ''}>{m.mes} ({m.total})</option>)}
            </select>
          </Field>
          <Field label="Desde">
            <input className="input" type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input className="input" type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
          </Field>
          <Field label="Cargado por">
            <select className="input" value={cargadoPor} onChange={e => setCargadoPor(e.target.value)}>
              <option value="">Todos</option>
              {cargadores.map(c => <option key={c.id} value={c.id ?? ''}>{c.nombre}</option>)}
            </select>
          </Field>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn ok" type="button" disabled={loading} onClick={() => buscar(1)}>
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
          <button className="btn" type="button" onClick={limpiar}>Limpiar</button>
          <button className="btn" type="button" disabled={exporting || !total} onClick={exportar}>
            {exporting ? 'Exportando...' : 'Excel'}
          </button>
          <span className="badge">{total} reclamo(s)</span>
        </div>
      </div>

      <div className="card">
        {loading ? <div className="muted">Cargando...</div> : !rows.length ? (
          <div className="muted">No se encontraron reclamos médicos con esos filtros.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>{['Fecha reclamo', 'DNI', 'Agente', 'Documento', 'Cargado por', 'Fecha carga', ''].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{fmt(row.fecha_reclamo)}</td>
                    <td style={tdStyle}><strong>{row.dni}</strong></td>
                    <td style={tdStyle}>{nombreAgente(row)}</td>
                    <td style={{ ...tdStyle, minWidth: 220 }}>
                      <div>{row.documento_nombre || row.nombre_archivo_original || `Documento #${row.id}`}</div>
                      {row.descripcion_archivo && <div className="muted" style={{ fontSize: '0.72rem' }}>{row.descripcion_archivo}</div>}
                    </td>
                    <td style={tdStyle}>{row.cargado_por_nombre || row.cargado_por_email || <span className="muted">Migración histórica</span>}</td>
                    <td style={tdStyle}>{fmt(row.fecha_carga, true)}</td>
                    <td style={tdStyle}><button className="btn" type="button" onClick={() => abrirDocumento(row)}>Ver documento</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 14 }}>
            <button className="btn" type="button" disabled={page <= 1 || loading} onClick={() => buscar(page - 1)}>Anterior</button>
            <span className="badge">Página {page} de {pages}</span>
            <button className="btn" type="button" disabled={page >= pages || loading} onClick={() => buscar(page + 1)}>Siguiente</button>
          </div>
        )}
      </div>

      {viewer.open && (
        <div className="modalOverlay" onMouseDown={cerrarViewer}>
          <div className="modal gp-doc-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
              <strong>{viewer.filename || 'Documento del reclamo'}</strong>
              <button className="btn" type="button" onClick={cerrarViewer}>Cerrar</button>
            </div>
            {viewer.loading ? <div className="muted">Cargando documento...</div>
              : viewer.error ? <div style={{ color: '#ef4444' }}>{viewer.error}</div>
              : viewer.objectUrl ? <GestionDocumentPreview url={viewer.objectUrl} meta={{ contentType: viewer.contentType ?? '', filename: viewer.filename }} />
              : null}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap', fontSize: '0.72rem', textTransform: 'uppercase' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'middle' };

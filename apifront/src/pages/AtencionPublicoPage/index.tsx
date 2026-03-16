// src/pages/AtencionPublicoPage/index.tsx
// Página de Atención al Público — Ventanilla / Mostrador

import React, { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { loadSession } from '../../auth/session';
import './styles/AtencionPublicoPage.css';

const MOTIVOS_PREDEFINIDOS = [
  { value: 'firma_jubilacion',              label: '🖊️ Firma Jubilación' },
  { value: 'entrega_documentacion_salario', label: '📄 Entrega de documentación para Salario' },
  { value: 'entrega_certificado_laboral',   label: '📋 Entrega de Certificado Laboral' },
  { value: 'entrega_constancia_empleo',     label: '📃 Entrega de Constancia de Empleo' },
  { value: 'retiro_recibo_sueldo',          label: '💰 Retiro de Recibo de Sueldo' },
  { value: 'actualizacion_datos',           label: '🔄 Actualización de Datos Personales' },
  { value: 'tramite_licencia',              label: '📅 Trámite de Licencia' },
  { value: 'consulta_legajo',               label: '🗂️ Consulta de Legajo' },
  { value: 'alta_ioma',                     label: '🏥 Alta / Baja IOMA' },
  { value: 'tramite_haberes',               label: '💵 Trámite de Haberes / Liquidación' },
  { value: 'presentacion_documentacion',    label: '📦 Presentación de Documentación' },
  { value: 'otro',                          label: '📝 Otro (especificar)' },
];

function fmtDateTime(dt?: string) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dt; }
}
function fmtDateShort(dt?: string) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dt; }
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

interface ResumenCardProps {
  icon: string; label: string; total: number;
  pendiente?: number; color: string; loading: boolean;
}
function ResumenCard({ icon, label, total, pendiente, color, loading }: ResumenCardProps) {
  return (
    <div className="ap-resumen-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="ap-resumen-icon" style={{ color }}>{icon}</div>
      <div className="ap-resumen-body">
        <div className="ap-resumen-label">{label}</div>
        {loading ? (
          <div className="ap-resumen-loading">…</div>
        ) : (
          <>
            <div className="ap-resumen-total">{total}</div>
            {pendiente !== undefined && pendiente > 0 && (
              <div className="ap-resumen-pendiente" style={{ color }}>
                {pendiente} pendiente{pendiente > 1 ? 's' : ''}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TicketPrint({ ticket }: { ticket: any }) {
  return (
    <div className="ap-ticket-print">
      <div className="ap-ticket-header">
        <div className="ap-ticket-logo">🏛️</div>
        <div>
          <div className="ap-ticket-title">TICKET DE ATENCIÓN</div>
          <div className="ap-ticket-num">N° {String(ticket.id).padStart(6,'0')}</div>
        </div>
      </div>
      <div className="ap-ticket-sep" />
      <div className="ap-ticket-row"><b>Agente:</b> {ticket.agente}</div>
      <div className="ap-ticket-row"><b>DNI:</b> {ticket.dni}</div>
      <div className="ap-ticket-row"><b>Motivo:</b> {ticket.motivo_label}</div>
      {ticket.explicacion && (
        <div className="ap-ticket-row"><b>Explicación:</b> {ticket.explicacion}</div>
      )}
      <div className="ap-ticket-row"><b>Hora de atención:</b> {ticket.hora_atencion}</div>
      {ticket.leyenda && (
        <div className="ap-ticket-leyenda">{ticket.leyenda}</div>
      )}
      <div className="ap-ticket-sep" />
      {ticket.tramitesPendientes?.length > 0 && (
        <>
          <div className="ap-ticket-section">📋 TRÁMITES PENDIENTES</div>
          {ticket.tramitesPendientes.map((t: any, i: number) => (
            <div className="ap-ticket-tramite" key={i}>
              <b>{t.pedido}</b>
              <span className={`ap-ticket-badge ${t.estado === 'pendiente' ? 'pend' : 'hecho'}`}>
                {t.estado}
              </span>
              {t.observacion && <div className="ap-ticket-obs">{t.observacion}</div>}
            </div>
          ))}
          <div className="ap-ticket-sep" />
        </>
      )}
      <div className="ap-ticket-footer">
        <div>Atendido por: <b>{ticket.operador}</b></div>
        <div>{fmtDateTime(ticket.fecha)}</div>
      </div>
    </div>
  );
}

export function AtencionPublicoPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [horaAtencion, setHoraAtencion] = useState('');

  const [dni, setDni]           = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading]   = useState(false);
  const [row, setRow]           = useState<any>(null);
  const [matches, setMatches]   = useState<any[]>([]);

  const [consultas, setConsultas]       = useState<any[]>([]);
  const [pedidos, setPedidos]           = useState<any[]>([]);
  const [documentos, setDocumentos]     = useState<any[]>([]);
  const [expedientes, setExpedientes]   = useState<any[]>([]);
  const [loadingDatos, setLoadingDatos] = useState(false);

  // Citaciones activas
  const [citacion, setCitacion]                   = useState<any>(null);
  const [showCitacionModal, setShowCitacionModal] = useState(false);

  const [motivoSeleccionado, setMotivoSeleccionado] = useState('');
  const [explicacion, setExplicacion]               = useState('');
  const [leyenda, setLeyenda]                       = useState('');
  const [savingConsulta, setSavingConsulta]         = useState(false);

  const [ticketEmitido, setTicketEmitido] = useState<any>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  const [tablaTab, setTablaTab] = useState<'consultas' | 'pedidos' | 'documentos' | 'expedientes'>('consultas');

  const cargarDatosAgente = useCallback(async (cleanDni: string) => {
    if (!cleanDni) return;
    setLoadingDatos(true);
    setConsultas([]);
    setPedidos([]);
    setDocumentos([]);
    setExpedientes([]);

    await Promise.allSettled([
      // Citaciones activas — abre modal automáticamente si hay una
      apiFetch<any>(`/crud/citaciones?dni=${cleanDni}&citacion_activa=1&limit=1`)
        .then(r => {
          const c = Array.isArray(r?.data) ? r.data[0] : null;
          setCitacion(c || null);
          if (c) setShowCitacionModal(true);
        })
        .catch(() => setCitacion(null)),

      apiFetch<any>(`/consultas?dni=${cleanDni}&limit=50`)
        .then(r => setConsultas(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setConsultas([])),

      apiFetch<any>(`/pedidos?dni=${cleanDni}&limit=50`)
        .then(r => setPedidos(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setPedidos([])),

      apiFetch<any>(`/documents?dni=${cleanDni}&limit=50`)
        .then(r => {
          const data = Array.isArray(r?.data) ? r.data : (Array.isArray(r?.items) ? r.items : []);
          setDocumentos(data);
        })
        .catch(() => setDocumentos([])),

      apiFetch<any>(`/eventos?dni=${cleanDni}&limit=50`)
        .then(r => setExpedientes(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setExpedientes([])),
    ]);

    setLoadingDatos(false);
  }, []);

  const buscarPorDni = useCallback(async (dniOverride?: string) => {
    const clean = (dniOverride ?? dni).replace(/\D/g, '');
    if (!clean) { toast.error('DNI inválido', 'Ingresá un DNI válido'); return; }
    setLoading(true);
    setRow(null);
    setMatches([]);
    setTicketEmitido(null);
    setCitacion(null);
    setShowCitacionModal(false);
    try {
      const res = await apiFetch<any>(`/personal/${clean}`);
      if (!res?.ok || !res?.data) {
        toast.error('No encontrado', `No hay agente con DNI ${clean}`);
        return;
      }
      const rowData = { ...res.data };
      if (!rowData.dni) rowData.dni = Number(clean);
      setRow(rowData);
      toast.ok('Agente cargado', `${rowData.apellido ?? ''}, ${rowData.nombre ?? ''}`);
      cargarDatosAgente(clean);
    } catch (e: any) {
      toast.error('Error al buscar agente', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [dni, cargarDatosAgente]);

  const buscarPorNombre = useCallback(async () => {
    const q = fullName.trim();
    if (!q) { toast.error('Ingresá apellido y/o nombre'); return; }
    setLoading(true);
    setMatches([]);
    setRow(null);
    try {
      const results = await searchPersonal(q, 30);
      setMatches(results);
      if (!results.length) toast.error('Sin resultados', `No se encontró "${q}"`);
      else toast.ok(`${results.length} resultado(s)`);
    } catch (e: any) {
      toast.error('Error al buscar', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [fullName]);

  const seleccionarMatch = useCallback((m: any) => {
    const clean = String(m.dni).replace(/\D/g, '');
    setDni(clean);
    setMatches([]);
    buscarPorDni(clean);
  }, [buscarPorDni]);

  const emitirTicket = useCallback(async () => {
    if (!row?.dni) { toast.error('Primero buscá un agente'); return; }
    if (!motivoSeleccionado) { toast.error('Seleccioná un motivo de consulta'); return; }

    const motivoLabel = MOTIVOS_PREDEFINIDOS.find(m => m.value === motivoSeleccionado)?.label ?? motivoSeleccionado;
    const motivoFinal = motivoSeleccionado === 'otro'
      ? explicacion.trim() || 'Otro'
      : `${motivoLabel}${explicacion.trim() ? ` — ${explicacion.trim()}` : ''}`;

    const s = loadSession();
    const u: any = s?.user || {};
    const operador = u?.nombre || u?.email || `Usuario #${u?.id}` || 'anon';

    setSavingConsulta(true);
    try {
      const res = await apiFetch<any>('/consultas', {
        method: 'POST',
        body: JSON.stringify({
          dni: row.dni,
          motivo_consulta: motivoFinal,
          explicacion: explicacion.trim() || undefined,
          estado: 'atendido',
        }),
      });

      const consultaId = res?.data?.id ?? res?.id ?? Date.now();
      const tramitesPendientes = pedidos.filter((t: any) => t.estado === 'pendiente');

      const ticket = {
        id: consultaId,
        agente: `${row.apellido ?? ''}, ${row.nombre ?? ''}`.trim(),
        dni: row.dni,
        motivo_label: motivoLabel,
        explicacion: explicacion.trim(),
        hora_atencion: nowHHMM(),
        leyenda: leyenda.trim(),
        tramitesPendientes,
        operador,
        fecha: new Date().toISOString(),
      };

      setTicketEmitido(ticket);
      toast.ok('Consulta registrada', 'Ticket listo para imprimir');
      setMotivoSeleccionado('');
      setExplicacion('');
      setLeyenda('');

      const cleanDni = String(row.dni).replace(/\D/g, '');
      setTimeout(() => cargarDatosAgente(cleanDni), 600);
    } catch (e: any) {
      toast.error('Error al guardar consulta', e?.message || 'Error');
    } finally {
      setSavingConsulta(false);
    }
  }, [row, motivoSeleccionado, explicacion, leyenda, pedidos, cargarDatosAgente]);

  const imprimirTicket = useCallback(() => {
    if (!ticketEmitido) return;
    window.print();
  }, [ticketEmitido]);

  const pendientePedidos = pedidos.filter((t: any) => t.estado === 'pendiente').length;
  const consultasHoy     = consultas.filter((c: any) => {
    if (!c.created_at) return false;
    return new Date(c.created_at).toDateString() === new Date().toDateString();
  }).length;

  const ultimasConsultas   = [...consultas].sort((a,b) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime()).slice(0, 3);
  const ultimosPedidos     = [...pedidos].sort((a,b) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime()).slice(0, 3);
  const ultimosDocumentos  = [...documentos].sort((a,b) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime()).slice(0, 3);
  const ultimosExpedientes = [...expedientes].sort((a,b) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime()).slice(0, 3);

  return (
    <>
      <Layout title="Atención al Público" showBack>
        <div className="ap-layout">

          {/* ── COLUMNA IZQUIERDA ── */}
          <div className="ap-left">

            <div className="card ap-card">
              <h3 className="ap-section-title">🔍 Buscar Agente</h3>
              <div className="ap-search-grid">
                <div>
                  <div className="muted ap-label">DNI</div>
                  <input
                    className="input"
                    value={dni}
                    onChange={e => setDni(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarPorDni()}
                    placeholder="Número de DNI (Enter)"
                    disabled={loading}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <div className="muted ap-label">Apellido / Nombre</div>
                  <input
                    className="input"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarPorNombre()}
                    placeholder="Apellido (Enter)"
                    disabled={loading}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              <div className="row ap-mt-8" style={{ gap: 8 }}>
                <button className="btn" onClick={() => buscarPorDni()} disabled={loading || !dni.trim()}>
                  {loading ? '…' : 'Buscar por DNI'}
                </button>
                <button className="btn" onClick={buscarPorNombre} disabled={loading || !fullName.trim()}>
                  {loading ? '…' : 'Buscar por nombre'}
                </button>
              </div>
            </div>

            {matches.length > 0 && (
              <div className="card ap-card">
                <div className="muted ap-label">Resultados ({matches.length})</div>
                <div className="ap-matches">
                  {matches.map((m: any) => (
                    <button key={m.dni} className="ap-match-item" onClick={() => seleccionarMatch(m)}>
                      <b>{m.apellido}, {m.nombre}</b>
                      <span className="badge" style={{ marginLeft: 8 }}>{m.dni}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {row && (
              <div className="card ap-card ap-agente-card">
                <div className="row ap-row-between">
                  <h3 className="ap-agente-name">👤 {row.apellido}, {row.nombre}</h3>
                  <span className="badge">DNI {row.dni}</span>
                </div>
                <div className="ap-agente-grid">
                  <div><b>CUIL:</b> {row.cuil || '—'}</div>
                  <div><b>Ley:</b> {row.ley_nombre || row.ley_id || '—'}</div>
                  <div><b>Dependencia:</b> {row.dependencia_nombre || '—'}</div>
                  <div><b>Servicio:</b> {row.servicio_nombre || '—'}</div>
                  <div><b>Categoría:</b> {row.categoria_nombre || '—'}</div>
                  <div><b>Planta:</b> {row.planta_nombre || '—'}</div>
                </div>
              </div>
            )}

            {row && (
              <div className="ap-resumen-grid">
                <ResumenCard icon="💬" label="Consultas" total={consultas.length} pendiente={consultasHoy > 0 ? consultasHoy : undefined} color="#6366f1" loading={loadingDatos} />
                <ResumenCard icon="📋" label="Pedidos" total={pedidos.length} pendiente={pendientePedidos} color="#f59e0b" loading={loadingDatos} />
                <ResumenCard icon="📂" label="Documentos" total={documentos.length} color="#10b981" loading={loadingDatos} />
                <ResumenCard icon="📁" label="Expedientes" total={expedientes.length} pendiente={expedientes.filter((e: any) => e.estado === 'abierto' || e.estado === 'pendiente').length} color="#8b5cf6" loading={loadingDatos} />
              </div>
            )}

            {row && (
              <div className="card ap-card">
                <h3 className="ap-section-title">📋 Registrar Consulta</h3>
                <div className="muted ap-label">Motivo de consulta *</div>
                <div className="ap-motivos-grid">
                  {MOTIVOS_PREDEFINIDOS.map(m => (
                    <button
                      key={m.value}
                      className={`ap-motivo-btn${motivoSeleccionado === m.value ? ' selected' : ''}`}
                      onClick={() => setMotivoSeleccionado(m.value)}
                      type="button"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="muted ap-label ap-mt-12">
                  {motivoSeleccionado === 'otro' ? 'Descripción del motivo *' : 'Explicación adicional (opcional)'}
                </div>
                <textarea
                  className="input ap-textarea"
                  value={explicacion}
                  onChange={e => setExplicacion(e.target.value)}
                  placeholder={motivoSeleccionado === 'otro' ? 'Describí el motivo de la consulta…' : 'Detalles adicionales, aclaraciones, etc.'}
                  rows={3}
                />
                <div className="muted ap-label ap-mt-12">Leyenda del ticket (opcional)</div>
                <input
                  className="input"
                  value={leyenda}
                  onChange={e => setLeyenda(e.target.value)}
                  placeholder="Ej: Traer documentación el próximo turno."
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
                <div className="ap-mt-16">
                  <button
                    className="btn ap-btn-emitir"
                    onClick={emitirTicket}
                    disabled={savingConsulta || !motivoSeleccionado}
                    type="button"
                  >
                    {savingConsulta ? '⏳ Guardando…' : '🎫 Registrar y Emitir Ticket'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── COLUMNA DERECHA ── */}
          <div className="ap-right">

            {ticketEmitido ? (
              <div className="card ap-card ap-ticket-wrapper" ref={ticketRef}>
                <div className="row ap-row-between ap-mb-12">
                  <h3 className="ap-section-title" style={{ margin: 0 }}>🎫 Ticket Emitido</h3>
                  <button className="btn" onClick={imprimirTicket} type="button">🖨️ Imprimir</button>
                </div>
                <TicketPrint ticket={ticketEmitido} />
              </div>
            ) : (
              <div className="card ap-card ap-ticket-placeholder">
                <div className="ap-placeholder-icon">🎫</div>
                <div className="ap-placeholder-text">
                  El ticket aparecerá aquí<br />
                  <span className="muted">una vez que registres la consulta</span>
                </div>
              </div>
            )}

            {row && !loadingDatos && pendientePedidos > 0 && (
              <div className="card ap-card ap-alert-card">
                <div className="ap-alert-title">⚠️ {pendientePedidos} pedido(s) pendiente(s)</div>
                {pedidos.filter((t: any) => t.estado === 'pendiente').slice(0, 5).map((t: any, i: number) => (
                  <div key={i} className="ap-tramite-item">
                    <span className="badge pend">PENDIENTE</span>
                    <b>{t.pedido || t.descripcion}</b>
                    {t.observacion && <span className="muted"> — {t.observacion}</span>}
                  </div>
                ))}
              </div>
            )}

            {row && !loadingDatos && pendientePedidos === 0 && (
              <div className="ap-tramites-ok">✅ Sin trámites pendientes</div>
            )}

            {row && (
              <div className="card ap-card ap-escaneo-card">
                <div className="ap-escaneo-header">
                  <span className="ap-escaneo-icon">📷</span>
                  <div>
                    <div className="ap-escaneo-title">Escanear documento</div>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>Abre el escáner con el agente ya cargado</div>
                  </div>
                </div>
                <button className="btn ap-btn-escanear" type="button" onClick={() => navigate(`/app/escaneo-agente/${row.dni}`)}>
                  📷 Ir a Escanear — {row.apellido}, {row.nombre}
                </button>
              </div>
            )}

            {row && (
              <div className="card ap-card">
                <h3 className="ap-section-title">📊 Últimos registros</h3>
                <div className="ap-tabla-tabs">
                  {([
                    ['consultas',   '💬 Consultas',   ultimasConsultas.length],
                    ['pedidos',     '📋 Pedidos',      ultimosPedidos.length],
                    ['documentos',  '📂 Documentos',  ultimosDocumentos.length],
                    ['expedientes', '📁 Expedientes', ultimosExpedientes.length],
                  ] as [typeof tablaTab, string, number][]).map(([t, label, count]) => (
                    <button key={t} className={`ap-tabla-tab${tablaTab === t ? ' active' : ''}`} onClick={() => setTablaTab(t)}>
                      {label}
                      {count > 0 && <span className="ap-tab-count">{count}</span>}
                    </button>
                  ))}
                </div>

                {loadingDatos ? (
                  <div className="ap-tabla-loading">🔄 Cargando datos…</div>
                ) : (
                  <div className="ap-tabla-container">
                    {tablaTab === 'consultas' && (
                      ultimasConsultas.length > 0 ? (
                        <table className="ap-tabla">
                          <thead><tr><th>#</th><th>Motivo</th><th>Estado</th><th>Fecha</th></tr></thead>
                          <tbody>
                            {ultimasConsultas.map((c: any) => (
                              <tr key={c.id}>
                                <td className="ap-tabla-id">{c.id}</td>
                                <td>{c.motivo_consulta || c.motivo || '—'}</td>
                                <td><span className={`ap-estado-badge ${c.estado === 'pendiente' ? 'pend' : 'ok'}`}>{c.estado || '—'}</span></td>
                                <td className="muted ap-tabla-fecha">{fmtDateShort(c.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="ap-tabla-empty">Sin consultas registradas</div>
                    )}
                    {tablaTab === 'pedidos' && (
                      ultimosPedidos.length > 0 ? (
                        <table className="ap-tabla">
                          <thead><tr><th>#</th><th>Pedido</th><th>Estado</th><th>Fecha</th></tr></thead>
                          <tbody>
                            {ultimosPedidos.map((p: any) => (
                              <tr key={p.id}>
                                <td className="ap-tabla-id">{p.id}</td>
                                <td>{p.pedido || p.descripcion || '—'}</td>
                                <td><span className={`ap-estado-badge ${p.estado === 'pendiente' ? 'pend' : 'ok'}`}>{p.estado || '—'}</span></td>
                                <td className="muted ap-tabla-fecha">{fmtDateShort(p.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="ap-tabla-empty">Sin pedidos registrados</div>
                    )}
                    {tablaTab === 'documentos' && (
                      ultimosDocumentos.length > 0 ? (
                        <table className="ap-tabla">
                          <thead><tr><th>#</th><th>Nombre</th><th>Tipo</th><th>Fecha</th></tr></thead>
                          <tbody>
                            {ultimosDocumentos.map((d: any) => (
                              <tr key={d.id}>
                                <td className="ap-tabla-id">{d.id}</td>
                                <td>{d.nombre || d.nombre_archivo_original || `Doc #${d.id}`}</td>
                                <td><span className="ap-tipo-badge">{d.tipo || '—'}</span></td>
                                <td className="muted ap-tabla-fecha">{fmtDateShort(d.created_at || d.fecha)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="ap-tabla-empty">Sin documentos cargados</div>
                    )}
                    {tablaTab === 'expedientes' && (
                      ultimosExpedientes.length > 0 ? (
                        <table className="ap-tabla">
                          <thead><tr><th>#</th><th>Tipo</th><th>Estado</th><th>Fecha</th></tr></thead>
                          <tbody>
                            {ultimosExpedientes.map((e: any) => (
                              <tr key={e.id}>
                                <td className="ap-tabla-id">{e.id}</td>
                                <td>{e.tipo || e.descripcion || e.titulo || '—'}</td>
                                <td><span className={`ap-estado-badge ${['abierto','pendiente'].includes(e.estado) ? 'pend' : 'ok'}`}>{e.estado || '—'}</span></td>
                                <td className="muted ap-tabla-fecha">{fmtDateShort(e.created_at || e.fecha)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="ap-tabla-empty">Sin expedientes registrados</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </Layout>

      {/* ── Modal citación activa — se abre automáticamente al cargar el agente ── */}
      {showCitacionModal && citacion && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}>
          <div className="card" style={{
            maxWidth: 460, width: '100%', padding: '1.5rem',
            border: '3px solid #ef4444', borderRadius: 14,
          }}>
            <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: 8 }}>⚠️</div>
            <div style={{ fontWeight: 800, fontSize: '1.2rem', color: '#ef4444', marginBottom: 16, textAlign: 'center' }}>
              CITACIÓN ACTIVA
            </div>
            <div style={{ marginBottom: 8 }}><b>Agente:</b> {row?.apellido}, {row?.nombre}</div>
            <div style={{ marginBottom: 8 }}><b>Motivo:</b> {citacion.motivo || '—'}</div>
            <div style={{ marginBottom: 8 }}><b>Citado por:</b> {citacion.citado_por || '—'}</div>
            <div style={{ marginBottom: 8 }}><b>Fecha citación:</b> {fmtDateTime(citacion.fecha_citacion)}</div>
            <button
              className="btn danger"
              style={{ marginTop: 16, width: '100%' }}
              onClick={() => setShowCitacionModal(false)}
              type="button"
            >
              Entendido — Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

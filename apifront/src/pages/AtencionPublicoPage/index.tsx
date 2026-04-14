// src/pages/AtencionPublicoPage/index.tsx
// Página de Atención al Público — Ventanilla / Mostrador

import React, { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch, apiFetchBlob, apiFetchBlobWithMeta } from '../../api/http';
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
    const d = new Date(dt);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
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
    <div style={{
      borderLeft: `3px solid ${color}`, background: 'rgba(255,255,255,0.03)',
      borderRadius: 8, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 7,
    }}>
      <span style={{ fontSize: '1rem', color }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.68rem', color: '#94a3b8', lineHeight: 1.2 }}>{label}</div>
        {loading ? (
          <div style={{ fontSize: '0.8rem' }}>…</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: '#e2e8f0' }}>{total}</span>
            {pendiente !== undefined && pendiente > 0 && (
              <span style={{ fontSize: '0.68rem', color, fontWeight: 600 }}>
                {pendiente} pend.
              </span>
            )}
          </div>
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
  const [expedientes, setExpedientes]     = useState<any[]>([]);
  const [resoluciones, setResoluciones]   = useState<any[]>([]);
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

  const [tablaTab, setTablaTab] = useState<'consultas' | 'pedidos' | 'documentos' | 'resoluciones' | 'expedientes'>('consultas');
  const [tablaPage, setTablaPage] = useState(1);
  const [expandedPedidoId, setExpandedPedidoId] = useState<number | null>(null);
  const [visorArchivo, setVisorArchivo] = useState<{ url: string; nombre: string; tipo: string } | null>(null);
  const [loadingArchivo, setLoadingArchivo] = useState<number | null>(null);
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoExpandida, setFotoExpandida] = useState(false);
  const TABLA_PAGE_SIZE = 10;

  const cargarDatosAgente = useCallback(async (cleanDni: string) => {
    if (!cleanDni) return;
    setLoadingDatos(true);
    setConsultas([]);
    setPedidos([]);
    setDocumentos([]);
    setExpedientes([]);
    setResoluciones([]);
    setLoadedTabs(new Set(['consultas', 'pedidos']));

    await Promise.allSettled([
      // Citaciones activas — filtramos client-side por citacion_activa
      apiFetch<any>(`/citaciones?dni=${cleanDni}&limit=10&sort=-created_at`)
        .then(r => {
          const all = Array.isArray(r?.data) ? r.data : [];
          const c = all.find((x: any) => x.citacion_activa == 1 || x.citacion_activa === true) || null;
          setCitacion(c);
          if (c) setShowCitacionModal(true);
        })
        .catch(() => setCitacion(null)),

      apiFetch<any>(`/consultas?dni=${cleanDni}&limit=50`)
        .then(r => setConsultas(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setConsultas([])),

      apiFetch<any>(`/pedidos?dni=${cleanDni}&limit=50`)
        .then(r => setPedidos(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setPedidos([])),
    ]);

    setLoadingDatos(false);
  }, []);

  const cargarTab = useCallback(async (tab: string, cleanDni: string) => {
    if (!cleanDni) return;
    setLoadingDatos(true);
    if (tab === 'documentos') {
      await apiFetch<any>(`/documents?dni=${cleanDni}&limit=100`)
        .then(r => setDocumentos(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setDocumentos([]));
    } else if (tab === 'resoluciones') {
      await apiFetch<any>(`/resoluciones?dni=${cleanDni}&limit=100&sort=-fecha`)
        .then(r => setResoluciones(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setResoluciones([]));
    } else if (tab === 'expedientes') {
      await apiFetch<any>(`/eventos?dni=${cleanDni}&limit=50`)
        .then(r => setExpedientes(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setExpedientes([]));
    }
    setLoadedTabs(prev => new Set([...prev, tab]));
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
    setLoadedTabs(new Set());
    setTablaTab('consultas');
    setTablaPage(1);
    setFotoUrl(null);
    setFotoExpandida(false);
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
      // Cargar foto del agente (silencioso si no tiene)
      apiFetchBlob(`/agentes/${clean}/foto`)
        .then(blob => setFotoUrl(URL.createObjectURL(blob)))
        .catch(() => setFotoUrl(null));
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

  const sortedConsultas   = [...consultas].sort((a,b) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime());
  const sortedPedidos     = [...pedidos].sort((a,b) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime());
  const sortedDocumentos  = [...documentos].sort((a,b) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime());
  const sortedResoluciones = [...resoluciones].sort((a,b) => new Date(b.fecha||b.created_at||0).getTime() - new Date(a.fecha||a.created_at||0).getTime());
  const sortedExpedientes = [...expedientes].sort((a,b) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime());

  const tablaData = tablaTab === 'consultas'    ? sortedConsultas
    : tablaTab === 'pedidos'      ? sortedPedidos
    : tablaTab === 'documentos'   ? sortedDocumentos
    : tablaTab === 'resoluciones' ? sortedResoluciones
    : sortedExpedientes;

  const abrirArchivo = async (id: number, nombre: string) => {
    setLoadingArchivo(id);
    try {
      const { blob, contentType } = await apiFetchBlobWithMeta(`/documents/${id}/file`);
      const url = URL.createObjectURL(blob);
      setVisorArchivo({ url, nombre, tipo: contentType });
    } catch {
      toast.error('Error al abrir archivo', 'No se pudo cargar el documento');
    } finally {
      setLoadingArchivo(null);
    }
  };
  const totalTablaPages = Math.max(1, Math.ceil(tablaData.length / TABLA_PAGE_SIZE));
  const curTablaPage    = Math.min(tablaPage, totalTablaPages);
  const tablaRows       = tablaData.slice((curTablaPage - 1) * TABLA_PAGE_SIZE, curTablaPage * TABLA_PAGE_SIZE);

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
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {fotoUrl && (
                    <>
                      <img
                        src={fotoUrl}
                        alt={`${row.apellido}, ${row.nombre}`}
                        onError={() => setFotoUrl(null)}
                        onClick={() => setFotoExpandida(true)}
                        style={{ width: 100, minWidth: 100, height: 110, objectFit: 'cover', objectPosition: 'center 48%', borderRadius: 8, border: '2px solid rgba(255,255,255,0.15)', cursor: 'zoom-in' }}
                      />
                      {fotoExpandida && (
                        <div
                          onClick={() => setFotoExpandida(false)}
                          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
                        >
                          <img
                            src={fotoUrl}
                            alt={`${row.apellido}, ${row.nombre}`}
                            style={{ maxHeight: '85vh', maxWidth: '85vw', borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
                          />
                        </div>
                      )}
                    </>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                </div>
              </div>
            )}

            {row && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <ResumenCard icon="💬" label="Consultas" total={consultas.length} pendiente={consultasHoy > 0 ? consultasHoy : undefined} color="#6366f1" loading={loadingDatos} />
                <ResumenCard icon="📋" label="Pedidos" total={pedidos.length} pendiente={pendientePedidos} color="#f59e0b" loading={loadingDatos} />
                <ResumenCard icon="📂" label="Docs" total={documentos.length} color="#10b981" loading={loadingDatos} />
                <ResumenCard icon="📁" label="Expeds." total={expedientes.length} pendiente={expedientes.filter((e: any) => e.estado === 'abierto' || e.estado === 'pendiente').length} color="#8b5cf6" loading={loadingDatos} />
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

            {/* ── Escanear documento (debajo del formulario) ── */}
            {row && (
              <div className="ap-mt-16">
                <button className="btn ap-btn-emitir" type="button" onClick={() => navigate(`/app/escaneo-agente/${row.dni}`)}>
                  📷 Escanear documento — {row.apellido}, {row.nombre}
                </button>
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

            {/* ── Citación activa (tarjeta persistente) ── */}
            {row && !loadingDatos && citacion && (
              <div className="card ap-card" style={{ border: '2px solid #ef4444', background: 'rgba(239,68,68,0.07)' }}>
                <div className="ap-alert-title" style={{ color: '#ef4444' }}>🔔 Citación Activa</div>
                <div style={{ fontSize: '0.83rem', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                  <div><b>Motivo:</b> {citacion.motivo || '—'}</div>
                  <div><b>Citado por:</b> {citacion.citado_por || '—'}</div>
                  <div><b>Fecha:</b> {fmtDateTime(citacion.fecha_citacion)}</div>
                </div>
              </div>
            )}

            {row && !loadingDatos && pendientePedidos > 0 && (
              <div className="card ap-card ap-alert-card">
                <div className="ap-alert-title">⚠️ {pendientePedidos} pedido(s) pendiente(s)</div>
                {pedidos.filter((t: any) => t.estado === 'pendiente').slice(0, 10).map((t: any) => (
                  <div key={t.id}>
                    <div
                      className="ap-tramite-item"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setExpandedPedidoId(expandedPedidoId === t.id ? null : t.id)}
                    >
                      <span className="badge pend">PENDIENTE</span>
                      <b style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expandedPedidoId === t.id ? 'normal' : 'nowrap' }}>
                        {t.pedido || t.descripcion}
                      </b>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginLeft: 6 }}>{expandedPedidoId === t.id ? '▲' : '▼'}</span>
                    </div>
                    {expandedPedidoId === t.id && (
                      <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '8px 12px', margin: '4px 0 6px', fontSize: '0.82rem' }}>
                        <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: 4 }}>Detalle del pedido</div>
                        <div style={{ color: '#e2e8f0', wordBreak: 'break-word', lineHeight: 1.6 }}>{t.pedido || t.descripcion || '—'}</div>
                        {t.observacion && <div style={{ color: '#94a3b8', marginTop: 4, fontStyle: 'italic' }}>{t.observacion}</div>}
                        {t.lugar && <div style={{ color: '#94a3b8', marginTop: 2, fontSize: '0.76rem' }}>Lugar: {t.lugar}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {row && !loadingDatos && pendientePedidos === 0 && (
              <div className="ap-tramites-ok">✅ Sin trámites pendientes</div>
            )}

            {row && (
              <div className="card ap-card">
                <h3 className="ap-section-title">📊 Registros</h3>
                <div className="ap-tabla-tabs">
                  {([
                    ['consultas',    '💬 Consultas',     sortedConsultas.length],
                    ['pedidos',      '📋 Pedidos',        sortedPedidos.length],
                    ['documentos',   '📂 Documentos',    sortedDocumentos.length],
                    ['resoluciones', '📜 Resoluciones',  sortedResoluciones.length],
                    ['expedientes',  '📁 Expedientes',   sortedExpedientes.length],
                  ] as [typeof tablaTab, string, number][]).map(([t, label, count]) => (
                    <button key={t} className={`ap-tabla-tab${tablaTab === t ? ' active' : ''}`}
                      onClick={() => {
                        setTablaTab(t); setTablaPage(1); setExpandedPedidoId(null);
                        if (!loadedTabs.has(t) && row?.dni) {
                          cargarTab(t, String(row.dni).replace(/\D/g, ''));
                        }
                      }}>
                      {label}
                      {count > 0 && <span className="ap-tab-count">{count}</span>}
                    </button>
                  ))}
                </div>

                {loadingDatos ? (
                  <div className="ap-tabla-loading">🔄 Cargando datos…</div>
                ) : tablaData.length === 0 ? (
                  <div className="ap-tabla-empty">Sin registros</div>
                ) : (
                  <>
                    <div className="ap-tabla-container">
                      <table className="ap-tabla">
                        <thead>
                          <tr>
                            <th>#</th>
                            {tablaTab === 'consultas'    && <><th>Motivo</th><th>Estado</th><th>Fecha</th></>}
                            {tablaTab === 'pedidos'      && <><th>Pedido</th><th>Estado</th><th>Fecha</th></>}
                            {tablaTab === 'documentos'   && <><th>Nombre</th><th>Tipo</th><th>Fecha</th></>}
                            {tablaTab === 'resoluciones' && <><th>Motivo</th><th>Número</th><th>Fecha</th></>}
                            {tablaTab === 'expedientes'  && <><th>Tipo</th><th>Estado</th><th>Fecha</th></>}
                          </tr>
                        </thead>
                        <tbody>
                          {tablaRows.map((item: any) => {
                            const isExp = expandedPedidoId === item.id;
                            return (
                              <React.Fragment key={item.id}>
                                <tr
                                  style={{ cursor: 'pointer', background: isExp ? 'rgba(99,102,241,0.12)' : undefined }}
                                  onClick={() => setExpandedPedidoId(isExp ? null : item.id)}
                                >
                                  <td className="ap-tabla-id">{item.id}</td>
                                  {tablaTab === 'consultas' && <>
                                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isExp ? 'normal' : 'nowrap' }}>
                                      {item.motivo_consulta || item.motivo || '—'}
                                    </td>
                                    <td><span className={`ap-estado-badge ${item.estado === 'pendiente' ? 'pend' : 'ok'}`}>{item.estado || '—'}</span></td>
                                    <td className="muted ap-tabla-fecha">{fmtDateShort(item.created_at)}</td>
                                  </>}
                                  {tablaTab === 'pedidos' && <>
                                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isExp ? 'normal' : 'nowrap' }}>
                                      {item.pedido || item.descripcion || '—'}
                                    </td>
                                    <td><span className={`ap-estado-badge ${item.estado === 'pendiente' ? 'pend' : 'ok'}`}>{item.estado || '—'}</span></td>
                                    <td className="muted ap-tabla-fecha">{fmtDateShort(item.created_at)}</td>
                                  </>}
                                  {tablaTab === 'documentos' && <>
                                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {item.nombre || item.nombre_archivo_original || `Doc #${item.id}`}
                                    </td>
                                    <td><span className="ap-tipo-badge">{item.tipo || '—'}</span></td>
                                    <td className="muted ap-tabla-fecha">{fmtDateShort(item.created_at || item.fecha)}</td>
                                  </>}
                                  {tablaTab === 'resoluciones' && <>
                                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isExp ? 'normal' : 'nowrap' }}>
                                      {item.motivo || '—'}
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.76rem' }}>{item.numero || '—'}</td>
                                    <td className="muted ap-tabla-fecha">{fmtDateShort(item.fecha || item.created_at)}</td>
                                  </>}
                                  {tablaTab === 'expedientes' && <>
                                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isExp ? 'normal' : 'nowrap' }}>
                                      {item.tipo || item.descripcion || item.titulo || '—'}
                                    </td>
                                    <td><span className={`ap-estado-badge ${['abierto','pendiente'].includes(item.estado) ? 'pend' : 'ok'}`}>{item.estado || '—'}</span></td>
                                    <td className="muted ap-tabla-fecha">{fmtDateShort(item.created_at || item.fecha)}</td>
                                  </>}
                                </tr>
                                {/* Fila expandida */}
                                {isExp && (
                                  <tr>
                                    <td colSpan={4} style={{ padding: 0 }}>
                                      <div style={{ background: 'rgba(99,102,241,0.07)', borderLeft: '3px solid #6366f1', padding: '10px 14px', fontSize: '0.82rem', lineHeight: 1.7 }}>
                                        {tablaTab === 'consultas' && <>
                                          <div><b>Motivo completo:</b> {item.motivo_consulta || item.motivo || '—'}</div>
                                          {item.explicacion && <div><b>Explicación:</b> {item.explicacion}</div>}
                                          {item.atendido_por && <div><b>Atendido por:</b> {item.atendido_por}</div>}
                                          <div className="muted">{fmtDateTime(item.created_at)}</div>
                                        </>}
                                        {tablaTab === 'pedidos' && <>
                                          <div><b>Pedido:</b> {item.pedido || item.descripcion || '—'}</div>
                                          {item.observacion && <div><b>Observación:</b> {item.observacion}</div>}
                                          {item.lugar && <div><b>Lugar:</b> {item.lugar}</div>}
                                          {item.baja_por_nombre && <div style={{ color: '#fca5a5' }}><b>Baja por:</b> {item.baja_por_nombre}</div>}
                                          <div className="muted">{fmtDateTime(item.created_at)}</div>
                                        </>}
                                        {tablaTab === 'documentos' && <>
                                          <div><b>Nombre:</b> {item.nombre || item.nombre_archivo_original || '—'}</div>
                                          <div><b>Tipo:</b> {item.tipo || '—'}</div>
                                          {item.descripcion_archivo && <div><b>Descripción:</b> {item.descripcion_archivo}</div>}
                                          {item.escaneado_por && <div><b>Escaneado por:</b> {item.escaneado_por}</div>}
                                          {item.ruta && !/^\d+$/.test(String(item.ruta).trim()) && (
                                            <button
                                              className="btn"
                                              style={{ marginTop: 6, fontSize: '0.74rem', background: 'rgba(99,102,241,0.2)', color: '#a5b4fc' }}
                                              disabled={loadingArchivo === item.id}
                                              onClick={e => { e.stopPropagation(); abrirArchivo(item.id, item.nombre || item.nombre_archivo_original || `Doc #${item.id}`); }}
                                            >
                                              {loadingArchivo === item.id ? '⏳ Cargando…' : '📎 Ver archivo'}
                                            </button>
                                          )}
                                          {(!item.ruta || /^\d+$/.test(String(item.ruta).trim())) && (
                                            <div className="muted" style={{ marginTop: 4, fontSize: '0.74rem' }}>📁 Documento histórico sin archivo digital</div>
                                          )}
                                          <div className="muted" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at || item.fecha)}</div>
                                        </>}
                                        {tablaTab === 'resoluciones' && <>
                                          <div><b>Motivo:</b> {item.motivo || '—'}</div>
                                          {item.numero && <div><b>Número:</b> {item.numero}</div>}
                                          {item.observaciones && <div><b>Observaciones:</b> {item.observaciones}</div>}
                                          <div className="muted">{fmtDateTime(item.fecha || item.created_at)}</div>
                                        </>}
                                        {tablaTab === 'expedientes' && <>
                                          <div><b>Tipo:</b> {item.tipo || '—'}</div>
                                          {item.descripcion && <div><b>Descripción:</b> {item.descripcion}</div>}
                                          {item.titulo && <div><b>Título:</b> {item.titulo}</div>}
                                          <div className="muted">{fmtDateTime(item.created_at || item.fecha)}</div>
                                        </>}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Paginación */}
                    {totalTablaPages > 1 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: '0.78rem' }}>
                        <button className="btn" style={{ fontSize: '0.74rem', padding: '3px 10px' }}
                          disabled={curTablaPage <= 1} onClick={() => setTablaPage(p => p - 1)}>‹ Ant.</button>
                        <span className="muted">Pág. {curTablaPage} / {totalTablaPages} · {tablaData.length} registros</span>
                        <button className="btn" style={{ fontSize: '0.74rem', padding: '3px 10px' }}
                          disabled={curTablaPage >= totalTablaPages} onClick={() => setTablaPage(p => p + 1)}>Sig. ›</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

        </div>
      </Layout>

      {/* ── Visor de archivo inline ── */}
      {visorArchivo && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 900, background: '#1e293b', borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e2e8f0' }}>📎 {visorArchivo.nombre}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={visorArchivo.url} download={visorArchivo.nombre}
                  className="btn" style={{ fontSize: '0.74rem' }}
                  onClick={e => e.stopPropagation()}>⬇ Descargar</a>
                <button className="btn" style={{ fontSize: '0.74rem' }}
                  onClick={() => { URL.revokeObjectURL(visorArchivo.url); setVisorArchivo(null); }}>✕ Cerrar</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
              {visorArchivo.tipo.includes('pdf') ? (
                <iframe src={visorArchivo.url} style={{ width: '100%', height: '75vh', border: 'none', borderRadius: 8 }} title={visorArchivo.nombre} />
              ) : visorArchivo.tipo.includes('image') ? (
                <img src={visorArchivo.url} alt={visorArchivo.nombre} style={{ maxWidth: '100%', borderRadius: 8 }} />
              ) : (
                <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 8 }}>📄</div>
                  <div>No se puede previsualizar este tipo de archivo ({visorArchivo.tipo})</div>
                  <a href={visorArchivo.url} download={visorArchivo.nombre} style={{ color: '#818cf8', marginTop: 12, display: 'inline-block' }}>⬇ Descargar archivo</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

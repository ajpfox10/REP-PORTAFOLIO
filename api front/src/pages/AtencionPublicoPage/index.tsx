// src/pages/AtencionPublicoPage/index.tsx
// Página de Atención al Público — Ventanilla / Mostrador
// Permite recibir agentes, registrar motivo de consulta y emitir ticket imprimible.

import React, { useState, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { loadSession } from '../../auth/session';
import './styles/AtencionPublicoPage.css';


// ─── Motivos predefinidos ──────────────────────────────────────────────────────
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

// ─── Formatos de fecha/hora ────────────────────────────────────────────────────
function fmtDateTime(dt?: string) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dt; }
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ─── Ticket imprimible ────────────────────────────────────────────────────────
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

// ─── Componente principal ─────────────────────────────────────────────────────
export function AtencionPublicoPage() {
  const toast = useToast();
  const [horaAtencion, setHoraAtencion] = useState('')
  // Búsqueda de agente
  const [dni, setDni] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);

  // Módulo tramites (pedidos pendientes del agente)
  const [tramites, setTramites] = useState<any[]>([]);
  const [loadingTramites, setLoadingTramites] = useState(false);

  // Formulario de consulta
  const [motivoSeleccionado, setMotivoSeleccionado] = useState('');
  const [explicacion, setExplicacion] = useState('');
  const [leyenda, setLeyenda] = useState('');
  const [savingConsulta, setSavingConsulta] = useState(false);

  // Ticket emitido
  const [ticketEmitido, setTicketEmitido] = useState<any>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  // ── Búsqueda por DNI ──────────────────────────────────────────────────────
  const buscarPorDni = useCallback(async (dniOverride?: string) => {
    const clean = (dniOverride ?? dni).replace(/\D/g, '');
    if (!clean) { toast.error('DNI inválido', 'Ingresá un DNI válido'); return; }
    setLoading(true);
    setRow(null);
    setMatches([]);
    setTramites([]);
    setTicketEmitido(null);
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

      // Auto-cargar tramites pendientes
      cargarTramites(clean);
    } catch (e: any) {
      toast.error('Error al buscar agente', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [dni]);

  const buscarPorNombre = useCallback(async () => {
    const q = fullName.trim();
    if (!q) { toast.error('Ingresá apellido y/o nombre'); return; }
    setLoading(true);
    setMatches([]);
    setRow(null);
    setTramites([]);
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

  // ── Cargar trámites (pedidos) pendientes ──────────────────────────────────
  const cargarTramites = useCallback(async (cleanDni: string) => {
    if (!cleanDni) return;
    setLoadingTramites(true);
    try {
      const res = await apiFetch<any>(`/pedidos?dni=${cleanDni}&limit=100&page=1`);
      const data = Array.isArray(res?.data) ? res.data : [];
      // Solo pendientes o recientes
      setTramites(data);
    } catch {
      setTramites([]);
    } finally {
      setLoadingTramites(false);
    }
  }, []);

  // ── Guardar consulta y emitir ticket ──────────────────────────────────────
  const emitirTicket = useCallback(async () => {
    if (!row?.dni) { toast.error('Primero buscá un agente'); return; }
    if (!motivoSeleccionado) { toast.error('Seleccioná un motivo de consulta'); return; }

    const motivoLabel = MOTIVOS_PREDEFINIDOS.find(m => m.value === motivoSeleccionado)?.label ?? motivoSeleccionado;
    const motivoFinal = motivoSeleccionado === 'otro'
      ? explicacion.trim() || 'Otro'
      : `${motivoLabel}${explicacion.trim() ? ` — ${explicacion.trim()}` : ''}`;

    const s = loadSession();
    const u: any = s?.user || {};
    const operador = u?.email || u?.id || 'anon';

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

      const ticket = {
        id: consultaId,
        agente: `${row.apellido ?? ''}, ${row.nombre ?? ''}`.trim(),
        dni: row.dni,
        motivo_label: motivoLabel,
        explicacion: explicacion.trim(),
        hora_atencion: nowHHMM(),
        leyenda: leyenda.trim(),
        tramitesPendientes: tramites.filter((t: any) => t.estado === 'pendiente'),
        operador,
        fecha: new Date().toISOString(),
      };

      setTicketEmitido(ticket);
      toast.ok('Consulta registrada', 'Ticket listo para imprimir');

      // Reset formulario pero mantener agente
      setMotivoSeleccionado('');
      setExplicacion('');
      setLeyenda('');

    } catch (e: any) {
      toast.error('Error al guardar consulta', e?.message || 'Error');
    } finally {
      setSavingConsulta(false);
    }
  }, [row, motivoSeleccionado, explicacion, horaAtencion, leyenda, tramites]);

  // ── Imprimir ticket ───────────────────────────────────────────────────────
  const imprimirTicket = useCallback(() => {
    if (!ticketEmitido) return;
    window.print();
  }, [ticketEmitido]);

  const cleanDni = row?.dni ? String(row.dni).replace(/\D/g, '') : '';
  const tramitesPendientes = tramites.filter((t: any) => t.estado === 'pendiente');

  return (
    <Layout title="Atención al Público" showBack>
      <div className="ap-layout">

        {/* ── COLUMNA IZQUIERDA: Búsqueda + Agente + Formulario ── */}
        <div className="ap-left">

          {/* Búsqueda */}
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

          {/* Lista de coincidencias */}
          {matches.length > 0 && (
            <div className="card ap-card">
              <div className="muted ap-label">Resultados ({matches.length})</div>
              <div className="ap-matches">
                {matches.map((m: any) => (
                  <button
                    key={m.dni}
                    className="ap-match-item"
                    onClick={() => seleccionarMatch(m)}
                  >
                    <b>{m.apellido}, {m.nombre}</b>
                    <span className="badge" style={{ marginLeft: 8 }}>{m.dni}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Info del agente */}
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

              {/* Alerta trámites pendientes */}
              {loadingTramites && (
                <div className="ap-tramites-loading">🔄 Verificando trámites pendientes…</div>
              )}
              {!loadingTramites && tramitesPendientes.length > 0 && (
                <div className="ap-tramites-alert">
                  <div className="ap-tramites-alert-title">
                    ⚠️ Este agente tiene {tramitesPendientes.length} trámite(s) pendiente(s)
                  </div>
                  {tramitesPendientes.map((t: any, i: number) => (
                    <div key={i} className="ap-tramite-item">
                      <span className="badge pend">PENDIENTE</span>
                      <b>{t.pedido}</b>
                      {t.observacion && <span className="muted"> — {t.observacion}</span>}
                    </div>
                  ))}
                </div>
              )}
              {!loadingTramites && tramitesPendientes.length === 0 && tramites.length >= 0 && row && (
                <div className="ap-tramites-ok">✅ Sin trámites pendientes</div>
              )}
            </div>
          )}

          {/* Formulario de consulta */}
          {row && (
            <div className="card ap-card">
              <h3 className="ap-section-title">📋 Registrar Consulta</h3>

              {/* Motivos predefinidos */}
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

              {/* Explicación adicional */}
              <div className="muted ap-label ap-mt-12">
                {motivoSeleccionado === 'otro' ? 'Descripción del motivo *' : 'Explicación adicional (opcional)'}
              </div>
              <textarea
                className="input ap-textarea"
                value={explicacion}
                onChange={e => setExplicacion(e.target.value)}
                placeholder={
                  motivoSeleccionado === 'otro'
                    ? 'Describí el motivo de la consulta…'
                    : 'Detalles adicionales, aclaraciones, etc.'
                }
                rows={3}
              />

              {/* Leyenda */}
              <div className="muted ap-label ap-mt-12">Leyenda del ticket (opcional)</div>
              <input
                className="input"
                value={leyenda}
                onChange={e => setLeyenda(e.target.value)}
                placeholder="Ej: Traer documentación el próximo turno. Consultar por haberes."
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

        {/* ── COLUMNA DERECHA: Ticket + Tramites ── */}
        <div className="ap-right">

          {/* Ticket emitido */}
          {ticketEmitido ? (
            <div className="card ap-card ap-ticket-wrapper" ref={ticketRef}>
              <div className="row ap-row-between ap-mb-12">
                <h3 className="ap-section-title" style={{ margin: 0 }}>🎫 Ticket Emitido</h3>
                <button className="btn" onClick={imprimirTicket} type="button">
                  🖨️ Imprimir
                </button>
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

          {/* Lista de todos los tramites del agente */}
          {row && tramites.length > 0 && (
            <div className="card ap-card">
              <h3 className="ap-section-title">📌 Trámites del Agente</h3>
              <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 10 }}>
                Últimos {tramites.length} registros
              </div>
              <div className="ap-tramites-list">
                {tramites.slice(0, 20).map((t: any, i: number) => (
                  <div key={i} className={`ap-tramite-row ${t.estado === 'pendiente' ? 'pend' : ''}`}>
                    <div className="ap-tramite-main">
                      <b>{t.pedido}</b>
                      <span className={`badge ${t.estado === 'pendiente' ? 'pend' : ''}`}>{t.estado}</span>
                    </div>
                    {t.observacion && <div className="muted ap-tramite-obs">{t.observacion}</div>}
                    <div className="muted" style={{ fontSize: '0.72rem' }}>{fmtDateTime(t.created_at)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

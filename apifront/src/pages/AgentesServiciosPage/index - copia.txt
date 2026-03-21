// src/pages/AgentesServiciosPage/index.tsx
// Página: Agentes por Servicio
// - Filtros: sector, servicio, agente (DNI/nombre)
// - Tabla paginada de pases (agentes_servicios)
// - Historial de pases por agente (modal)
// - Bloqueo: si el agente tiene un servicio sin cerrar, no se puede cargar nuevo
// - Acceso: solo crud:*:* (salud laboral NO lo ve)

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import './styles/AgentesServiciosPage.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(dt?: string | null) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return dt; }
}
function fmtDateTime(dt?: string | null) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return dt; }
}

const PAGE_SIZE = 20;

// ─── Modal historial de pases ─────────────────────────────────────────────────
interface PasesModalProps {
  dni: number | string;
  nombre: string;
  onClose: () => void;
}
function PasesModal({ dni, nombre, onClose }: PasesModalProps) {
  const [pases, setPases]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<any>(`/crud/agentes_servicios?dni=${dni}&sort=-fecha_desde&limit=100`)
      .then(r => setPases(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setPases([]))
      .finally(() => setLoading(false));
  }, [dni]);

  return (
    <div className="asv-modal-overlay" onClick={onClose}>
      <div className="asv-modal" onClick={e => e.stopPropagation()}>
        <div className="asv-modal-header">
          <div>
            <div className="asv-modal-title">📋 Historial de Pases</div>
            <div className="asv-modal-sub">{nombre} · DNI {dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">✕ Cerrar</button>
        </div>

        {loading ? (
          <div className="asv-loading">🔄 Cargando historial…</div>
        ) : pases.length === 0 ? (
          <div className="asv-empty">Sin pases registrados</div>
        ) : (
          <div className="asv-modal-body">
            <div className="asv-timeline">
              {pases.map((p: any, i: number) => {
                const abierto = !p.fecha_hasta;
                return (
                  <div key={p.id ?? i} className={`asv-timeline-item${abierto ? ' asv-abierto' : ''}`}>
                    <div className="asv-timeline-dot" />
                    <div className="asv-timeline-content">
                      <div className="asv-timeline-head">
                        <span className="asv-timeline-servicio">{p.nombre || p.servicio_nombre || `Servicio #${p.servicio_id ?? '?'}`}</span>
                        <span className={`badge ${abierto ? 'asv-badge-open' : 'asv-badge-closed'}`}>
                          {abierto ? '🟢 ACTIVO' : '⬜ Cerrado'}
                        </span>
                      </div>
                      <div className="asv-timeline-dates">
                        <span>Desde: <b>{fmtDate(p.fecha_desde)}</b></span>
                        {p.fecha_hasta && <span>Hasta: <b>{fmtDate(p.fecha_hasta)}</b></span>}
                        {abierto && <span className="asv-abierto-label">Sin fecha de cierre</span>}
                      </div>
                      {p.motivo && <div className="asv-timeline-motivo">Motivo: {p.motivo}</div>}
                      {p.jefe_nombre && <div className="asv-timeline-jefe">Jefe: {p.jefe_nombre}</div>}
                      {p.observaciones && <div className="asv-timeline-obs">{p.observaciones}</div>}
                      <div className="asv-timeline-meta">Registrado: {fmtDateTime(p.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal nuevo pase ─────────────────────────────────────────────────────────
interface NuevoPaseModalProps {
  agente: any; // { dni, apellido, nombre }
  servicios: any[];
  dependencias: any[];
  onClose: () => void;
  onSaved: () => void;
}
function NuevoPaseModal({ agente, servicios, dependencias, onClose, onSaved }: NuevoPaseModalProps) {
  const toast = useToast();
  const [form, setForm] = useState({
    servicio_id: '',
    dependencia_id: '',
    fecha_desde: '',
    motivo: '',
    jefe_nombre: '',
    observaciones: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const guardar = async () => {
    if (!form.servicio_id) { toast.error('Seleccioná un servicio'); return; }
    if (!form.fecha_desde) { toast.error('Ingresá fecha de inicio'); return; }
    setSaving(true);
    try {
      await apiFetch<any>('/crud/agentes_servicios', {
        method: 'POST',
        body: JSON.stringify({
          dni: agente.dni,
          servicio_id: Number(form.servicio_id),
          dependencia_id: form.dependencia_id ? Number(form.dependencia_id) : null,
          fecha_desde: form.fecha_desde,
          motivo: form.motivo || null,
          jefe_nombre: form.jefe_nombre || null,
          observaciones: form.observaciones || null,
        }),
      });
      toast.ok('Pase registrado', `Nuevo servicio para ${agente.apellido}, ${agente.nombre}`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al guardar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="asv-modal-overlay" onClick={onClose}>
      <div className="asv-modal asv-modal-form" onClick={e => e.stopPropagation()}>
        <div className="asv-modal-header">
          <div>
            <div className="asv-modal-title">➕ Nuevo Pase</div>
            <div className="asv-modal-sub">{agente.apellido}, {agente.nombre} · DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">✕</button>
        </div>
        <div className="asv-modal-body">
          <div className="asv-form-grid">
            <div className="asv-field">
              <label className="asv-label">Servicio *</label>
              <select className="input" value={form.servicio_id} onChange={e => set('servicio_id', e.target.value)}>
                <option value="">— Seleccioná —</option>
                {servicios.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `Servicio #${s.id}`}</option>
                ))}
              </select>
            </div>
            <div className="asv-field">
              <label className="asv-label">Dependencia</label>
              <select className="input" value={form.dependencia_id} onChange={e => set('dependencia_id', e.target.value)}>
                <option value="">— Ninguna —</option>
                {dependencias.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
            </div>
            <div className="asv-field">
              <label className="asv-label">Fecha desde *</label>
              <input type="date" className="input" value={form.fecha_desde} onChange={e => set('fecha_desde', e.target.value)} />
            </div>
            <div className="asv-field">
              <label className="asv-label">Jefe / Responsable</label>
              <input type="text" className="input" value={form.jefe_nombre} onChange={e => set('jefe_nombre', e.target.value)} placeholder="Nombre del jefe" />
            </div>
            <div className="asv-field asv-field-full">
              <label className="asv-label">Motivo del pase</label>
              <input type="text" className="input" value={form.motivo} onChange={e => set('motivo', e.target.value)} placeholder="Ej: Traslado, reubicación, etc." />
            </div>
            <div className="asv-field asv-field-full">
              <label className="asv-label">Observaciones</label>
              <textarea className="input" rows={2} value={form.observaciones} onChange={e => set('observaciones', e.target.value)} placeholder="Observaciones adicionales…" />
            </div>
          </div>
          <div className="asv-modal-actions">
            <button className="btn" onClick={onClose} type="button" disabled={saving}>Cancelar</button>
            <button className="btn asv-btn-save" onClick={guardar} disabled={saving} type="button">
              {saving ? '⏳ Guardando…' : '💾 Guardar Pase'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal cerrar pase ────────────────────────────────────────────────────────
interface CerrarPaseModalProps {
  pase: any;
  onClose: () => void;
  onSaved: () => void;
}
function CerrarPaseModal({ pase, onClose, onSaved }: CerrarPaseModalProps) {
  const toast = useToast();
  const [fechaHasta, setFechaHasta] = useState('');
  const [saving, setSaving] = useState(false);

  const cerrar = async () => {
    if (!fechaHasta) { toast.error('Ingresá fecha de cierre'); return; }
    setSaving(true);
    try {
      await apiFetch<any>(`/crud/agentes_servicios/${pase.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fecha_hasta: fechaHasta }),
      });
      toast.ok('Pase cerrado correctamente');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al cerrar pase', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="asv-modal-overlay" onClick={onClose}>
      <div className="asv-modal asv-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="asv-modal-header">
          <div className="asv-modal-title">🔒 Cerrar Pase Activo</div>
          <button className="btn" onClick={onClose} type="button">✕</button>
        </div>
        <div className="asv-modal-body">
          <div className="asv-info-row"><b>DNI:</b> {pase.dni}</div>
          <div className="asv-info-row"><b>Servicio:</b> {pase.nombre || pase.servicio_nombre}</div>
          <div className="asv-info-row"><b>Desde:</b> {fmtDate(pase.fecha_desde)}</div>
          <div className="asv-field asv-mt-12">
            <label className="asv-label">Fecha de cierre *</label>
            <input type="date" className="input" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
          </div>
          <div className="asv-modal-actions asv-mt-12">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn asv-btn-danger" onClick={cerrar} disabled={saving}>
              {saving ? '⏳…' : '🔒 Cerrar Pase'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function AgentesServiciosPage() {
  const toast = useToast();

  // Filtros
  const [filtroDni,        setFiltroDni]        = useState('');
  const [filtroNombre,     setFiltroNombre]      = useState('');
  const [filtroServicio,   setFiltroServicio]    = useState('');
  const [filtroDependencia,setFiltroDependencia] = useState('');
  const [filtroEstado,     setFiltroEstado]      = useState<'todos'|'activo'|'cerrado'>('todos');

  // Datos maestros (para combos)
  const [servicios,    setServicios]    = useState<any[]>([]);
  const [dependencias, setDependencias] = useState<any[]>([]);
  const [loadingMaestros, setLoadingMaestros] = useState(true);

  // Tabla
  const [rows,       setRows]       = useState<any[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(false);

  // Búsqueda por nombre (matches)
  const [matches,    setMatches]    = useState<any[]>([]);
  const [loadingNom, setLoadingNom] = useState(false);

  // Modales
  const [modalHistorial, setModalHistorial] = useState<any>(null); // { dni, nombre }
  const [modalNuevo,     setModalNuevo]     = useState<any>(null); // agente obj
  const [modalCerrar,    setModalCerrar]    = useState<any>(null); // pase obj

  // Agente seleccionado para nuevo pase
  const [agenteSeleccionado, setAgenteSeleccionado] = useState<any>(null);
  const [checkandoPase, setCheckandoPase] = useState(false);

  // ── Cargar maestros ───────────────────────────────────────────────────────
  useEffect(() => {
    Promise.allSettled([
      apiFetch<any>('/crud/servicios?limit=500').then(r => setServicios(Array.isArray(r?.data) ? r.data : [])),
      apiFetch<any>('/crud/reparticiones?limit=500').then(r => setDependencias(Array.isArray(r?.data) ? r.data : [])),
    ]).finally(() => setLoadingMaestros(false));
  }, []);

  // ── Cargar tabla ──────────────────────────────────────────────────────────
  const cargarTabla = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('page',  String(pageNum));
      params.set('sort',  '-created_at');

      if (filtroDni.trim())           params.set('dni', filtroDni.trim());
      if (filtroServicio)             params.set('servicio_id', filtroServicio);
      if (filtroDependencia)          params.set('dependencia_id', filtroDependencia);
      if (filtroEstado === 'activo')  params.set('fecha_hasta', 'null');    // sin fecha_hasta
      // filtroEstado === 'cerrado' → filtramos del lado cliente tras recibir datos

      const res = await apiFetch<any>(`/crud/agentes_servicios?${params.toString()}`);
      let data: any[] = Array.isArray(res?.data) ? res.data : [];

      // Filtro estado cerrado (fecha_hasta no nula)
      if (filtroEstado === 'activo')  data = data.filter((r: any) => !r.fecha_hasta);
      if (filtroEstado === 'cerrado') data = data.filter((r: any) => !!r.fecha_hasta);

      setRows(data);
      setTotal(res?.meta?.total ?? res?.total ?? data.length);
      setPage(pageNum);
    } catch (e: any) {
      toast.error('Error al cargar registros', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [filtroDni, filtroServicio, filtroDependencia, filtroEstado]);

  useEffect(() => { cargarTabla(1); }, [cargarTabla]);

  // ── Buscar por nombre ─────────────────────────────────────────────────────
  const buscarPorNombre = useCallback(async () => {
    const q = filtroNombre.trim();
    if (!q) return;
    setLoadingNom(true);
    setMatches([]);
    try {
      const res = await searchPersonal(q, 20);
      setMatches(res);
      if (!res.length) toast.error('Sin resultados', `No se encontró "${q}"`);
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error');
    } finally {
      setLoadingNom(false);
    }
  }, [filtroNombre]);

  const seleccionarMatch = useCallback((m: any) => {
    setFiltroDni(String(m.dni));
    setFiltroNombre('');
    setMatches([]);
  }, []);

  // ── Verificar pase abierto antes de abrir modal nuevo pase ────────────────
  const abrirNuevoPase = useCallback(async (agente: any) => {
    setCheckandoPase(true);
    try {
      const res = await apiFetch<any>(`/crud/agentes_servicios?dni=${agente.dni}&limit=100&sort=-fecha_desde`);
      const pases: any[] = Array.isArray(res?.data) ? res.data : [];
      const abierto = pases.find((p: any) => !p.fecha_hasta);
      if (abierto) {
        toast.error(
          '⛔ Pase activo sin cerrar',
          `El agente tiene un pase abierto en "${abierto.nombre || `Servicio #${abierto.servicio_id}`}" (desde ${fmtDate(abierto.fecha_desde)}). Cerralo antes de cargar uno nuevo.`
        );
        return;
      }
      setAgenteSeleccionado(agente);
      setModalNuevo(agente);
    } catch (e: any) {
      toast.error('Error al verificar pases', e?.message || 'Error');
    } finally {
      setCheckandoPase(false);
    }
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const nombreServicio = (row: any) =>
    row.nombre || servicios.find((s: any) => s.id === row.servicio_id)?.nombre || `#${row.servicio_id ?? '?'}`;
  const nombreDep = (row: any) =>
    row.dependencia_nombre || dependencias.find((d: any) => d.id === row.dependencia_id)?.nombre || '—';

  return (
    <Layout title="Agentes por Servicio" showBack>
      <div className="asv-layout">

        {/* ── PANEL DE FILTROS ── */}
        <div className="card asv-filters-card">
          <div className="asv-filters-title">🔍 Filtros</div>
          <div className="asv-filters-grid">

            {/* DNI */}
            <div className="asv-field">
              <label className="asv-label">DNI</label>
              <input
                className="input"
                value={filtroDni}
                onChange={e => setFiltroDni(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && cargarTabla(1)}
                placeholder="Número de DNI"
              />
            </div>

            {/* Buscar por nombre */}
            <div className="asv-field">
              <label className="asv-label">Apellido / Nombre</label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input"
                  value={filtroNombre}
                  onChange={e => setFiltroNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && buscarPorNombre()}
                  placeholder="Buscar por apellido"
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={buscarPorNombre} disabled={loadingNom || !filtroNombre.trim()} type="button">
                  {loadingNom ? '…' : '🔍'}
                </button>
              </div>
            </div>

            {/* Servicio */}
            <div className="asv-field">
              <label className="asv-label">Servicio</label>
              <select className="input" value={filtroServicio} onChange={e => setFiltroServicio(e.target.value)} disabled={loadingMaestros}>
                <option value="">Todos los servicios</option>
                {servicios.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `Servicio #${s.id}`}</option>
                ))}
              </select>
            </div>

            {/* Dependencia / Sector */}
            <div className="asv-field">
              <label className="asv-label">Dependencia / Sector</label>
              <select className="input" value={filtroDependencia} onChange={e => setFiltroDependencia(e.target.value)} disabled={loadingMaestros}>
                <option value="">Todas</option>
                {dependencias.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
            </div>

            {/* Estado */}
            <div className="asv-field">
              <label className="asv-label">Estado</label>
              <div className="asv-estado-btns">
                {(['todos', 'activo', 'cerrado'] as const).map(e => (
                  <button
                    key={e}
                    type="button"
                    className={`asv-estado-btn${filtroEstado === e ? ' active' : ''}`}
                    onClick={() => setFiltroEstado(e)}
                  >
                    {e === 'todos' ? '📋 Todos' : e === 'activo' ? '🟢 Activos' : '⬜ Cerrados'}
                  </button>
                ))}
              </div>
            </div>

            {/* Botón buscar */}
            <div className="asv-field asv-field-action">
              <button className="btn asv-btn-buscar" onClick={() => cargarTabla(1)} disabled={loading} type="button">
                {loading ? '🔄 Buscando…' : '🔍 Buscar'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setFiltroDni(''); setFiltroNombre(''); setFiltroServicio('');
                  setFiltroDependencia(''); setFiltroEstado('todos');
                }}
                type="button"
              >
                ✕ Limpiar
              </button>
            </div>
          </div>

          {/* Matches por nombre */}
          {matches.length > 0 && (
            <div className="asv-matches">
              <div className="asv-label asv-mt-8">Resultados ({matches.length}) — hacé clic para filtrar:</div>
              <div className="asv-matches-list">
                {matches.map((m: any) => (
                  <button key={m.dni} className="asv-match-item" onClick={() => seleccionarMatch(m)} type="button">
                    <b>{m.apellido}, {m.nombre}</b>
                    <span className="badge" style={{ marginLeft: 8 }}>{m.dni}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── TABLA ── */}
        <div className="card asv-table-card">
          <div className="asv-table-header">
            <div className="asv-table-title">
              📋 Registros
              {!loading && <span className="asv-total-badge">{total} total</span>}
            </div>
            <div className="asv-table-pag">
              <button className="btn" onClick={() => cargarTabla(page - 1)} disabled={page <= 1 || loading} type="button">‹ Anterior</button>
              <span className="asv-pag-info">Pág. {page} / {totalPages}</span>
              <button className="btn" onClick={() => cargarTabla(page + 1)} disabled={page >= totalPages || loading} type="button">Siguiente ›</button>
            </div>
          </div>

          {loading ? (
            <div className="asv-loading">🔄 Cargando registros…</div>
          ) : rows.length === 0 ? (
            <div className="asv-empty">Sin registros para los filtros seleccionados</div>
          ) : (
            <div className="asv-table-wrap">
              <table className="asv-table">
                <thead>
                  <tr>
                    <th>DNI</th>
                    <th>Agente</th>
                    <th>Servicio</th>
                    <th>Dependencia</th>
                    <th>Desde</th>
                    <th>Hasta</th>
                    <th>Estado</th>
                    <th>Motivo</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any) => {
                    const abierto = !row.fecha_hasta;
                    return (
                      <tr key={row.id} className={abierto ? 'asv-row-activo' : ''}>
                        <td className="asv-td-dni">{row.dni}</td>
                        <td className="asv-td-nombre">
                          {row.apellido && row.nombre
                            ? `${row.apellido}, ${row.nombre}`
                            : row.agente_nombre || '—'}
                        </td>
                        <td className="asv-td-servicio">{nombreServicio(row)}</td>
                        <td className="asv-td-dep">{nombreDep(row)}</td>
                        <td className="asv-td-fecha">{fmtDate(row.fecha_desde)}</td>
                        <td className="asv-td-fecha">{row.fecha_hasta ? fmtDate(row.fecha_hasta) : <span className="asv-abierto-label">Sin cierre</span>}</td>
                        <td>
                          <span className={`badge ${abierto ? 'asv-badge-open' : 'asv-badge-closed'}`}>
                            {abierto ? '🟢 Activo' : '⬜ Cerrado'}
                          </span>
                        </td>
                        <td className="asv-td-motivo">{row.motivo || '—'}</td>
                        <td className="asv-td-actions">
                          {/* Historial */}
                          <button
                            className="btn asv-btn-sm"
                            type="button"
                            title="Ver historial de pases"
                            onClick={() => setModalHistorial({
                              dni: row.dni,
                              nombre: row.apellido && row.nombre
                                ? `${row.apellido}, ${row.nombre}`
                                : row.agente_nombre || `DNI ${row.dni}`,
                            })}
                          >
                            🕑 Historial
                          </button>

                          {/* Cerrar pase activo */}
                          {abierto && (
                            <button
                              className="btn asv-btn-sm asv-btn-danger"
                              type="button"
                              title="Cerrar este pase"
                              onClick={() => setModalCerrar(row)}
                            >
                              🔒 Cerrar
                            </button>
                          )}

                          {/* Nuevo pase */}
                          {!abierto && (
                            <button
                              className="btn asv-btn-sm asv-btn-new"
                              type="button"
                              title="Agregar nuevo pase para este agente"
                              disabled={checkandoPase}
                              onClick={() => abrirNuevoPase({
                                dni: row.dni,
                                apellido: row.apellido || '',
                                nombre: row.nombre || '',
                              })}
                            >
                              ➕ Nuevo
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación inferior */}
          {!loading && totalPages > 1 && (
            <div className="asv-pag-bottom">
              <button className="btn" onClick={() => cargarTabla(page - 1)} disabled={page <= 1}>‹ Anterior</button>
              <span className="asv-pag-info">Pág. {page} / {totalPages}</span>
              <button className="btn" onClick={() => cargarTabla(page + 1)} disabled={page >= totalPages}>Siguiente ›</button>
            </div>
          )}
        </div>
      </div>

      {/* ── Modales ── */}
      {modalHistorial && (
        <PasesModal
          dni={modalHistorial.dni}
          nombre={modalHistorial.nombre}
          onClose={() => setModalHistorial(null)}
        />
      )}
      {modalNuevo && (
        <NuevoPaseModal
          agente={modalNuevo}
          servicios={servicios}
          dependencias={dependencias}
          onClose={() => setModalNuevo(null)}
          onSaved={() => cargarTabla(page)}
        />
      )}
      {modalCerrar && (
        <CerrarPaseModal
          pase={modalCerrar}
          onClose={() => setModalCerrar(null)}
          onSaved={() => cargarTabla(page)}
        />
      )}
    </Layout>
  );
}

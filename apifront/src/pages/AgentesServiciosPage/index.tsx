// src/pages/AgentesServiciosPage/index.tsx
// PÃ¡gina: Agentes por Servicio
// - Filtros: sector, servicio, agente (DNI/nombre)
// - Tabla paginada de pases (agentes_servicios)
// - Historial de pases por agente (modal)
// - Bloqueo: si el agente tiene un servicio sin cerrar, no se puede cargar nuevo
// - Acceso: solo crud:*:* (salud laboral NO lo ve)

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch, apiFetchBlob } from '../../api/http';
import { searchPersonal, getAllPersonal } from '../../api/searchPersonal';
import './styles/AgentesServiciosPage.css';

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmtDate(dt?: string | null) {
  if (!dt) return 'â€”';
  try {
    return new Date(dt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return dt; }
}
function fmtDateTime(dt?: string | null) {
  if (!dt) return 'â€”';
  try {
    return new Date(dt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return dt; }
}

const PAGE_SIZE = 20;

function normFilterText(v: any): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsFilterText(value: any, query: string): boolean {
  const q = normFilterText(query);
  if (!q) return true;
  return normFilterText(value).includes(q);
}

function catalogText(item: any, fallback: string): string {
  return item?.reparticion_nombre || item?.nombre || fallback;
}

function findCatalogIdByText(items: any[], query: string, fallbackPrefix: string): string {
  const q = normFilterText(query);
  if (!q) return '';
  const found = items.find((item: any) => normFilterText(catalogText(item, `${fallbackPrefix} #${item.id}`)) === q);
  return found?.id != null ? String(found.id) : '';
}

// â”€â”€â”€ Modal historial de pases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface PasesModalProps {
  dni: number | string;
  nombre: string;
  onClose: () => void;
}
function PasesModal({ dni, nombre, onClose }: PasesModalProps) {
  const [pases, setPases]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<any>(`/agentes_servicios?dni=${dni}&sort=-fecha_desde&limit=100`)
      .then(r => setPases(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setPases([]))
      .finally(() => setLoading(false));
  }, [dni]);

  return (
    <div className="asv-modal-overlay" onClick={onClose}>
      <div className="asv-modal" onClick={e => e.stopPropagation()}>
        <div className="asv-modal-header">
          <div>
            <div className="asv-modal-title">ðŸ“‹ Historial de Pases</div>
            <div className="asv-modal-sub">{nombre} Â· DNI {dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">âœ• Cerrar</button>
        </div>

        {loading ? (
          <div className="asv-loading">ðŸ”„ Cargando historialâ€¦</div>
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
                          {abierto ? 'ðŸŸ¢ ACTIVO' : 'â¬œ Cerrado'}
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

// â”€â”€â”€ Modal nuevo pase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    if (!form.servicio_id) { toast.error('SeleccionÃ¡ un servicio'); return; }
    if (!form.fecha_desde) { toast.error('IngresÃ¡ fecha de inicio'); return; }
    setSaving(true);
    try {
      await apiFetch<any>('/agentes_servicios', {
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
            <div className="asv-modal-title">âž• Nuevo Pase</div>
            <div className="asv-modal-sub">{agente.apellido}, {agente.nombre} Â· DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">âœ•</button>
        </div>
        <div className="asv-modal-body">
          <div className="asv-form-grid">
            <div className="asv-field">
              <label htmlFor="asv-srv" className="asv-label">Servicio *</label>
              <select id="asv-srv" name="servicio_id" className="input" value={form.servicio_id} onChange={e => set('servicio_id', e.target.value)}>
                <option value="">â€” SeleccionÃ¡ â€”</option>
                {servicios.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `Servicio #${s.id}`}</option>
                ))}
              </select>
            </div>
            <div className="asv-field">
              <label htmlFor="asv-dep" className="asv-label">Dependencia</label>
              <select id="asv-dep" name="dependencia_id" className="input" value={form.dependencia_id} onChange={e => set('dependencia_id', e.target.value)}>
                <option value="">â€” Ninguna â€”</option>
                {dependencias.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.reparticion_nombre || d.nombre || `#${d.id}`}</option>
                ))}
              </select>
            </div>
            <div className="asv-field">
              <label htmlFor="asv-fecha" className="asv-label">Fecha desde *</label>
              <input id="asv-fecha" name="fecha_desde" type="date" className="input" value={form.fecha_desde} onChange={e => set('fecha_desde', e.target.value)} />
            </div>
            <div className="asv-field">
              <label htmlFor="asv-jefe" className="asv-label">Jefe / Responsable</label>
              <input id="asv-jefe" name="jefe_nombre" type="text" className="input" value={form.jefe_nombre} onChange={e => set('jefe_nombre', e.target.value)} placeholder="Nombre del jefe" />
            </div>
            <div className="asv-field asv-field-full">
              <label htmlFor="asv-motivo" className="asv-label">Motivo del pase</label>
              <input id="asv-motivo" name="motivo" type="text" className="input" value={form.motivo} onChange={e => set('motivo', e.target.value)} placeholder="Ej: Traslado, reubicaciÃ³n, etc." />
            </div>
            <div className="asv-field asv-field-full">
              <label htmlFor="asv-obs" className="asv-label">Observaciones</label>
              <textarea id="asv-obs" name="observaciones" className="input" rows={2} value={form.observaciones} onChange={e => set('observaciones', e.target.value)} placeholder="Observaciones adicionalesâ€¦" />
            </div>
          </div>
          <div className="asv-modal-actions">
            <button className="btn" onClick={onClose} type="button" disabled={saving}>Cancelar</button>
            <button className="btn asv-btn-save" onClick={guardar} disabled={saving} type="button">
              {saving ? 'â³ Guardandoâ€¦' : 'ðŸ’¾ Guardar Pase'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ Modal cerrar pase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    if (!fechaHasta) { toast.error('IngresÃ¡ fecha de cierre'); return; }
    setSaving(true);
    try {
      await apiFetch<any>(`/agentes_servicios/${pase.id}`, {
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
          <div className="asv-modal-title">ðŸ”’ Cerrar Pase Activo</div>
          <button className="btn" onClick={onClose} type="button">âœ•</button>
        </div>
        <div className="asv-modal-body">
          <div className="asv-info-row"><b>DNI:</b> {pase.dni}</div>
          <div className="asv-info-row"><b>Servicio:</b> {pase.nombre || pase.servicio_nombre}</div>
          <div className="asv-info-row"><b>Desde:</b> {fmtDate(pase.fecha_desde)}</div>
          <div className="asv-field asv-mt-12">
            <label htmlFor="asv-cierre" className="asv-label">Fecha de cierre *</label>
            <input id="asv-cierre" name="fecha_hasta" type="date" className="input" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
          </div>
          <div className="asv-modal-actions asv-mt-12">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn asv-btn-danger" onClick={cerrar} disabled={saving}>
              {saving ? 'â³â€¦' : 'ðŸ”’ Cerrar Pase'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ Modal exportar antigÃ¼edad â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface ExportarAntiguedadModalProps {
  servicios: any[];
  dependencias: any[];
  initialServicio?: string;
  initialDependencia?: string;
  onClose: () => void;
}
function ExportarAntiguedadModal({
  servicios, dependencias, initialServicio, initialDependencia, onClose
}: ExportarAntiguedadModalProps) {
  const toast = useToast();
  const [soloActivos,    setSoloActivos]    = useState(true);
  const [servicioId,     setServicioId]     = useState(initialServicio || '');
  const [dependenciaId,  setDependenciaId]  = useState(initialDependencia || '');
  const [leyes,          setLeyes]          = useState<any[]>([]);
  const [leyId,          setLeyId]          = useState('');
  const [exporting,      setExporting]      = useState(false);

  useEffect(() => {
    apiFetch<any>('/leyes?limit=200')
      .then(r => setLeyes(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setLeyes([]));
  }, []);

  const exportar = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('solo_activos', soloActivos ? '1' : '0');
      if (servicioId)    params.set('servicio_id', servicioId);
      if (dependenciaId) params.set('dependencia_id', dependenciaId);
      if (leyId)         params.set('ley_id', leyId);

      const blob = await apiFetchBlob(`/antiguedad/excel?${params.toString()}`);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `antiguedad_servicios_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.ok('Excel generado', 'El archivo se descargÃ³ correctamente');
      onClose();
    } catch (e: any) {
      toast.error('Error al exportar', e?.message || 'Error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="asv-modal-overlay" onClick={onClose}>
      <div className="asv-modal asv-modal-form" onClick={e => e.stopPropagation()}>
        <div className="asv-modal-header">
          <div>
            <div className="asv-modal-title">ðŸ“Š Exportar AntigÃ¼edad a Excel</div>
            <div className="asv-modal-sub">Reporte por servicio y sector con antigÃ¼edad y ley</div>
          </div>
          <button className="btn" onClick={onClose} type="button">âœ•</button>
        </div>
        <div className="asv-modal-body">
          <div className="asv-form-grid">

            {/* Estado */}
            <div className="asv-field asv-field-full">
              <div className="asv-label">Estado de los pases</div>
              <div className="asv-estado-btns">
                <button
                  type="button"
                  className={`asv-estado-btn${soloActivos ? ' active' : ''}`}
                  onClick={() => setSoloActivos(true)}
                >
                  ðŸŸ¢ Solo activos (sin cierre)
                </button>
                <button
                  type="button"
                  className={`asv-estado-btn${!soloActivos ? ' active' : ''}`}
                  onClick={() => setSoloActivos(false)}
                >
                  ðŸ“‹ Todos (activos + cerrados)
                </button>
              </div>
            </div>

            {/* Servicio */}
            <div className="asv-field">
              <label htmlFor="exp-srv" className="asv-label">Filtrar por Servicio (opcional)</label>
              <select id="exp-srv" className="input" value={servicioId} onChange={e => setServicioId(e.target.value)}>
                <option value="">â€” Todos los servicios â€”</option>
                {servicios.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `#${s.id}`}</option>
                ))}
              </select>
            </div>

            {/* Sector / Dependencia */}
            <div className="asv-field">
              <label htmlFor="exp-dep" className="asv-label">Filtrar por Sector (opcional)</label>
              <select id="exp-dep" className="input" value={dependenciaId} onChange={e => setDependenciaId(e.target.value)}>
                <option value="">â€” Todos los sectores â€”</option>
                {dependencias.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.reparticion_nombre || d.nombre || `#${d.id}`}</option>
                ))}
              </select>
            </div>

            {/* Ley */}
            <div className="asv-field">
              <label htmlFor="exp-ley" className="asv-label">Filtrar por Ley (opcional)</label>
              <select id="exp-ley" className="input" value={leyId} onChange={e => setLeyId(e.target.value)}>
                <option value="">â€” Todas las leyes â€”</option>
                {leyes.map((l: any) => (
                  <option key={l.id} value={l.id}>{l.nombre || `Ley #${l.id}`}</option>
                ))}
              </select>
            </div>

            <div className="asv-field asv-field-full asv-export-info">
              <span className="asv-export-hint">
                â„¹ El Excel incluye una hoja de detalle (agrupada por servicio y sector) y una hoja de resumen con totales y promedios de antigÃ¼edad.
              </span>
            </div>
          </div>

          <div className="asv-modal-actions">
            <button className="btn" onClick={onClose} type="button" disabled={exporting}>Cancelar</button>
            <button className="btn asv-btn-export" onClick={exportar} disabled={exporting} type="button">
              {exporting ? 'â³ Generando Excelâ€¦' : 'â¬‡ Descargar Excel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ Componente principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function AgentesServiciosPage() {
  const toast = useToast();

  // Filtros
  const [filtroDni,        setFiltroDni]        = useState('');
  const [filtroNombre,     setFiltroNombre]      = useState('');
  const [filtroServicio,   setFiltroServicio]    = useState('');
  const [filtroServicioTexto, setFiltroServicioTexto] = useState('');
  const [filtroDependencia,setFiltroDependencia] = useState('');
  const [filtroDependenciaTexto, setFiltroDependenciaTexto] = useState('');
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

  // BÃºsqueda por nombre (matches)
  const [matches,    setMatches]    = useState<any[]>([]);
  const [loadingNom, setLoadingNom] = useState(false);

  // Modales
  const [modalHistorial,  setModalHistorial]  = useState<any>(null); // { dni, nombre }
  const [modalNuevo,      setModalNuevo]      = useState<any>(null); // agente obj
  const [modalCerrar,     setModalCerrar]     = useState<any>(null); // pase obj
  const [modalExportar,   setModalExportar]   = useState(false);

  // Mapa DNI â†’ { apellido, nombre } (cargado una vez, usa cache global de personal)
  const [personalMap, setPersonalMap] = useState<Record<string, { apellido: string; nombre: string }>>({});

  // Agente seleccionado para nuevo pase
  const [agenteSeleccionado, setAgenteSeleccionado] = useState<any>(null);
  const [checkandoPase, setCheckandoPase] = useState(false);

  // â”€â”€ Cargar maestros â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    Promise.allSettled([
      apiFetch<any>('/servicios?limit=500').then(r => setServicios(Array.isArray(r?.data) ? r.data : [])),
      apiFetch<any>('/reparticiones?limit=500').then(r => setDependencias(Array.isArray(r?.data) ? r.data : [])),
      // Cargar mapa DNIâ†’nombre de personal (usa cache global)
      getAllPersonal().then(all => {
        const map: Record<string, { apellido: string; nombre: string }> = {};
        for (const p of all) {
          if (p.dni != null) map[String(p.dni)] = { apellido: p.apellido || '', nombre: p.nombre || '' };
        }
        setPersonalMap(map);
      }),
    ]).finally(() => setLoadingMaestros(false));
  }, []);

  // â”€â”€ Cargar tabla â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const nombreServicio = useCallback((row: any) =>
    row.servicio_nombre || servicios.find((s: any) => s.id === row.servicio_id)?.nombre || row.nombre || `#${row.servicio_id ?? '?'}`,
  [servicios]);

  const nombreDep = useCallback((row: any) =>
    row.dependencia_nombre ||
    dependencias.find((d: any) => d.id === row.dependencia_id)?.reparticion_nombre ||
    dependencias.find((d: any) => d.id === row.dependencia_id)?.nombre ||
    'Ã¢â‚¬â€',
  [dependencias]);

  const cargarTabla = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const servicioTexto = filtroServicioTexto.trim();
      const dependenciaTexto = filtroDependenciaTexto.trim();
      const servicioIdExacto = filtroServicio || findCatalogIdByText(servicios, servicioTexto, 'Servicio');
      const dependenciaIdExacta = filtroDependencia || findCatalogIdByText(dependencias, dependenciaTexto, '#');
      const filtraServicioPorTexto = !!servicioTexto && !servicioIdExacto;
      const filtraDependenciaPorTexto = !!dependenciaTexto && !dependenciaIdExacta;
      const filtraPorTexto = filtraServicioPorTexto || filtraDependenciaPorTexto;

      const params = new URLSearchParams();
      params.set('limit', filtraPorTexto ? '5000' : String(PAGE_SIZE));
      params.set('page',  filtraPorTexto ? '1' : String(pageNum));
      params.set('sort',  '-created_at');

      if (filtroDni.trim())           params.set('dni', filtroDni.trim());
      if (servicioIdExacto)           params.set('servicio_id', servicioIdExacto);
      if (dependenciaIdExacta)        params.set('dependencia_id', dependenciaIdExacta);
      // estado activo/cerrado â†’ filtro client-side (el backend no soporta fecha_hasta=null)

      const res = await apiFetch<any>(`/agentes_servicios?${params.toString()}`);
      let data: any[] = Array.isArray(res?.data) ? res.data : [];

      if (filtraServicioPorTexto)     data = data.filter((r: any) => containsFilterText(nombreServicio(r), servicioTexto));
      if (filtraDependenciaPorTexto)  data = data.filter((r: any) => containsFilterText(nombreDep(r), dependenciaTexto));

      // Filtro estado cerrado (fecha_hasta no nula)
      if (filtroEstado === 'activo')  data = data.filter((r: any) => !r.fecha_hasta);
      if (filtroEstado === 'cerrado') data = data.filter((r: any) => !!r.fecha_hasta);

      const totalFiltrado = data.length;
      const rowsFinal = filtraPorTexto
        ? data.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE)
        : data;

      setRows(rowsFinal);
      setTotal(filtraPorTexto ? totalFiltrado : (res?.meta?.total ?? res?.total ?? data.length));
      setPage(pageNum);
    } catch (e: any) {
      toast.error('Error al cargar registros', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [
    filtroDni,
    filtroServicio,
    filtroServicioTexto,
    filtroDependencia,
    filtroDependenciaTexto,
    filtroEstado,
    servicios,
    dependencias,
    nombreServicio,
    nombreDep,
  ]);

  useEffect(() => { cargarTabla(1); }, [cargarTabla]);

  // â”€â”€ Buscar por nombre â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const buscarPorNombre = useCallback(async () => {
    const q = filtroNombre.trim();
    if (!q) return;
    setLoadingNom(true);
    setMatches([]);
    try {
      const res = await searchPersonal(q);
      setMatches(res);
      if (!res.length) toast.error('Sin resultados', `No se encontrÃ³ "${q}"`);
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

  // â”€â”€ Verificar pase abierto antes de abrir modal nuevo pase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const abrirNuevoPase = useCallback(async (agente: any) => {
    setCheckandoPase(true);
    try {
      const res = await apiFetch<any>(`/agentes_servicios?dni=${agente.dni}&limit=100&sort=-fecha_desde`);
      const pases: any[] = Array.isArray(res?.data) ? res.data : [];
      const abierto = pases.find((p: any) => !p.fecha_hasta);
      if (abierto) {
        toast.error(
          'â›” Pase activo sin cerrar',
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

  const nombreAgente = (row: any) => {
    const p = personalMap[String(row.dni)];
    if (p?.apellido || p?.nombre) return `${p.apellido}, ${p.nombre}`;
    return row.apellido ? `${row.apellido}, ${row.nombre}` : `DNI ${row.dni}`;
  };

  return (
    <Layout title="Agentes por Servicio" showBack>
      <div className="asv-layout">

        {/* â”€â”€ PANEL DE FILTROS â”€â”€ */}
        <div className="card asv-filters-card">
          <div className="asv-filters-title">ðŸ” Filtros</div>
          <div className="asv-filters-grid">

            {/* DNI */}
            <div className="asv-field">
              <label htmlFor="asv-f-dni" className="asv-label">DNI</label>
              <input
                id="asv-f-dni"
                name="filtroDni"
                className="input"
                value={filtroDni}
                onChange={e => setFiltroDni(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && cargarTabla(1)}
                placeholder="NÃºmero de DNI"
              />
            </div>

            {/* Buscar por nombre */}
            <div className="asv-field">
              <label htmlFor="asv-f-nombre" className="asv-label">Apellido / Nombre</label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  id="asv-f-nombre"
                  name="filtroNombre"
                  className="input"
                  value={filtroNombre}
                  onChange={e => setFiltroNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && buscarPorNombre()}
                  placeholder="Buscar por apellido"
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={buscarPorNombre} disabled={loadingNom || !filtroNombre.trim()} type="button">
                  {loadingNom ? 'â€¦' : 'ðŸ”'}
                </button>
              </div>
            </div>

            {/* Servicio */}
            <div className="asv-field">
              <label htmlFor="asv-f-srv" className="asv-label">Servicio</label>
              <input
                id="asv-f-srv"
                name="filtroServicioTexto"
                className="input"
                list="asv-servicios-list"
                value={filtroServicioTexto}
                onChange={e => {
                  const text = e.target.value;
                  setFiltroServicioTexto(text);
                  setFiltroServicio(findCatalogIdByText(servicios, text, 'Servicio'));
                }}
                onKeyDown={e => e.key === 'Enter' && cargarTabla(1)}
                disabled={loadingMaestros}
                placeholder="Escribir servicio"
              />
              <datalist id="asv-servicios-list">
                {servicios.map((s: any) => {
                  const label = catalogText(s, `Servicio #${s.id}`);
                  return <option key={s.id} value={label} />;
                })}
              </datalist>
            </div>

            {/* Dependencia / Sector */}
            <div className="asv-field">
              <label htmlFor="asv-f-dep" className="asv-label">Dependencia / Sector</label>
              <input
                id="asv-f-dep"
                name="filtroDependenciaTexto"
                className="input"
                list="asv-dependencias-list"
                value={filtroDependenciaTexto}
                onChange={e => {
                  const text = e.target.value;
                  setFiltroDependenciaTexto(text);
                  setFiltroDependencia(findCatalogIdByText(dependencias, text, '#'));
                }}
                onKeyDown={e => e.key === 'Enter' && cargarTabla(1)}
                disabled={loadingMaestros}
                placeholder="Escribir dependencia o sector"
              />
              <datalist id="asv-dependencias-list">
                {dependencias.map((d: any) => {
                  const label = catalogText(d, `#${d.id}`);
                  return <option key={d.id} value={label} />;
                })}
              </datalist>
            </div>

            {/* Estado */}
            <div className="asv-field">
              <div className="asv-label">Estado</div>
              <div className="asv-estado-btns">
                {(['todos', 'activo', 'cerrado'] as const).map(e => (
                  <button
                    key={e}
                    type="button"
                    className={`asv-estado-btn${filtroEstado === e ? ' active' : ''}`}
                    onClick={() => setFiltroEstado(e)}
                  >
                    {e === 'todos' ? 'ðŸ“‹ Todos' : e === 'activo' ? 'ðŸŸ¢ Activos' : 'â¬œ Cerrados'}
                  </button>
                ))}
              </div>
            </div>

            {/* BotÃ³n buscar */}
            <div className="asv-field asv-field-action">
              <button className="btn asv-btn-buscar" onClick={() => cargarTabla(1)} disabled={loading} type="button">
                {loading ? 'ðŸ”„ Buscandoâ€¦' : 'ðŸ” Buscar'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setFiltroDni(''); setFiltroNombre(''); setFiltroServicio('');
                  setFiltroServicioTexto(''); setFiltroDependencia('');
                  setFiltroDependenciaTexto(''); setFiltroEstado('todos');
                }}
                type="button"
              >
                âœ• Limpiar
              </button>
            </div>
          </div>

          {/* Matches por nombre */}
          {matches.length > 0 && (
            <div className="asv-matches">
              <div className="asv-label asv-mt-8">Resultados ({matches.length}) â€” hacÃ© clic para filtrar:</div>
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

        {/* â”€â”€ TABLA â”€â”€ */}
        <div className="card asv-table-card">
          <div className="asv-table-header">
            <div className="asv-table-title">
              ðŸ“‹ Registros
              {!loading && <span className="asv-total-badge">{total} total</span>}
            </div>
            <div className="asv-table-pag">
              <button
                className="btn asv-btn-export-xl"
                type="button"
                title="Exportar reporte de antigÃ¼edad por servicio y sector"
                onClick={() => setModalExportar(true)}
              >
                ðŸ“Š AntigÃ¼edad Excel
              </button>
              <button className="btn" onClick={() => cargarTabla(page - 1)} disabled={page <= 1 || loading} type="button">â€¹ Anterior</button>
              <span className="asv-pag-info">PÃ¡g. {page} / {totalPages}</span>
              <button className="btn" onClick={() => cargarTabla(page + 1)} disabled={page >= totalPages || loading} type="button">Siguiente â€º</button>
            </div>
          </div>

          {loading ? (
            <div className="asv-loading">ðŸ”„ Cargando registrosâ€¦</div>
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
                        <td className="asv-td-nombre">{nombreAgente(row)}</td>
                        <td className="asv-td-servicio">{nombreServicio(row)}</td>
                        <td className="asv-td-dep">{nombreDep(row)}</td>
                        <td className="asv-td-fecha">{fmtDate(row.fecha_desde)}</td>
                        <td className="asv-td-fecha">{row.fecha_hasta ? fmtDate(row.fecha_hasta) : <span className="asv-abierto-label">Sin cierre</span>}</td>
                        <td>
                          <span className={`badge ${abierto ? 'asv-badge-open' : 'asv-badge-closed'}`}>
                            {abierto ? 'ðŸŸ¢ Activo' : 'â¬œ Cerrado'}
                          </span>
                        </td>
                        <td className="asv-td-motivo">{row.motivo || 'â€”'}</td>
                        <td className="asv-td-actions">
                          {/* Historial */}
                          <button
                            className="btn asv-btn-sm"
                            type="button"
                            title="Ver historial de pases"
                            onClick={() => setModalHistorial({
                              dni: row.dni,
                              nombre: nombreAgente(row),
                            })}
                          >
                            ðŸ•‘ Historial
                          </button>

                          {/* Cerrar pase activo */}
                          {abierto && (
                            <button
                              className="btn asv-btn-sm asv-btn-danger"
                              type="button"
                              title="Cerrar este pase"
                              onClick={() => setModalCerrar(row)}
                            >
                              ðŸ”’ Cerrar
                            </button>
                          )}

                          {/* Nuevo pase */}
                          {!abierto && (
                            <button
                              className="btn asv-btn-sm asv-btn-new"
                              type="button"
                              title="Agregar nuevo pase para este agente"
                              disabled={checkandoPase}
                              onClick={() => {
                                const p = personalMap[String(row.dni)];
                                abrirNuevoPase({
                                  dni: row.dni,
                                  apellido: p?.apellido || row.apellido || '',
                                  nombre:   p?.nombre   || row.nombre   || '',
                                });
                              }}
                            >
                              âž• Nuevo
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

          {/* PaginaciÃ³n inferior */}
          {!loading && totalPages > 1 && (
            <div className="asv-pag-bottom">
              <button className="btn" onClick={() => cargarTabla(page - 1)} disabled={page <= 1}>â€¹ Anterior</button>
              <span className="asv-pag-info">PÃ¡g. {page} / {totalPages}</span>
              <button className="btn" onClick={() => cargarTabla(page + 1)} disabled={page >= totalPages}>Siguiente â€º</button>
            </div>
          )}
        </div>
      </div>

      {/* â”€â”€ Modales â”€â”€ */}
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
      {modalExportar && (
        <ExportarAntiguedadModal
          servicios={servicios}
          dependencias={dependencias}
          initialServicio={filtroServicio}
          initialDependencia={filtroDependencia}
          onClose={() => setModalExportar(false)}
        />
      )}
    </Layout>
  );
}

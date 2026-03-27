// src/pages/JefeServicioPage/index.tsx
// Página exclusiva para Jefe de Servicio
// - Ve solo los agentes de SU sector (sector_id del usuario logueado)
// - Gestiona agentes_servicios (asignar/cerrar servicio)
// - Ve reconocimientos médicos (solo lectura)
// - Búsqueda igual a GestionPage
// - Exportar PDF/Excel/Word/Imprimir

import React, { useState, useCallback, useEffect } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { useAuth } from '../../auth/AuthProvider';
import { apiFetch } from '../../api/http';
import { loadSession } from '../../auth/session';
import { hasPermission } from '../../auth/permissions';
import { exportToExcel, exportToPdf, exportToWord, printTable } from '../../utils/export';
import './styles/JefeServicioPage.css';

// ─── Helper: trae TODAS las páginas de un endpoint CRUD ──────────────────────
async function fetchAll<T = any>(baseUrl: string, pageSize = 500): Promise<T[]> {
  let all: T[] = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const res = await apiFetch<any>(`${baseUrl}${sep}limit=${pageSize}&page=${page}`);
    const rows: T[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total);
    else total = all.length;
    if (rows.length < pageSize) break;
    page++;
  }
  return all;
}

// ─── Helpers fecha (sin offset UTC — mismo fix que embarazadas) ───────────────
function fmt(d?: string | null): string {
  if (!d) return '—';
  try {
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-').map(Number);
    if (!y || !m || !day) return String(d);
    return new Date(y, m - 1, day).toLocaleDateString('es-AR');
  } catch { return String(d); }
}

function fmtDateTime(dt?: string | null): string {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(dt); }
}

// ─── Modal asignar nuevo servicio ─────────────────────────────────────────────
interface AsignarServicioModalProps {
  agente: any;
  servicios: any[];
  dependencias: any[];
  onClose: () => void;
  onSaved: () => void;
}
function AsignarServicioModal({ agente, servicios, dependencias, onClose, onSaved }: AsignarServicioModalProps) {
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

  // Pre-cargar jefe con el usuario logueado
  useEffect(() => {
    const s = loadSession();
    const u: any = s?.user || {};
    setForm(f => ({ ...f, jefe_nombre: u?.nombre || '' }));
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const guardar = async () => {
    if (!form.servicio_id) { toast.error('Seleccioná un servicio'); return; }
    if (!form.fecha_desde) { toast.error('Ingresá la fecha de inicio'); return; }
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
      toast.ok('Servicio asignado', `${agente.apellido}, ${agente.nombre}`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al asignar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const fieldStyle = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };

  return (
    <div className="js-overlay" onClick={onClose}>
      <div className="js-modal" onClick={e => e.stopPropagation()}>
        <div className="js-modal-header">
          <div>
            <div className="js-modal-title">➕ Asignar Servicio</div>
            <div className="js-modal-sub">{agente.apellido}, {agente.nombre} · DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">✕</button>
        </div>
        <div className="js-modal-body">
          <div className="js-form-grid">
            <div className="js-field">
              <div style={labelStyle}>Servicio *</div>
              <select className="input" style={fieldStyle} value={form.servicio_id} onChange={e => set('servicio_id', e.target.value)}>
                <option value="">— Seleccioná —</option>
                {servicios.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `Servicio #${s.id}`}</option>
                ))}
              </select>
            </div>
            <div className="js-field">
              <div style={labelStyle}>Dependencia</div>
              <select className="input" style={fieldStyle} value={form.dependencia_id} onChange={e => set('dependencia_id', e.target.value)}>
                <option value="">— Ninguna —</option>
                {dependencias.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.reparticion_nombre || d.nombre}</option>
                ))}
              </select>
            </div>
            <div className="js-field">
              <div style={labelStyle}>Fecha desde *</div>
              <input type="date" className="input" style={fieldStyle} value={form.fecha_desde} onChange={e => set('fecha_desde', e.target.value)} />
            </div>
            <div className="js-field">
              <div style={labelStyle}>Jefe / Responsable</div>
              <input type="text" className="input" style={fieldStyle} value={form.jefe_nombre} onChange={e => set('jefe_nombre', e.target.value)} />
            </div>
            <div className="js-field js-field-full">
              <div style={labelStyle}>Motivo del pase</div>
              <input type="text" className="input" style={fieldStyle} value={form.motivo} onChange={e => set('motivo', e.target.value)} placeholder="Ej: Traslado, reubicación, etc." />
            </div>
            <div className="js-field js-field-full">
              <div style={labelStyle}>Observaciones</div>
              <textarea className="input" rows={2} style={{ ...fieldStyle, resize: 'vertical' }} value={form.observaciones} onChange={e => set('observaciones', e.target.value)} />
            </div>
          </div>
          <div className="js-modal-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn js-btn-save" onClick={guardar} disabled={saving}>
              {saving ? '⏳ Guardando…' : '💾 Asignar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal cerrar servicio ────────────────────────────────────────────────────
interface CerrarServicioModalProps {
  pase: any;
  onClose: () => void;
  onSaved: () => void;
}
function CerrarServicioModal({ pase, onClose, onSaved }: CerrarServicioModalProps) {
  const toast = useToast();
  const [fechaHasta, setFechaHasta] = useState('');
  const [saving, setSaving] = useState(false);

  const cerrar = async () => {
    if (!fechaHasta) { toast.error('Ingresá la fecha de cierre'); return; }
    setSaving(true);
    try {
      await apiFetch<any>(`/agentes_servicios/${pase.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fecha_hasta: fechaHasta }),
      });
      toast.ok('Servicio cerrado');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al cerrar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="js-overlay" onClick={onClose}>
      <div className="js-modal js-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="js-modal-header">
          <div className="js-modal-title">🔒 Cerrar Servicio Activo</div>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="js-modal-body">
          <div style={{ fontSize: '0.84rem', marginBottom: 6 }}><b>Servicio:</b> {pase.servicio_nombre || pase.nombre || `#${pase.servicio_id}`}</div>
          <div style={{ fontSize: '0.84rem', marginBottom: 12 }}><b>Desde:</b> {fmt(pase.fecha_desde)}</div>
          <div>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 }}>Fecha de cierre *</div>
            <input type="date" className="input" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div className="js-modal-actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn js-btn-danger" onClick={cerrar} disabled={saving}>
              {saving ? '⏳…' : '🔒 Cerrar Servicio'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Panel de reconocimientos médicos (solo lectura) ─────────────────────────
interface RecMedicosProps {
  dni: string | number;
}
function RecMedicos({ dni }: RecMedicosProps) {
  const [recs, setRecs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!dni) return;
    setLoading(true);
    fetchAll(`/reconocimientos_medicos?dni=${dni}&sort=-fecha_desde`)
      .then(rows => setRecs(rows))
      .catch(() => setRecs([]))
      .finally(() => setLoading(false));
  }, [dni]);

  const total     = recs.length;
  const totalDias = recs.reduce((acc: number, r: any) => acc + (Number(r.cantidad_dias) || 0), 0);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
          🏥 Reconocimientos médicos
          <span style={{ marginLeft: 8, fontSize: '0.7rem', color: '#64748b' }}>
            {total} registros · {totalDias} días total
          </span>
        </div>
        <button className="btn" type="button"
          style={{ padding: '2px 8px', fontSize: '0.75rem' }}
          onClick={() => setExpanded(v => !v)}>
          {expanded ? '▲' : '▼'}
        </button>
      </div>
      {expanded && (
        loading ? (
          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>🔄 Cargando…</div>
        ) : recs.length === 0 ? (
          <div style={{ color: '#475569', fontSize: '0.8rem' }}>Sin reconocimientos registrados</div>
        ) : (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {recs.map((r: any) => (
              <div key={r.id} style={{
                padding: '7px 10px', marginBottom: 5, borderRadius: 7,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                fontSize: '0.78rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: '#e2e8f0' }}>
                    {r.tipo || 'Sin tipo'}
                    {r.cantidad_dias && <span style={{ marginLeft: 6, color: '#14b8a6' }}>{r.cantidad_dias} días</span>}
                  </span>
                  <span style={{ color: '#64748b' }}>#{r.id}</span>
                </div>
                <div style={{ color: '#94a3b8', display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                  {r.fecha_desde && <span>Desde: <b>{fmt(r.fecha_desde)}</b></span>}
                  {r.fecha_hasta && <span>Hasta: <b>{fmt(r.fecha_hasta)}</b></span>}
                  {r.resultado   && <span>Resultado: {r.resultado}</span>}
                </div>
                {r.observaciones && (
                  <div style={{ color: '#64748b', marginTop: 3, fontStyle: 'italic' }}>{r.observaciones}</div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ─── Modal: Nuevo franco compensatorio ───────────────────────────────────────
interface NuevoFrancoModalProps {
  agente: any;
  sectorId: number | null;
  jefeNombre: string;
  onClose: () => void;
  onSaved: () => void;
}
function NuevoFrancoModal({ agente, sectorId, jefeNombre, onClose, onSaved }: NuevoFrancoModalProps) {
  const toast = useToast();
  const [form, setForm] = useState({
    fecha_franco:  '',
    fecha_trabajo: '',
    motivo:        '',
    observaciones: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const lbl = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const fld = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };

  const guardar = async () => {
    if (!form.fecha_franco) { toast.error('Ingresá la fecha del franco'); return; }
    setSaving(true);
    try {
      await apiFetch<any>('/francos_compensatorios', {
        method: 'POST',
        body: JSON.stringify({
          dni:           agente.dni,
          fecha_franco:  form.fecha_franco,
          fecha_trabajo: form.fecha_trabajo || null,
          motivo:        form.motivo        || null,
          observaciones: form.observaciones || null,
          estado:        'PENDIENTE',
          jefe_nombre:   jefeNombre         || null,
          sector_id:     sectorId           ?? null,
        }),
      });
      toast.ok('Franco cargado', `${agente.apellido}, ${agente.nombre}`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al guardar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="js-overlay" onClick={onClose}>
      <div className="js-modal" onClick={e => e.stopPropagation()}>
        <div className="js-modal-header">
          <div>
            <div className="js-modal-title">📅 Cargar Franco Compensatorio</div>
            <div className="js-modal-sub">{agente.apellido}, {agente.nombre} · DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">✕</button>
        </div>
        <div className="js-modal-body">
          <div className="js-form-grid">
            <div className="js-field">
              <div style={lbl}>Fecha del franco *</div>
              <input type="date" className="input" style={fld}
                value={form.fecha_franco} onChange={e => set('fecha_franco', e.target.value)} />
            </div>
            <div className="js-field">
              <div style={lbl}>Día trabajado que lo origina</div>
              <input type="date" className="input" style={fld}
                value={form.fecha_trabajo} onChange={e => set('fecha_trabajo', e.target.value)} />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Motivo</div>
              <input type="text" className="input" style={fld}
                value={form.motivo} onChange={e => set('motivo', e.target.value)}
                placeholder="Ej: Guardia 24hs, feriado trabajado…" />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Observaciones</div>
              <textarea className="input" rows={2}
                style={{ ...fld, resize: 'vertical' }}
                value={form.observaciones} onChange={e => set('observaciones', e.target.value)} />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Jefe / Responsable</div>
              <input type="text" className="input" style={{ ...fld, color: '#94a3b8' }}
                value={jefeNombre} disabled />
            </div>
          </div>
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6,
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
            fontSize: '0.74rem', color: '#fbbf24' }}>
            ⚠️ El franco queda en estado <b>PENDIENTE</b> hasta que el administrador lo apruebe.
          </div>
          <div className="js-modal-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn js-btn-save" onClick={guardar} disabled={saving}>
              {saving ? '⏳ Guardando…' : '💾 Cargar Franco'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Panel de francos compensatorios ─────────────────────────────────────────
interface FrancosAgenteProps {
  agente: any;
  sectorId: number | null;
  jefeNombre: string;
}
function FrancosAgente({ agente, sectorId, jefeNombre }: FrancosAgenteProps) {
  const [francos,   setFrancos]   = useState<any[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [expanded,  setExpanded]  = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const cargar = () => {
    if (!agente?.dni) return;
    setLoading(true);
    fetchAll(`/francos_compensatorios?dni=${agente.dni}&sort=-fecha_franco`)
      .then(rows => setFrancos(rows))
      .catch(() => setFrancos([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [agente?.dni]);

  const pendientes = francos.filter(f => f.estado === 'PENDIENTE').length;
  const ESTADO_COLOR: Record<string, string> = {
    PENDIENTE: '#fbbf24', APROBADO: '#22c55e', TOMADO: '#64748b', ANULADO: '#ef4444',
  };

  return (
    <>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
            📅 Francos compensatorios
            <span style={{ marginLeft: 8, fontSize: '0.7rem', color: '#64748b' }}>
              {francos.length} registro{francos.length !== 1 ? 's' : ''}
              {pendientes > 0 && (
                <span style={{ marginLeft: 6, color: '#fbbf24' }}>· {pendientes} pendiente{pendientes !== 1 ? 's' : ''}</span>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="btn js-btn-save" type="button"
              style={{ padding: '2px 9px', fontSize: '0.73rem' }}
              onClick={() => setModalOpen(true)}>
              ➕ Cargar
            </button>
            <button className="btn" type="button"
              style={{ padding: '2px 8px', fontSize: '0.75rem' }}
              onClick={() => setExpanded(v => !v)}>
              {expanded ? '▲' : '▼'}
            </button>
          </div>
        </div>

        {expanded && (
          loading ? (
            <div style={{ color: '#64748b', fontSize: '0.8rem' }}>🔄 Cargando…</div>
          ) : francos.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '0.8rem' }}>Sin francos compensatorios registrados</div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {francos.map((f: any) => (
                <div key={f.id} style={{
                  padding: '7px 10px', marginBottom: 5, borderRadius: 7,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  fontSize: '0.78rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontWeight: 600,
                      color: ESTADO_COLOR[f.estado] || '#e2e8f0' }}>
                      {f.estado || 'PENDIENTE'}
                    </span>
                    <span style={{ color: '#64748b' }}>#{f.id}</span>
                  </div>
                  <div style={{ color: '#94a3b8', display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                    <span>Franco: <b>{fmt(f.fecha_franco)}</b></span>
                    {f.fecha_trabajo && <span>Trabajó: <b>{fmt(f.fecha_trabajo)}</b></span>}
                    {f.jefe_nombre   && <span>👤 {f.jefe_nombre}</span>}
                  </div>
                  {f.motivo && (
                    <div style={{ color: '#cbd5e1', marginTop: 3 }}>{f.motivo}</div>
                  )}
                  {f.observaciones && (
                    <div style={{ color: '#64748b', marginTop: 2, fontStyle: 'italic' }}>{f.observaciones}</div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {modalOpen && (
        <NuevoFrancoModal
          agente={agente}
          sectorId={sectorId}
          jefeNombre={jefeNombre}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setExpanded(true); cargar(); }}
        />
      )}
    </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function JefeServicioPage() {
  const toast = useToast();
  const { session } = useAuth();
  const u: any = session?.user || {};
  const perms: string[] = session?.permissions ?? [];
  const sectorId: number | null = u?.sector_id ?? null;
  const sectorNombre: string = u?.sector_nombre || `Sector #${sectorId}`;

  // admin (crud:*:*) o reader (sin sector_id) ven TODOS los agentes
  // jefe_servicio: tiene sector_id pero NO crud:*:*
  const isGlobal = hasPermission(perms, 'crud:*:*') || !sectorId;

  // Datos maestros
  const [servicios,    setServicios]    = useState<any[]>([]);
  const [dependencias, setDependencias] = useState<any[]>([]);
  const [loadingMaestros, setLoadingMaestros] = useState(true);

  // Agentes del sector
  const [agentes,      setAgentes]      = useState<any[]>([]);
  const [loadingAg,    setLoadingAg]    = useState(false);

  // Búsqueda
  const [busquedaDni,    setBusquedaDni]    = useState('');
  const [busquedaNombre, setBusquedaNombre] = useState('');

  // Agente seleccionado
  const [agenteActivo, setAgenteActivo] = useState<any>(null);

  // Pases del agente seleccionado
  const [pases,       setPases]       = useState<any[]>([]);
  const [loadingPases, setLoadingPases] = useState(false);

  // Modales
  const [modalAsignar, setModalAsignar] = useState(false);
  const [modalCerrar,  setModalCerrar]  = useState<any>(null);

  // Tab
  const [tab, setTab] = useState<'agentes' | 'todos_pases' | 'licencias'>('agentes');

  // Agentes de licencia (reconocimientos médicos activos del sector)
  const [licenciasActivas, setLicenciasActivas] = useState<any[]>([]);
  const [loadingLicencias, setLoadingLicencias] = useState(false);
  const [licenciasSet, setLicenciasSet] = useState<Set<string>>(new Set());

  // Todos los pases del sector (tab 2)
  const [todosPases,      setTodosPases]      = useState<any[]>([]);
  const [loadingTodosPases, setLoadingTodosPases] = useState(false);
  const [filtroPases,     setFiltroPases]     = useState<'todos' | 'activos' | 'cerrados'>('todos');

  // ── Cargar maestros ───────────────────────────────────────────────────────
  useEffect(() => {
    Promise.allSettled([
      fetchAll('/servicios').then(rows => setServicios(rows)),
      fetchAll('/reparticiones').then(rows => setDependencias(rows)),
    ]).finally(() => setLoadingMaestros(false));
  }, []);

  // ── Cargar licencias activas del sector (paginado completo) ──────────────
  const cargarLicencias = useCallback(async (sectorAgentes: any[]) => {
    if (!sectorAgentes.length) return;
    setLoadingLicencias(true);
    try {
      const dniSet = new Set(sectorAgentes.map((a: any) => String(a.dni)));
      const all = await fetchAll('/reconocimientos_medicos?sort=-fecha_desde');
      // global: todos sin fecha_hasta; jefe: solo los de su sector
      const activos = isGlobal
        ? all.filter((r: any) => !r.fecha_hasta)
        : all.filter((r: any) => !r.fecha_hasta && dniSet.has(String(r.dni)));
      setLicenciasActivas(activos);
      setLicenciasSet(new Set(activos.map((r: any) => String(r.dni))));
    } catch {
      setLicenciasActivas([]);
    } finally {
      setLoadingLicencias(false);
    }
  }, [isGlobal]);

  // ── Cargar agentes (todos si global, solo sector si jefe) ────────────────
  const cargarAgentes = useCallback(async () => {
    if (!isGlobal && !sectorId) return;
    setLoadingAg(true);
    try {
      const base = isGlobal
        ? `/personal/search?estado_empleo=ACTIVO`
        : `/personal/search?sector_id=${sectorId}&estado_empleo=ACTIVO`;
      const all = await fetchAll(base);
      setAgentes(all);
    } catch (e: any) {
      toast.error('Error cargando agentes', e?.message);
    } finally {
      setLoadingAg(false);
    }
  }, [isGlobal, sectorId]);

  useEffect(() => { cargarAgentes(); }, [cargarAgentes]);

  // Cuando los agentes están listos, cargar sus licencias activas
  useEffect(() => {
    if (agentes.length > 0) cargarLicencias(agentes);
  }, [agentes, cargarLicencias]);

  // ── Cargar pases del agente seleccionado ─────────────────────────────────
  const cargarPases = useCallback(async (dni: string | number) => {
    if (!dni) return;
    setLoadingPases(true);
    try {
      const rows = await fetchAll(`/agentes_servicios?dni=${dni}&sort=-fecha_desde`);
      setPases(rows);
    } catch { setPases([]); }
    finally { setLoadingPases(false); }
  }, []);

  const seleccionarAgente = useCallback((ag: any) => {
    setAgenteActivo(ag);
    cargarPases(ag.dni);
  }, [cargarPases]);

  // ── Verificar pase abierto antes de asignar ───────────────────────────────
  const intentarAsignar = useCallback(async () => {
    if (!agenteActivo) return;
    const abierto = pases.find((p: any) => !p.fecha_hasta);
    if (abierto) {
      toast.error(
        '⛔ Servicio activo sin cerrar',
        `Cerrá el servicio actual (${abierto.nombre || `#${abierto.servicio_id}`} desde ${fmt(abierto.fecha_desde)}) antes de asignar uno nuevo.`
      );
      return;
    }
    setModalAsignar(true);
  }, [agenteActivo, pases]);

  // ── Cargar todos los pases (todos si global, solo sector si jefe) ────────
  const cargarTodosPases = useCallback(async () => {
    if (!isGlobal && !sectorId) return;
    setLoadingTodosPases(true);
    try {
      const url = isGlobal
        ? `/agentes_servicios?sort=-created_at`
        : `/agentes_servicios?dependencia_id=${sectorId}&sort=-created_at`;
      const rows = await fetchAll(url);
      setTodosPases(rows);
    } catch { setTodosPases([]); }
    finally { setLoadingTodosPases(false); }
  }, [isGlobal, sectorId]);

  useEffect(() => {
    if (tab === 'todos_pases') cargarTodosPases();
  }, [tab, cargarTodosPases]);

  // ── Búsqueda local ────────────────────────────────────────────────────────
  const agentesFiltrados = agentes.filter((a: any) => {
    if (busquedaDni.trim()) return String(a.dni).includes(busquedaDni.trim());
    if (busquedaNombre.trim()) {
      const q = busquedaNombre.toLowerCase();
      return (
        (a.apellido || '').toLowerCase().includes(q) ||
        (a.nombre   || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pasesFiltrados = todosPases.filter((p: any) => {
    if (filtroPases === 'activos')  return !p.fecha_hasta;
    if (filtroPases === 'cerrados') return !!p.fecha_hasta;
    return true;
  });

  const paseActivo = pases.find((p: any) => !p.fecha_hasta);

  // ── Exports ───────────────────────────────────────────────────────────────
  const exportarAgentes = (tipo: 'excel' | 'pdf' | 'word' | 'print') => {
    const rows = agentesFiltrados.map((a: any) => ({
      DNI:         a.dni,
      Apellido:    a.apellido,
      Nombre:      a.nombre,
      CUIL:        a.cuil || '',
      Ley:         a.ley_nombre || '',
      Categoría:   a.categoria_nombre || '',
      Ingreso:     fmt(a.fecha_ingreso),
      Estado:      a.estado_empleo || '',
    }));
    const title = `Agentes Sector ${sectorId}`;
    const file  = `agentes_sector_${sectorId}`;
    if (tipo === 'excel') exportToExcel(`${file}.xlsx`, rows);
    if (tipo === 'pdf')   exportToPdf(`${file}.pdf`, rows);
    if (tipo === 'word')  exportToWord(`${file}.docx`, rows);
    if (tipo === 'print') printTable(title, rows);
  };

  // Mapa dni → agente para enriquecer exports con nombre
  const agentesMap: Record<string, any> = {};
  for (const a of agentes) { if (a.dni != null) agentesMap[String(a.dni)] = a; }

  const exportarPases = (tipo: 'excel' | 'pdf' | 'print') => {
    const rows = pasesFiltrados.map((p: any) => {
      const ag = agentesMap[String(p.dni)];
      return {
        DNI:      p.dni,
        Apellido: ag?.apellido || p.apellido || '—',
        Nombre:   ag?.nombre   || p.nombre   || '—',
        Servicio: p.nombre || p.servicio_nombre || `#${p.servicio_id}`,
        Desde:    fmt(p.fecha_desde),
        Hasta:    p.fecha_hasta ? fmt(p.fecha_hasta) : 'Activo',
        Estado:   p.fecha_hasta ? 'Cerrado' : 'Activo',
        Motivo:   p.motivo || '',
        Jefe:     p.jefe_nombre || '',
      };
    });
    const file = `pases_sector_${sectorId}`;
    if (tipo === 'excel') exportToExcel(`${file}.xlsx`, rows);
    if (tipo === 'pdf')   exportToPdf(`${file}.pdf`, rows);
    if (tipo === 'print') printTable(`Pases Sector ${sectorId}`, rows);
  };

  // Solo bloqueamos si NO es global Y no tiene sector asignado
  if (!isGlobal && !sectorId) {
    return (
      <Layout title="Mi Sector" showBack>
        <div className="card js-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚠️</div>
          <div style={{ color: '#f59e0b', fontWeight: 600 }}>Sin sector asignado</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Tu usuario no tiene un sector asignado. Solicitá al administrador que configure tu sector_id.
          </div>
        </div>
      </Layout>
    );
  }

  const headerTitle  = isGlobal ? 'Todos los sectores' : sectorNombre;
  const headerIcon   = isGlobal ? '🌐' : '🏢';

  return (
    <Layout title={isGlobal ? 'Gestión de Sectores' : 'Mi Sector'} showBack>
      <div className="js-layout">

        {/* ── PANEL IZQUIERDO: Lista de agentes ── */}
        <div className="js-left">

          {/* Header sector */}
          <div className="card js-card js-sector-header">
            <div className="js-sector-title">{headerIcon} {headerTitle}</div>
            <div className="js-sector-meta">
              {loadingAg ? '🔄 Cargando…' : `${agentes.length} agentes activos`}
            </div>
          </div>

          {/* Búsqueda */}
          <div className="card js-card">
            <div className="js-search-grid">
              <div>
                <div className="js-label">DNI</div>
                <input
                  className="input"
                  value={busquedaDni}
                  onChange={e => { setBusquedaDni(e.target.value); setBusquedaNombre(''); }}
                  placeholder="Filtrar por DNI"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <div className="js-label">Apellido / Nombre</div>
                <input
                  className="input"
                  value={busquedaNombre}
                  onChange={e => { setBusquedaNombre(e.target.value); setBusquedaDni(''); }}
                  placeholder="Filtrar por nombre"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            {(busquedaDni || busquedaNombre) && (
              <button className="btn" style={{ marginTop: 6, fontSize: '0.75rem' }}
                onClick={() => { setBusquedaDni(''); setBusquedaNombre(''); }}>
                ✕ Limpiar filtro
              </button>
            )}
          </div>

          {/* Exports */}
          <div className="card js-card">
            <div className="js-label" style={{ marginBottom: 6 }}>Exportar lista de agentes</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
              <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => exportarAgentes('print')}>🖨 Imprimir</button>
              <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => exportarAgentes('excel')}>Excel</button>
              <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => exportarAgentes('pdf')}>PDF</button>
              <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => exportarAgentes('word')}>Word</button>
            </div>
          </div>

          {/* Lista agentes */}
          <div className="card js-card js-agentes-list-card">
            <div className="js-section-title">
              👥 Agentes
              {agentesFiltrados.length !== agentes.length && (
                <span className="js-filter-badge">{agentesFiltrados.length} filtrados</span>
              )}
            </div>
            {loadingAg ? (
              <div className="js-loading">🔄 Cargando agentes…</div>
            ) : agentesFiltrados.length === 0 ? (
              <div className="js-empty">Sin agentes en este sector</div>
            ) : (
              <div className="js-agentes-list">
                {agentesFiltrados.map((a: any) => (
                  <button
                    key={a.dni}
                    type="button"
                    className={`js-agente-item${agenteActivo?.dni === a.dni ? ' active' : ''}`}
                    onClick={() => seleccionarAgente(a)}
                  >
                    <div className="js-agente-nombre" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {a.apellido}, {a.nombre}
                      {licenciasSet.has(String(a.dni)) && (
                        <span title="De licencia médica" style={{
                          fontSize: '0.65rem', background: 'rgba(220,38,38,0.2)',
                          color: '#fca5a5', borderRadius: 4, padding: '1px 5px', fontWeight: 600,
                        }}>🏥 LICENCIA</span>
                      )}
                    </div>
                    <div className="js-agente-meta">
                      DNI {a.dni}
                      {a.ley_nombre && ` · ${a.ley_nombre}`}
                      {a.categoria_nombre && ` · ${a.categoria_nombre}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── PANEL DERECHO: Detalle agente ── */}
        <div className="js-right">

          {/* Tabs */}
          <div className="card js-card js-tabs-card">
            <div className="js-tabs">
              <button
                type="button"
                className={`js-tab${tab === 'agentes' ? ' active' : ''}`}
                onClick={() => setTab('agentes')}
              >👤 Agente</button>
              <button
                type="button"
                className={`js-tab${tab === 'todos_pases' ? ' active' : ''}`}
                onClick={() => setTab('todos_pases')}
              >📋 Todos los Pases del Sector</button>
              <button
                type="button"
                className={`js-tab${tab === 'licencias' ? ' active' : ''}`}
                onClick={() => setTab('licencias')}
              >
                🏥 De Licencia
                {licenciasActivas.length > 0 && (
                  <span style={{
                    marginLeft: 6, background: '#dc2626', color: '#fff',
                    borderRadius: 99, fontSize: '0.68rem', padding: '1px 7px', fontWeight: 700,
                  }}>{licenciasActivas.length}</span>
                )}
              </button>
            </div>
          </div>

          {/* ── Tab Agente ── */}
          {tab === 'agentes' && (
            <>
              {!agenteActivo ? (
                <div className="card js-card js-placeholder">
                  <div className="js-placeholder-icon">👤</div>
                  <div className="js-placeholder-text">Seleccioná un agente de la lista</div>
                </div>
              ) : (
                <>
                  {/* Info agente */}
                  <div className="card js-card js-agente-detail">
                    <div className="js-detail-header">
                      <div>
                        <div className="js-detail-nombre">{agenteActivo.apellido}, {agenteActivo.nombre}</div>
                        <div className="js-detail-meta">DNI {agenteActivo.dni} · {agenteActivo.cuil || 'Sin CUIL'}</div>
                      </div>
                      <span className={`badge ${agenteActivo.estado_empleo === 'ACTIVO' ? '' : 'danger'}`}>
                        {agenteActivo.estado_empleo || 'ACTIVO'}
                      </span>
                    </div>
                    <div className="js-detail-grid">
                      <div><span className="js-label">Ley</span><div>{agenteActivo.ley_nombre || '—'}</div></div>
                      <div><span className="js-label">Categoría</span><div>{agenteActivo.categoria_nombre || '—'}</div></div>
                      <div><span className="js-label">Función</span><div>{agenteActivo.funcion_nombre || '—'}</div></div>
                      <div><span className="js-label">Ingreso</span><div>{fmt(agenteActivo.fecha_ingreso)}</div></div>
                    </div>

                    {/* Reconocimientos médicos (solo lectura) */}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 12, paddingTop: 10 }}>
                      <RecMedicos dni={agenteActivo.dni} />
                    </div>

                    {/* Francos compensatorios (lectura + carga) */}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 10, paddingTop: 10 }}>
                      <FrancosAgente
                        agente={agenteActivo}
                        sectorId={sectorId}
                        jefeNombre={u?.nombre || ''}
                      />
                    </div>
                  </div>

                  {/* Servicios del agente */}
                  <div className="card js-card">
                    <div className="js-section-header">
                      <div className="js-section-title">
                        🏥 Servicios
                        {paseActivo && (
                          <span className="js-badge-activo">🟢 Activo</span>
                        )}
                      </div>
                      <button
                        className="btn js-btn-asignar"
                        type="button"
                        onClick={intentarAsignar}
                        disabled={loadingPases}
                        title={paseActivo ? 'Cerrá el servicio actual antes de asignar uno nuevo' : 'Asignar nuevo servicio'}
                      >
                        ➕ Asignar Servicio
                      </button>
                    </div>

                    {loadingPases ? (
                      <div className="js-loading">🔄 Cargando pases…</div>
                    ) : pases.length === 0 ? (
                      <div className="js-empty">Sin servicios registrados</div>
                    ) : (
                      <div className="js-pases-list">
                        {pases.map((p: any) => {
                          const abierto = !p.fecha_hasta;
                          return (
                            <div key={p.id} className={`js-pase-item${abierto ? ' js-pase-activo' : ''}`}>
                              <div className="js-pase-header">
                                <span className={`js-estado-badge ${abierto ? 'activo' : 'cerrado'}`}>
                                  {abierto ? '🟢 ACTIVO' : '⬜ CERRADO'}
                                </span>
                                <span className="js-pase-id">#{p.id}</span>
                              </div>
                              <div className="js-pase-servicio">
                                {p.nombre || p.servicio_nombre || servicios.find((s: any) => s.id === p.servicio_id)?.nombre || `Servicio #${p.servicio_id}`}
                              </div>
                              <div className="js-pase-meta">
                                <span>📅 Desde: <b>{fmt(p.fecha_desde)}</b></span>
                                {p.fecha_hasta && <span>Hasta: <b>{fmt(p.fecha_hasta)}</b></span>}
                                {p.jefe_nombre && <span>👤 {p.jefe_nombre}</span>}
                              </div>
                              {p.motivo && <div className="js-pase-motivo">{p.motivo}</div>}
                              {abierto && (
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                                  <button
                                    className="btn js-btn-cerrar"
                                    type="button"
                                    onClick={() => setModalCerrar(p)}
                                  >🔒 Cerrar Servicio</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Tab Todos los Pases ── */}
          {tab === 'todos_pases' && (
            <div className="card js-card">
              <div className="js-section-header">
                <div className="js-section-title">📋 {isGlobal ? 'Todos los Pases' : 'Pases del Sector'}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
                  {/* Filtro estado */}
                  <div style={{ display: 'flex', gap: 3 }}>
                    {(['todos', 'activos', 'cerrados'] as const).map(f => (
                      <button key={f} type="button"
                        style={{
                          fontSize: '0.7rem', padding: '3px 9px', borderRadius: 7, cursor: 'pointer',
                          border: `1px solid ${filtroPases === f ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
                          background: filtroPases === f ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                          color: filtroPases === f ? '#c7d2fe' : '#94a3b8',
                        }}
                        onClick={() => setFiltroPases(f)}
                      >
                        {f === 'todos' ? 'Todos' : f === 'activos' ? '🟢 Activos' : '⬜ Cerrados'}
                      </button>
                    ))}
                  </div>
                  {/* Exports */}
                  <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => exportarPases('print')}>🖨</button>
                  <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => exportarPases('excel')}>Excel</button>
                  <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => exportarPases('pdf')}>PDF</button>
                </div>
              </div>

              {loadingTodosPases ? (
                <div className="js-loading">🔄 Cargando…</div>
              ) : pasesFiltrados.length === 0 ? (
                <div className="js-empty">Sin pases en este filtro</div>
              ) : (
                <div className="js-tabla-wrap">
                  <table className="js-tabla">
                    <thead>
                      <tr>
                        <th>DNI</th>
                        <th>Agente</th>
                        <th>Servicio</th>
                        <th>Desde</th>
                        <th>Hasta</th>
                        <th>Estado</th>
                        <th>Jefe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pasesFiltrados.map((p: any) => {
                        const abierto = !p.fecha_hasta;
                        return (
                          <tr key={p.id} className={abierto ? 'js-tr-activo' : ''}>
                            <td className="js-td-dni">{p.dni}</td>
                            <td>{p.apellido && p.nombre ? `${p.apellido}, ${p.nombre}` : p.agente_nombre || '—'}</td>
                            <td>{p.nombre || p.servicio_nombre || `#${p.servicio_id}`}</td>
                            <td>{fmt(p.fecha_desde)}</td>
                            <td>{p.fecha_hasta ? fmt(p.fecha_hasta) : <span style={{ color: '#22c55e' }}>Activo</span>}</td>
                            <td>
                              <span className={`js-estado-badge ${abierto ? 'activo' : 'cerrado'}`}>
                                {abierto ? '🟢' : '⬜'}
                              </span>
                            </td>
                            <td className="js-td-muted">{p.jefe_nombre || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Tab Licencias activas ── */}
          {tab === 'licencias' && (
            <div className="card js-card">
              <div className="js-section-header">
                <div className="js-section-title">
                  🏥 Agentes de licencia médica activa
                  {licenciasActivas.length > 0 && (
                    <span style={{ marginLeft: 8, fontSize: '0.8rem', color: '#fca5a5' }}>
                      {licenciasActivas.length} con licencia activa
                    </span>
                  )}
                </div>
              </div>

              {loadingLicencias ? (
                <div className="js-loading">🔄 Cargando licencias…</div>
              ) : licenciasActivas.length === 0 ? (
                <div className="js-empty">
                  {loadingAg ? 'Esperando agentes…' : 'No hay agentes con licencia médica activa en este sector.'}
                </div>
              ) : (
                <div className="js-tabla-wrap">
                  <table className="js-tabla">
                    <thead>
                      <tr>
                        <th>DNI</th>
                        <th>Agente</th>
                        <th>Tipo</th>
                        <th>Desde</th>
                        <th>Días</th>
                        <th>Resultado</th>
                        <th>Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {licenciasActivas.map((r: any) => {
                        const ag = agentes.find((a: any) => String(a.dni) === String(r.dni));
                        return (
                          <tr key={r.id} style={{ background: 'rgba(220,38,38,0.06)' }}>
                            <td className="js-td-dni">{r.dni}</td>
                            <td>
                              {ag ? `${ag.apellido}, ${ag.nombre}` : '—'}
                            </td>
                            <td style={{ fontWeight: 600, color: '#fca5a5' }}>{r.tipo || '—'}</td>
                            <td>{fmt(r.fecha_desde)}</td>
                            <td>{r.cantidad_dias ? `${r.cantidad_dias}d` : '—'}</td>
                            <td className="js-td-muted">{r.resultado || '—'}</td>
                            <td className="js-td-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.observaciones || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Modales ── */}
      {modalAsignar && agenteActivo && (
        <AsignarServicioModal
          agente={agenteActivo}
          servicios={servicios}
          dependencias={dependencias}
          onClose={() => setModalAsignar(false)}
          onSaved={() => cargarPases(agenteActivo.dni)}
        />
      )}
      {modalCerrar && (
        <CerrarServicioModal
          pase={modalCerrar}
          onClose={() => setModalCerrar(null)}
          onSaved={() => cargarPases(agenteActivo?.dni)}
        />
      )}
    </Layout>
  );
}

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
  dependencias: any[];  // reparticiones
  sectores: any[];
  onClose: () => void;
  onSaved: () => void;
}
function AsignarServicioModal({ agente, servicios, dependencias, sectores, onClose, onSaved }: AsignarServicioModalProps) {
  const toast = useToast();
  const hoy = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    dependencia_id: '',   // reparticion seleccionada
    servicio_id:    '',   // servicio filtrado por reparticion
    sector_id:      '',   // sector filtrado por servicio
    fecha_desde:    hoy,
    motivo:         '',
    jefe_nombre:    '',
    observaciones:  '',
  });
  const [saving, setSaving] = useState(false);

  // Pre-cargar jefe con el usuario logueado
  useEffect(() => {
    const s = loadSession();
    const u: any = s?.user || {};
    setForm(f => ({ ...f, jefe_nombre: u?.nombre || '' }));
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Cascade: al cambiar dependencia, resetear servicio y sector
  const onChangeDependencia = (v: string) => {
    setForm(f => ({ ...f, dependencia_id: v, servicio_id: '', sector_id: '' }));
  };

  // Cascade: al cambiar servicio, resetear sector
  const onChangeServicio = (v: string) => {
    setForm(f => ({ ...f, servicio_id: v, sector_id: '' }));
  };

  // Servicios filtrados por reparticion seleccionada
  const serviciosFiltrados = form.dependencia_id
    ? servicios.filter((s: any) => String(s.reparticion_id) === form.dependencia_id)
    : servicios;

  // Sectores filtrados por servicio seleccionado
  const sectoresFiltrados = form.servicio_id
    ? sectores.filter((s: any) => String(s.servicio_id) === form.servicio_id)
    : [];

  const guardar = async () => {
    if (!form.servicio_id) { toast.error('Seleccioná un servicio'); return; }
    if (!form.fecha_desde) { toast.error('Ingresá la fecha de inicio'); return; }
    setSaving(true);
    try {
      await apiFetch<any>('/agentes_servicios', {
        method: 'POST',
        body: JSON.stringify({
          dni:            agente.dni,
          servicio_id:    Number(form.servicio_id),
          sector_id:      form.sector_id    ? Number(form.sector_id)    : null,
          dependencia_id: form.dependencia_id ? Number(form.dependencia_id) : null,
          fecha_desde:    form.fecha_desde,
          motivo:         form.motivo       || null,
          jefe_nombre:    form.jefe_nombre  || null,
          observaciones:  form.observaciones || null,
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

            {/* ── Dependencia (Repartición) ── */}
            <div className="js-field">
              <div style={labelStyle}>Dependencia / Repartición</div>
              <select className="input" style={fieldStyle} value={form.dependencia_id} onChange={e => onChangeDependencia(e.target.value)}>
                <option value="">— Todas —</option>
                {dependencias.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.reparticion_nombre || d.nombre}</option>
                ))}
              </select>
            </div>

            {/* ── Servicio (filtrado por dependencia) ── */}
            <div className="js-field">
              <div style={labelStyle}>Servicio *</div>
              <select className="input" style={fieldStyle} value={form.servicio_id} onChange={e => onChangeServicio(e.target.value)}>
                <option value="">— Seleccioná —</option>
                {serviciosFiltrados.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `Servicio #${s.id}`}</option>
                ))}
              </select>
              {form.dependencia_id && serviciosFiltrados.length === 0 && (
                <div style={{ fontSize: '0.68rem', color: '#f59e0b', marginTop: 3 }}>
                  Sin servicios para esta dependencia
                </div>
              )}
            </div>

            {/* ── Sector (filtrado por servicio) ── */}
            <div className="js-field">
              <div style={labelStyle}>Sector</div>
              <select
                className="input"
                style={{ ...fieldStyle, opacity: !form.servicio_id ? 0.5 : 1 }}
                value={form.sector_id}
                onChange={e => set('sector_id', e.target.value)}
                disabled={!form.servicio_id}
              >
                <option value="">— Ninguno —</option>
                {sectoresFiltrados.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `Sector #${s.id}`}</option>
                ))}
              </select>
              {form.servicio_id && sectoresFiltrados.length === 0 && (
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 3 }}>
                  Sin sectores para este servicio
                </div>
              )}
            </div>

            {/* ── Fecha desde ── */}
            <div className="js-field">
              <div style={labelStyle}>Fecha desde *</div>
              <input type="date" className="input" style={fieldStyle} value={form.fecha_desde} onChange={e => set('fecha_desde', e.target.value)} />
            </div>

            {/* ── Jefe ── */}
            <div className="js-field js-field-full">
              <div style={labelStyle}>Jefe / Responsable</div>
              <input type="text" className="input" style={fieldStyle} value={form.jefe_nombre} onChange={e => set('jefe_nombre', e.target.value)} />
            </div>

            {/* ── Motivo ── */}
            <div className="js-field js-field-full">
              <div style={labelStyle}>Motivo del pase</div>
              <input type="text" className="input" style={fieldStyle} value={form.motivo} onChange={e => set('motivo', e.target.value)} placeholder="Ej: Traslado, reubicación, etc." />
            </div>

            {/* ── Observaciones ── */}
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

// ─── Modal cambiar sector en servicio activo ─────────────────────────────────
// ─── Modal: Asignar sector ────────────────────────────────────────────────────
interface AsignarSectorModalProps {
  agente: any;
  servicioId: number | null;
  sectores: any[];
  jefeNombre: string;
  onClose: () => void;
  onSaved: () => void;
}
function AsignarSectorModal({ agente, servicioId, sectores: sectoresProp, jefeNombre, onClose, onSaved }: AsignarSectorModalProps) {
  const toast = useToast();
  const hoy = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ sector_id: '', fecha_desde: hoy, motivo: '', observaciones: '' });
  const [saving, setSaving] = useState(false);
  const [sectoresLocal, setSectoresLocal] = useState<any[]>(sectoresProp);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const lbl = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const fld = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };

  // Si el padre aún no cargó los sectores, los cargamos aquí
  useEffect(() => {
    if (sectoresProp.length > 0) { setSectoresLocal(sectoresProp); return; }
    fetchAll('/sectores').then(rows => setSectoresLocal(rows)).catch(() => {});
  }, [sectoresProp]);

  const sectoresPorServicio = servicioId
    ? sectoresLocal.filter((s: any) => String(s.servicio_id) === String(servicioId))
    : sectoresLocal;
  const sectoresFiltrados = sectoresPorServicio.length > 0 ? sectoresPorServicio : sectoresLocal;

  const guardar = async () => {
    if (!form.sector_id) { toast.error('Seleccioná un sector'); return; }
    if (!form.fecha_desde) { toast.error('Ingresá la fecha de inicio'); return; }
    setSaving(true);
    try {
      await apiFetch<any>('/agentes_sectores', {
        method: 'POST',
        body: JSON.stringify({
          dni:          agente.dni,
          sector_id:    Number(form.sector_id),
          servicio_id:  servicioId ?? null,
          fecha_desde:  form.fecha_desde,
          motivo:       form.motivo       || null,
          jefe_nombre:  jefeNombre        || null,
          observaciones: form.observaciones || null,
        }),
      });
      toast.ok('Sector asignado', `${agente.apellido}, ${agente.nombre}`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al asignar sector', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="js-overlay" onClick={onClose}>
      <div className="js-modal js-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="js-modal-header">
          <div>
            <div className="js-modal-title">📍 Asignar Sector</div>
            <div className="js-modal-sub">{agente.apellido}, {agente.nombre} · DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="js-modal-body">
          <div className="js-form-grid">
            <div className="js-field js-field-full">
              <div style={lbl}>Sector *</div>
              <select className="input" style={fld} value={form.sector_id} onChange={e => set('sector_id', e.target.value)}>
                <option value="">— Seleccioná —</option>
                {sectoresFiltrados.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `Sector #${s.id}`}</option>
                ))}
              </select>
              {sectoresFiltrados.length === 0 && (
                <div style={{ fontSize: '0.7rem', color: '#f59e0b', marginTop: 3 }}>Sin sectores para este servicio</div>
              )}
            </div>
            <div className="js-field">
              <div style={lbl}>Fecha desde *</div>
              <input type="date" className="input" style={fld} value={form.fecha_desde} onChange={e => set('fecha_desde', e.target.value)} />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Motivo</div>
              <input type="text" className="input" style={fld} value={form.motivo} onChange={e => set('motivo', e.target.value)} placeholder="Motivo del pase de sector…" />
            </div>
          </div>
          <div className="js-modal-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn js-btn-save" onClick={guardar} disabled={saving}>
              {saving ? '⏳…' : '💾 Asignar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Cerrar sector ─────────────────────────────────────────────────────
interface CerrarSectorModalProps {
  pase: any;
  sectores: any[];
  onClose: () => void;
  onSaved: () => void;
}
function CerrarSectorModal({ pase, sectores, onClose, onSaved }: CerrarSectorModalProps) {
  const toast = useToast();
  const hoy = new Date().toISOString().slice(0, 10);
  const [fechaHasta, setFechaHasta] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const lbl = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const fld = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };
  const sectorNom = sectores.find((s: any) => String(s.id) === String(pase.sector_id))?.nombre || `Sector #${pase.sector_id}`;

  const guardar = async () => {
    if (!fechaHasta) { toast.error('Ingresá la fecha de cierre'); return; }
    setSaving(true);
    try {
      await apiFetch<any>(`/agentes_sectores/${pase.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fecha_hasta: fechaHasta, motivo: motivo || null }),
      });
      toast.ok('Sector cerrado', sectorNom);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al cerrar sector', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="js-overlay" onClick={onClose}>
      <div className="js-modal js-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="js-modal-header">
          <div className="js-modal-title">🔒 Cerrar Sector</div>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="js-modal-body">
          <div style={{ fontSize: '0.84rem', marginBottom: 10 }}>
            Cerrando pase en sector <b>{sectorNom}</b>
          </div>
          <div className="js-form-grid">
            <div className="js-field">
              <div style={lbl}>Fecha hasta *</div>
              <input type="date" className="input" style={fld} value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Motivo</div>
              <input type="text" className="input" style={fld} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo del cierre…" />
            </div>
          </div>
          <div className="js-modal-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn js-btn-cerrar" onClick={guardar} disabled={saving}>
              {saving ? '⏳…' : '🔒 Cerrar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Panel historial de sectores del agente ───────────────────────────────────
interface SectoresAgenteProps {
  agente: any;
  servicioId: number | null;
  sectores: any[];
  jefeNombre: string;
}
function SectoresAgente({ agente, servicioId, sectores, jefeNombre }: SectoresAgenteProps) {
  const toast = useToast();
  const [pases,          setPases]          = useState<any[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [modalAsignar,   setModalAsignar]   = useState(false);
  const [modalCerrar,    setModalCerrar]    = useState<any>(null);

  const cargar = () => {
    if (!agente?.dni) return;
    setLoading(true);
    fetchAll(`/agentes_sectores?dni=${agente.dni}&sort=-fecha_desde`)
      .then(rows => setPases(rows))
      .catch(() => setPases([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [agente?.dni]);

  const paseActivo = pases.find((p: any) => !p.fecha_hasta);

  const intentarAsignar = () => {
    if (paseActivo) {
      toast.error('⛔ Sector activo sin cerrar', 'Cerrá el sector actual antes de asignar uno nuevo.');
      return;
    }
    setModalAsignar(true);
  };

  return (
    <>
      <div className="js-section-header" style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 600 }}>
          📍 Sectores
          {paseActivo && <span className="js-badge-activo">🟢 Activo</span>}
          <span style={{ color: '#475569', fontSize: '0.72rem', fontWeight: 400 }}>{pases.length} registros</span>
        </div>
        <button
          className="btn"
          type="button"
          style={{ fontSize: '0.72rem', padding: '3px 10px', background: paseActivo ? undefined : 'rgba(99,102,241,0.2)', color: paseActivo ? undefined : '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}
          onClick={intentarAsignar}
          title={paseActivo ? 'Cerrá el sector actual antes de asignar uno nuevo' : 'Asignar nuevo sector'}
        >
          📍 Asignar Sector
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#475569', fontSize: '0.78rem' }}>🔄 Cargando…</div>
      ) : pases.length === 0 ? (
        <div style={{ color: '#475569', fontSize: '0.78rem' }}>Sin sectores asignados</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pases.map((p: any) => {
            const abierto = !p.fecha_hasta;
            const sectorNom = sectores.find((s: any) => String(s.id) === String(p.sector_id))?.nombre || `Sector #${p.sector_id}`;
            return (
              <div key={p.id} style={{
                borderRadius: 8, padding: '8px 10px',
                background: abierto ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${abierto ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.07)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: abierto ? '#a5b4fc' : '#64748b' }}>
                      {abierto ? '🟢 ACTIVO' : '⬜ CERRADO'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{sectorNom}</span>
                  </div>
                  {abierto && (
                    <button
                      className="btn js-btn-cerrar"
                      type="button"
                      style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                      onClick={() => setModalCerrar(p)}
                    >🔒 Cerrar</button>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>📅 Desde: <b style={{ color: '#94a3b8' }}>{fmt(p.fecha_desde)}</b></span>
                  {p.fecha_hasta && <span>Hasta: <b style={{ color: '#94a3b8' }}>{fmt(p.fecha_hasta)}</b></span>}
                  {p.jefe_nombre && <span>👤 {p.jefe_nombre}</span>}
                  {p.motivo && <span>— {p.motivo}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalAsignar && (
        <AsignarSectorModal
          agente={agente}
          servicioId={servicioId}
          sectores={sectores}
          jefeNombre={jefeNombre}
          onClose={() => setModalAsignar(false)}
          onSaved={cargar}
        />
      )}
      {modalCerrar && (
        <CerrarSectorModal
          pase={modalCerrar}
          sectores={sectores}
          onClose={() => setModalCerrar(null)}
          onSaved={cargar}
        />
      )}
    </>
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

// ─── Modal: Nuevo franco desde tab sector (con selector de agente) ────────────
interface NuevoFrancoSectorModalProps {
  agentes: any[];
  sectorId: number | null;
  jefeNombre: string;
  onClose: () => void;
  onSaved: () => void;
}
function NuevoFrancoSectorModal({ agentes, sectorId, jefeNombre, onClose, onSaved }: NuevoFrancoSectorModalProps) {
  const toast = useToast();
  const [dniSel, setDniSel] = useState('');
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

  const sorted = [...agentes].sort((a, b) =>
    `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es')
  );

  const guardar = async () => {
    if (!dniSel) { toast.error('Seleccioná un agente'); return; }
    if (!form.fecha_franco) { toast.error('Ingresá la fecha del franco'); return; }
    const ag = agentes.find((a: any) => String(a.dni) === dniSel);
    setSaving(true);
    try {
      await apiFetch<any>('/francos_compensatorios', {
        method: 'POST',
        body: JSON.stringify({
          dni:           Number(dniSel),
          fecha_franco:  form.fecha_franco,
          fecha_trabajo: form.fecha_trabajo || null,
          motivo:        form.motivo        || null,
          observaciones: form.observaciones || null,
          estado:        'PENDIENTE',
          jefe_nombre:   jefeNombre         || null,
          sector_id:     sectorId           ?? null,
        }),
      });
      toast.ok('Franco cargado', ag ? `${ag.apellido}, ${ag.nombre}` : `DNI ${dniSel}`);
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
            <div className="js-modal-sub">Seleccioná el agente del sector</div>
          </div>
          <button className="btn" onClick={onClose} type="button">✕</button>
        </div>
        <div className="js-modal-body">
          <div className="js-form-grid">
            <div className="js-field js-field-full">
              <div style={lbl}>Agente *</div>
              <select className="input" style={fld} value={dniSel} onChange={e => setDniSel(e.target.value)}>
                <option value="">— Seleccioná un agente —</option>
                {sorted.map((a: any) => (
                  <option key={a.dni} value={String(a.dni)}>
                    {a.apellido}, {a.nombre} · DNI {a.dni}
                  </option>
                ))}
              </select>
            </div>
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
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {Date.now() - new Date(f.created_at).getTime() > 48 * 60 * 60 * 1000 && (
                        <span style={{ fontSize: '0.65rem', color: '#475569' }}>🔒 +48h</span>
                      )}
                      <span style={{ color: '#64748b', fontSize: '0.68rem' }}>#{f.id}</span>
                    </div>
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

// ─── Panel Artículo 26 ────────────────────────────────────────────────────────
interface Art26ModalProps {
  agente: any;
  sectorId: number | null;
  jefeNombre: string;
  record?: any; // si existe, es edición
  onClose: () => void;
  onSaved: () => void;
}
function Art26Modal({ agente, sectorId, jefeNombre, record, onClose, onSaved }: Art26ModalProps) {
  const toast = useToast();
  const hoy = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fecha:        record?.fecha?.slice(0, 10) || hoy,
    dias:         record?.dias ? String(record.dias) : '',
    motivo:       record?.motivo || '',
    observaciones: record?.observaciones || '',
    estado:       record?.estado || 'PENDIENTE',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const lbl = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const fld = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };

  const guardar = async () => {
    if (!form.fecha) { toast.error('Ingresá la fecha'); return; }
    setSaving(true);
    try {
      const body = {
        dni:          agente.dni,
        fecha:        form.fecha,
        dias:         form.dias ? Number(form.dias) : null,
        motivo:       form.motivo || null,
        observaciones: form.observaciones || null,
        sector_id:    sectorId ?? null,
        jefe_nombre:  jefeNombre || null,
        estado:       form.estado,
      };
      if (record?.id) {
        await apiFetch<any>(`/articulo_26/${record.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Registro actualizado');
      } else {
        await apiFetch<any>('/articulo_26', { method: 'POST', body: JSON.stringify(body) });
        toast.ok('Artículo 26 cargado', `${agente.apellido}, ${agente.nombre}`);
      }
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
            <div className="js-modal-title">📋 {record ? 'Editar' : 'Nuevo'} Artículo 26</div>
            <div className="js-modal-sub">{agente.apellido}, {agente.nombre} · DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">✕</button>
        </div>
        <div className="js-modal-body">
          <div className="js-form-grid">
            <div className="js-field">
              <div style={lbl}>Fecha *</div>
              <input type="date" className="input" style={fld} value={form.fecha} min={!record ? hoy : undefined} onChange={e => set('fecha', e.target.value)} />
            </div>
            <div className="js-field">
              <div style={lbl}>Días</div>
              <input type="number" className="input" style={fld} value={form.dias} onChange={e => set('dias', e.target.value)} min="1" placeholder="Ej: 3" />
            </div>
            <div className="js-field">
              <div style={lbl}>Estado</div>
              <select className="input" style={fld} value={form.estado} onChange={e => set('estado', e.target.value)}>
                <option value="PENDIENTE">PENDIENTE</option>
                <option value="APROBADO">APROBADO</option>
                <option value="RECHAZADO">RECHAZADO</option>
                <option value="ANULADO">ANULADO</option>
              </select>
            </div>
            <div className="js-field">
              <div style={lbl}>Jefe</div>
              <input type="text" className="input" style={{ ...fld, color: '#94a3b8' }} value={jefeNombre} disabled />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Motivo *</div>
              <input type="text" className="input" style={fld} value={form.motivo} onChange={e => set('motivo', e.target.value)} placeholder="Motivo del Artículo 26…" />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Observaciones</div>
              <textarea className="input" rows={2} style={{ ...fld, resize: 'vertical' }} value={form.observaciones} onChange={e => set('observaciones', e.target.value)} />
            </div>
          </div>
          <div className="js-modal-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn js-btn-save" onClick={guardar} disabled={saving}>
              {saving ? '⏳ Guardando…' : '💾 Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Panel Art. 26 por agente ─────────────────────────────────────────────────
interface Art26AgenteProps {
  agente: any;
  sectorId: number | null;
  jefeNombre: string;
}
function Art26Agente({ agente, sectorId, jefeNombre }: Art26AgenteProps) {
  const toast = useToast();
  const [records,   setRecords]   = useState<any[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [expanded,  setExpanded]  = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);

  const ESTADO_COLOR: Record<string, string> = {
    PENDIENTE: '#fbbf24', APROBADO: '#22c55e', RECHAZADO: '#ef4444', ANULADO: '#64748b',
  };

  const canEdit = (r: any) => {
    const diffMs = Date.now() - new Date(r.created_at).getTime();
    return diffMs < 48 * 60 * 60 * 1000; // menos de 48 horas
  };

  const cargar = () => {
    if (!agente?.dni) return;
    setLoading(true);
    fetchAll(`/articulo_26?dni=${agente.dni}&sort=-fecha`)
      .then(rows => setRecords(rows))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [agente?.dni]);

  const eliminar = async (id: number, created_at: string) => {
    if (!canEdit({ created_at })) { toast.error('No se puede eliminar', 'Han pasado más de 48 horas'); return; }
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      await apiFetch<any>(`/articulo_26/${id}`, { method: 'DELETE' });
      toast.ok('Registro eliminado');
      cargar();
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error');
    }
  };

  const pendientes = records.filter(r => r.estado === 'PENDIENTE').length;

  return (
    <>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
            📋 Artículo 26
            <span style={{ marginLeft: 8, fontSize: '0.7rem', color: '#64748b' }}>
              {records.length} registro{records.length !== 1 ? 's' : ''}
              {pendientes > 0 && <span style={{ marginLeft: 6, color: '#fbbf24' }}>· {pendientes} pendiente{pendientes !== 1 ? 's' : ''}</span>}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="btn js-btn-save" type="button"
              style={{ padding: '2px 9px', fontSize: '0.73rem' }}
              onClick={() => { setEditRecord(null); setModalOpen(true); }}>
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
          ) : records.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '0.8rem' }}>Sin registros de Artículo 26</div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {records.map((r: any) => {
                const editable = canEdit(r);
                return (
                  <div key={r.id} style={{
                    padding: '7px 10px', marginBottom: 5, borderRadius: 7,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    fontSize: '0.78rem',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, color: ESTADO_COLOR[r.estado] || '#e2e8f0' }}>
                        {r.estado}
                        {r.dias && <span style={{ marginLeft: 6, color: '#94a3b8' }}>{r.dias} días</span>}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {editable && (
                          <>
                            <button className="btn" type="button"
                              style={{ padding: '1px 7px', fontSize: '0.68rem' }}
                              onClick={() => { setEditRecord(r); setModalOpen(true); }}>
                              ✏️
                            </button>
                            <button className="btn js-btn-danger" type="button"
                              style={{ padding: '1px 7px', fontSize: '0.68rem' }}
                              onClick={() => eliminar(r.id, r.created_at)}>
                              🗑️
                            </button>
                          </>
                        )}
                        {!editable && (
                          <span style={{ fontSize: '0.65rem', color: '#475569' }}>🔒 +48h</span>
                        )}
                      </div>
                    </div>
                    <div style={{ color: '#94a3b8', display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                      <span>Fecha: <b>{fmt(r.fecha)}</b></span>
                      {r.jefe_nombre && <span>👤 {r.jefe_nombre}</span>}
                    </div>
                    {r.motivo && <div style={{ color: '#cbd5e1', marginTop: 3 }}>{r.motivo}</div>}
                    {r.observaciones && <div style={{ color: '#64748b', marginTop: 2, fontStyle: 'italic' }}>{r.observaciones}</div>}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {modalOpen && (
        <Art26Modal
          agente={agente}
          sectorId={sectorId}
          jefeNombre={jefeNombre}
          record={editRecord}
          onClose={() => { setModalOpen(false); setEditRecord(null); }}
          onSaved={() => { setExpanded(true); cargar(); }}
        />
      )}
    </>
  );
}

// ─── Componentes genéricos: Papcolpo / Examen / Pre-examen ──────────────────
// Reutilizamos un único modal y un único panel por tabla.
interface MedModalProps {
  agente: any;
  sectorId: number | null;
  jefeNombre: string;
  endpoint: string;         // '/papcolpo' | '/examen' | '/prexamen'
  label: string;
  tipoOpciones: string[] | null;  // null → input libre
  record?: any;
  onClose: () => void;
  onSaved: () => void;
}
function MedModal({ agente, sectorId, jefeNombre, endpoint, label, tipoOpciones, record, onClose, onSaved }: MedModalProps) {
  const toast = useToast();
  const hoy = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fecha:        record?.fecha?.slice(0, 10) || hoy,
    tipo:         record?.tipo || (tipoOpciones ? tipoOpciones[0] : ''),
    resultado:    record?.resultado || '',
    observaciones: record?.observaciones || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const lbl = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const fld = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };

  const guardar = async () => {
    if (!form.fecha) { toast.error('Ingresá la fecha'); return; }
    setSaving(true);
    try {
      const body = {
        dni:          agente.dni,
        fecha:        form.fecha,
        tipo:         form.tipo || null,
        resultado:    form.resultado || null,
        observaciones: form.observaciones || null,
        sector_id:    sectorId ?? null,
        jefe_nombre:  jefeNombre || null,
      };
      if (record?.id) {
        await apiFetch<any>(`${endpoint}/${record.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Registro actualizado');
      } else {
        await apiFetch<any>(endpoint, { method: 'POST', body: JSON.stringify(body) });
        toast.ok(`${label} cargado`, `${agente.apellido}, ${agente.nombre}`);
      }
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
            <div className="js-modal-title">{record ? 'Editar' : 'Nuevo'} {label}</div>
            <div className="js-modal-sub">{agente.apellido}, {agente.nombre} · DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">✕</button>
        </div>
        <div className="js-modal-body">
          <div className="js-form-grid">
            <div className="js-field">
              <div style={lbl}>Fecha *</div>
              <input type="date" className="input" style={fld} value={form.fecha} onChange={e => set('fecha', e.target.value)} />
            </div>
            <div className="js-field">
              <div style={lbl}>Tipo</div>
              {tipoOpciones ? (
                <select className="input" style={fld} value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                  {tipoOpciones.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type="text" className="input" style={fld} value={form.tipo} onChange={e => set('tipo', e.target.value)} placeholder="Tipo de examen…" />
              )}
            </div>
            <div className="js-field">
              <div style={lbl}>Jefe</div>
              <input type="text" className="input" style={{ ...fld, color: '#94a3b8' }} value={jefeNombre} disabled />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Resultado</div>
              <input type="text" className="input" style={fld} value={form.resultado} onChange={e => set('resultado', e.target.value)} placeholder="Resultado…" />
            </div>
            <div className="js-field js-field-full">
              <div style={lbl}>Observaciones</div>
              <textarea className="input" rows={2} style={{ ...fld, resize: 'vertical' }} value={form.observaciones} onChange={e => set('observaciones', e.target.value)} />
            </div>
          </div>
          <div className="js-modal-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn js-btn-save" onClick={guardar} disabled={saving}>
              {saving ? '⏳ Guardando…' : '💾 Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MedAgenteProps {
  agente: any;
  sectorId: number | null;
  jefeNombre: string;
  endpoint: string;
  label: string;
  emoji: string;
  tipoOpciones: string[] | null;
}
function MedAgente({ agente, sectorId, jefeNombre, endpoint, label, emoji, tipoOpciones }: MedAgenteProps) {
  const toast = useToast();
  const [records,    setRecords]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [expanded,   setExpanded]   = useState(false);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);

  const canEdit = (r: any) => Date.now() - new Date(r.created_at).getTime() < 48 * 60 * 60 * 1000;

  const cargar = () => {
    if (!agente?.dni) return;
    setLoading(true);
    fetchAll(`${endpoint}?dni=${agente.dni}&sort=-fecha`)
      .then(rows => setRecords(rows))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [agente?.dni]);

  const eliminar = async (id: number, created_at: string) => {
    if (!canEdit({ created_at })) { toast.error('No se puede eliminar', 'Han pasado más de 48 horas'); return; }
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      await apiFetch<any>(`${endpoint}/${id}`, { method: 'DELETE' });
      toast.ok('Registro eliminado');
      cargar();
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error');
    }
  };

  return (
    <>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
            {emoji} {label}
            <span style={{ marginLeft: 8, fontSize: '0.7rem', color: '#64748b' }}>
              {records.length} registro{records.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="btn js-btn-save" type="button"
              style={{ padding: '2px 9px', fontSize: '0.73rem' }}
              onClick={() => { setEditRecord(null); setModalOpen(true); }}>
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
          ) : records.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '0.8rem' }}>Sin registros de {label}</div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {records.map((r: any) => {
                const editable = canEdit(r);
                return (
                  <div key={r.id} style={{
                    padding: '7px 10px', marginBottom: 5, borderRadius: 7,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    fontSize: '0.78rem',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>
                        {r.tipo || label}
                        {r.resultado && <span style={{ marginLeft: 6, color: '#94a3b8', fontWeight: 400 }}>→ {r.resultado}</span>}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {editable && (
                          <>
                            <button className="btn" type="button"
                              style={{ padding: '1px 7px', fontSize: '0.68rem' }}
                              onClick={() => { setEditRecord(r); setModalOpen(true); }}>
                              ✏️
                            </button>
                            <button className="btn js-btn-danger" type="button"
                              style={{ padding: '1px 7px', fontSize: '0.68rem' }}
                              onClick={() => eliminar(r.id, r.created_at)}>
                              🗑️
                            </button>
                          </>
                        )}
                        {!editable && <span style={{ fontSize: '0.65rem', color: '#475569' }}>🔒 +48h</span>}
                      </div>
                    </div>
                    <div style={{ color: '#94a3b8', display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                      <span>Fecha: <b>{fmt(r.fecha)}</b></span>
                      {r.jefe_nombre && <span>👤 {r.jefe_nombre}</span>}
                    </div>
                    {r.observaciones && <div style={{ color: '#64748b', marginTop: 2, fontStyle: 'italic' }}>{r.observaciones}</div>}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {modalOpen && (
        <MedModal
          agente={agente}
          sectorId={sectorId}
          jefeNombre={jefeNombre}
          endpoint={endpoint}
          label={label}
          tipoOpciones={tipoOpciones}
          record={editRecord}
          onClose={() => { setModalOpen(false); setEditRecord(null); }}
          onSaved={() => { setExpanded(true); cargar(); }}
        />
      )}
    </>
  );
}

// ─── Tabla global de registros médicos (tab-nivel sector/global) ─────────────
interface MedTablaGlobalProps {
  endpoint: string;
  label: string;
  emoji: string;
  agentesMap: Record<string, any>;
  sectorId: number | null;
  isGlobal: boolean;
  servicios: any[];
  sectores: any[];
}
function MedTablaGlobal({ endpoint, label, emoji, agentesMap, sectorId, isGlobal, servicios, sectores }: MedTablaGlobalProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const url = isGlobal ? `${endpoint}?sort=-fecha` : `${endpoint}?sector_id=${sectorId}&sort=-fecha`;
    fetchAll(url)
      .then(r => setRows(r))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [endpoint, sectorId, isGlobal]);

  return (
    <div className="card js-card">
      <div className="js-section-title" style={{ marginBottom: 12 }}>
        {emoji} {label}
        <span style={{ marginLeft: 8, fontSize: '0.72rem', color: '#64748b', fontWeight: 400 }}>
          ({rows.length} registro{rows.length !== 1 ? 's' : ''} · {isGlobal ? 'todo el sistema' : 'este sector'})
        </span>
      </div>
      {loading ? (
        <div className="js-loading">🔄 Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="js-empty">Sin registros de {label}</div>
      ) : (
        <div className="js-tabla-wrap">
          <table className="js-tabla">
            <thead>
              <tr>
                <th>DNI</th>
                <th>Agente</th>
                <th>Tipo</th>
                <th>Fecha</th>
                <th>Resultado</th>
                <th>Jefe</th>
                <th>Cargado el</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const ag = agentesMap[String(r.dni)];
                const nombre = ag ? `${ag.apellido}, ${ag.nombre}` : `DNI ${r.dni}`;
                return (
                  <tr key={r.id}>
                    <td className="js-td-dni">{r.dni}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{nombre}</td>
                    <td style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{r.tipo || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{fmt(r.fecha)}</td>
                    <td className="js-td-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.resultado || '—'}
                    </td>
                    <td className="js-td-muted">{r.jefe_nombre || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#64748b' }}>{fmtDateTime(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
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

  // jefe_servicio se identifica por servicio_id en su usuario
  const servicioId: number | null = u?.servicio_id ?? null;
  const servicioNombre: string = u?.servicio_nombre || `Servicio #${servicioId}`;

  // admin (crud:*:*) ve TODO; jefe_servicio ve solo su servicio
  const isGlobal = hasPermission(perms, 'crud:*:*');
  // Solo el admin puede asignar/cambiar servicios; el jefe solo gestiona sectores
  const canAsignarServicio = hasPermission(perms, 'crud:*:*');

  // Datos maestros
  const [servicios,    setServicios]    = useState<any[]>([]);
  const [dependencias, setDependencias] = useState<any[]>([]);
  const [sectores,     setSectores]     = useState<any[]>([]);
  const [loadingMaestros, setLoadingMaestros] = useState(true);

  // Agentes del sector
  const [agentes,          setAgentes]          = useState<any[]>([]);
  const [agentesAsignados, setAgentesAsignados] = useState<any[]>([]);
  const [loadingAg,        setLoadingAg]        = useState(false);

  // Búsqueda (panel izquierdo — sin servicio activo)
  const [busquedaDni,    setBusquedaDni]    = useState('');
  const [busquedaNombre, setBusquedaNombre] = useState('');

  // Paginación listas de agentes
  const PAGE_SIZE = 20;
  const [paginaAgentes,   setPaginaAgentes]   = useState(1);
  const [paginaAsignados, setPaginaAsignados] = useState(1);

  // Búsqueda independiente para tab Agentes Asignados
  const [busquedaAsigDni,    setBusquedaAsigDni]    = useState('');
  const [busquedaAsigNombre, setBusquedaAsigNombre] = useState('');

  // Agente seleccionado
  const [agenteActivo, setAgenteActivo] = useState<any>(null);

  // Pases del agente seleccionado
  const [pases,       setPases]       = useState<any[]>([]);
  const [loadingPases, setLoadingPases] = useState(false);

  // Modales
  const [modalAsignar,       setModalAsignar]       = useState(false);
  const [modalCerrar,        setModalCerrar]        = useState<any>(null);

  // Tab
  const [tab, setTab] = useState<'agentes' | 'asignados' | 'todos_pases' | 'licencias' | 'articulo26' | 'francos' | 'papcolpo' | 'examen' | 'prexamen'>('agentes');

  // Agentes de licencia (reconocimientos médicos activos del sector)
  const [licenciasActivas, setLicenciasActivas] = useState<any[]>([]);
  const [loadingLicencias, setLoadingLicencias] = useState(false);
  const [licenciasSet, setLicenciasSet] = useState<Set<string>>(new Set());

  // Todos los pases del sector (tab 2)
  const [todosPases,      setTodosPases]      = useState<any[]>([]);
  const [loadingTodosPases, setLoadingTodosPases] = useState(false);
  const [filtroPases,     setFiltroPases]     = useState<'todos' | 'activos' | 'cerrados'>('todos');

  // Francos compensatorios del sector
  const [francosSector,          setFrancosSector]          = useState<any[]>([]);
  const [loadingFrancos,         setLoadingFrancos]         = useState(false);
  const [filtroFrancos,          setFiltroFrancos]          = useState<'todos' | 'PENDIENTE' | 'APROBADO' | 'TOMADO' | 'ANULADO'>('PENDIENTE');
  const [modalNuevoFrancoSector, setModalNuevoFrancoSector] = useState(false);
  const [savingFrancoId,         setSavingFrancoId]         = useState<number | null>(null);

  // ── Cargar maestros ───────────────────────────────────────────────────────
  useEffect(() => {
    Promise.allSettled([
      fetchAll('/servicios').then(rows => setServicios(rows)),
      fetchAll('/reparticiones').then(rows => setDependencias(rows)),
      fetchAll('/sectores').then(rows => setSectores(rows)),
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

  // ── DNIs con servicio activo (sin fecha_hasta) ───────────────────────────
  const [dniConServicio,  setDniConServicio]  = useState<Set<string>>(new Set());
  const [dniConArt26,     setDniConArt26]     = useState<Set<string>>(new Set());

  // Mapa dni → sector_id activo (de agentes_sectores, sin fecha_hasta)
  const [dniSectorActivo, setDniSectorActivo] = useState<Record<string, number | null>>({});

  const cargarDniConArt26 = useCallback(async () => {
    try {
      const rows = await fetchAll('/articulo_26');
      setDniConArt26(new Set(rows.map((r: any) => String(r.dni))));
    } catch { /* no bloquear */ }
  }, []);

  // ── Cargar agentes ────────────────────────────────────────────────────────
  // - Admin (isGlobal): todos los agentes ACTIVOS; agentes_servicios solo para saber quién tiene servicio
  // - Jefe: solo los agentes de su servicio (agentes_servicios con su servicio_id)
  const cargarAgentes = useCallback(async () => {
    if (!isGlobal && !servicioId) return;
    setLoadingAg(true);
    try {
      if (isGlobal) {
        // Admin: carga TODOS los activos, más agentes_servicios para marcar quiénes tienen servicio
        const [todos, pasesServicio, pasesSector] = await Promise.all([
          fetchAll(`/personal/search?estado_empleo=ACTIVO`),
          fetchAll(`/agentes_servicios`),
          fetchAll(`/agentes_sectores`),
        ]);
        const activos = pasesServicio.filter((p: any) => !p.fecha_hasta);
        const dnisConServicio = new Set(activos.map((p: any) => String(p.dni)));
        setDniConServicio(dnisConServicio);
        const mapaSecActivo: Record<string, number | null> = {};
        for (const ps of pasesSector) {
          if (!ps.fecha_hasta) mapaSecActivo[String(ps.dni)] = Number(ps.sector_id);
        }
        setDniSectorActivo(mapaSecActivo);
        setAgentesAsignados(todos.filter((a: any) =>  dnisConServicio.has(String(a.dni))));
        setAgentes(        todos.filter((a: any) => !dnisConServicio.has(String(a.dni))));
      } else {
        // Jefe: filtra por su servicio_id
        const [pasesServicio, pasesSector] = await Promise.all([
          fetchAll(`/agentes_servicios?servicio_id=${servicioId}`),
          fetchAll(`/agentes_sectores?servicio_id=${servicioId}`),
        ]);
        const pasesActivos = pasesServicio.filter((p: any) => !p.fecha_hasta);
        const dnisConServicio = new Set(pasesActivos.map((p: any) => String(p.dni)));
        setDniConServicio(dnisConServicio);
        if (dnisConServicio.size === 0) {
          setAgentes([]);
          setDniSectorActivo({});
          return;
        }
        const mapaSecActivo: Record<string, number | null> = {};
        for (const ps of pasesSector) {
          if (!ps.fecha_hasta) mapaSecActivo[String(ps.dni)] = Number(ps.sector_id);
        }
        setDniSectorActivo(mapaSecActivo);
        const todos = await fetchAll(`/personal/search?estado_empleo=ACTIVO`);
        setAgentesAsignados(todos.filter((a: any) =>  dnisConServicio.has(String(a.dni))));
        setAgentes(         todos.filter((a: any) =>  dnisConServicio.has(String(a.dni))));
      }
    } catch (e: any) {
      toast.error('Error cargando agentes', e?.message);
    } finally {
      setLoadingAg(false);
    }
  }, [isGlobal, servicioId]);

  useEffect(() => { cargarAgentes(); }, [cargarAgentes]);

  // Cuando los agentes están listos, cargar sus licencias activas
  useEffect(() => {
    if (agentes.length > 0) cargarLicencias(agentes);
  }, [agentes, cargarLicencias]);

  useEffect(() => { cargarDniConArt26(); }, [cargarDniConArt26]);

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

  // ── Cargar todos los pases (todos si global, solo servicio si jefe) ──────
  const cargarTodosPases = useCallback(async () => {
    if (!isGlobal && !servicioId) return;
    setLoadingTodosPases(true);
    try {
      const url = isGlobal
        ? `/agentes_servicios?sort=-created_at`
        : `/agentes_servicios?servicio_id=${servicioId}&sort=-created_at`;
      const rows = await fetchAll(url);
      setTodosPases(rows);
    } catch { setTodosPases([]); }
    finally { setLoadingTodosPases(false); }
  }, [isGlobal, servicioId]);

  useEffect(() => {
    if (tab === 'todos_pases') cargarTodosPases();
  }, [tab, cargarTodosPases]);

  // ── Cargar francos del sector ─────────────────────────────────────────────
  const cargarFrancos = useCallback(async () => {
    if (!isGlobal && !servicioId) return;
    setLoadingFrancos(true);
    try {
      const url = isGlobal
        ? `/francos_compensatorios?sort=-fecha_franco`
        : `/francos_compensatorios?servicio_id=${servicioId}&sort=-fecha_franco`;
      const rows = await fetchAll(url);
      // Si es jefe con sector, filtrar solo francos de agentes del sector
      if (!isGlobal && agentes.length > 0) {
        const dniSet = new Set(agentes.map((a: any) => String(a.dni)));
        setFrancosSector(rows.filter((f: any) => dniSet.has(String(f.dni))));
      } else {
        setFrancosSector(rows);
      }
    } catch { setFrancosSector([]); }
    finally { setLoadingFrancos(false); }
  }, [isGlobal, servicioId, agentes]);

  useEffect(() => {
    if (tab === 'francos') cargarFrancos();
  }, [tab, cargarFrancos]);

  const cambiarEstadoFranco = useCallback(async (id: number, estado: string) => {
    setSavingFrancoId(id);
    try {
      await apiFetch<any>(`/francos_compensatorios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado }),
      });
      setFrancosSector(prev => prev.map(f => f.id === id ? { ...f, estado } : f));
      toast.ok(`Franco ${estado.toLowerCase()}`);
    } catch (e: any) {
      toast.error('Error al actualizar franco', e?.message || 'Error');
    } finally {
      setSavingFrancoId(null);
    }
  }, []);

  // ── Búsqueda local ───────────────────────────────────────────────────────
  const busquedaFn = (a: any) => {
    if (busquedaDni.trim()) return String(a.dni).includes(busquedaDni.trim());
    if (busquedaNombre.trim()) {
      const q = busquedaNombre.toLowerCase();
      return (
        (a.apellido || '').toLowerCase().includes(q) ||
        (a.nombre   || '').toLowerCase().includes(q)
      );
    }
    return true;
  };
  const busquedaAsigFn = (a: any) => {
    if (busquedaAsigDni.trim()) return String(a.dni).includes(busquedaAsigDni.trim());
    if (busquedaAsigNombre.trim()) {
      const q = busquedaAsigNombre.toLowerCase();
      return (
        (a.apellido || '').toLowerCase().includes(q) ||
        (a.nombre   || '').toLowerCase().includes(q)
      );
    }
    return true;
  };
  // Todos los agentes del servicio van al panel izquierdo (fuente = agentes_servicios activos)
  const agentesFiltrados = agentes.filter(busquedaFn);
  // Tab Asignados: agentes que SÍ tienen servicio activo
  const asignadosBase = agentesAsignados;
  const asignadosFiltrados = asignadosBase.filter(busquedaAsigFn);

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
    const title = `Agentes Servicio ${servicioNombre}`;
    const file  = `agentes_servicio_${servicioId}`;
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
    const file = `pases_servicio_${servicioId}`;
    if (tipo === 'excel') exportToExcel(`${file}.xlsx`, rows);
    if (tipo === 'pdf')   exportToPdf(`${file}.pdf`, rows);
    if (tipo === 'print') printTable(`Pases Servicio ${servicioNombre}`, rows);
  };

  // Bloqueamos si NO es global Y no tiene servicio_id
  if (!isGlobal && !servicioId) {
    return (
      <Layout title="Gestión de Sectores" showBack>
        <div className="card js-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚠️</div>
          <div style={{ color: '#f59e0b', fontWeight: 600 }}>Sin servicio asignado</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Tu usuario no tiene servicio_id configurado. Solicitá al administrador que lo configure.
          </div>
        </div>
      </Layout>
    );
  }

  const headerTitle = isGlobal ? 'Todos los sectores' : servicioNombre;
  const headerIcon  = isGlobal ? '🌐' : '🏥';

  return (
    <Layout title="Gestión de Sectores" showBack>
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
                  onChange={e => { setBusquedaDni(e.target.value); setBusquedaNombre(''); setPaginaAgentes(1); }}
                  placeholder="Filtrar por DNI"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <div className="js-label">Apellido / Nombre</div>
                <input
                  className="input"
                  value={busquedaNombre}
                  onChange={e => { setBusquedaNombre(e.target.value); setBusquedaDni(''); setPaginaAgentes(1); }}
                  placeholder="Filtrar por nombre"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            {(busquedaDni || busquedaNombre) && (
              <button className="btn" style={{ marginTop: 6, fontSize: '0.75rem' }}
                onClick={() => { setBusquedaDni(''); setBusquedaNombre(''); setPaginaAgentes(1); }}>
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
            ) : (() => {
              const totalPags = Math.ceil(agentesFiltrados.length / PAGE_SIZE);
              const pagActual = Math.min(paginaAgentes, totalPags);
              const desde = (pagActual - 1) * PAGE_SIZE;
              const paginados = agentesFiltrados.slice(desde, desde + PAGE_SIZE);
              return (
                <>
                  <div className="js-agentes-list">
                    {paginados.map((a: any) => (
                      <button
                        key={a.dni}
                        type="button"
                        className={`js-agente-item${agenteActivo?.dni === a.dni ? ' active' : ''}`}
                        onClick={() => seleccionarAgente(a)}
                      >
                        <div className="js-agente-nombre" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {a.apellido}, {a.nombre}
                          {licenciasSet.has(String(a.dni)) && (
                            <span title="De licencia médica" style={{
                              fontSize: '0.65rem', background: 'rgba(220,38,38,0.2)',
                              color: '#fca5a5', borderRadius: 4, padding: '1px 5px', fontWeight: 600,
                            }}>🏥 LICENCIA</span>
                          )}
                          {dniConArt26.has(String(a.dni)) && (
                            <span title="Tiene Artículo 26" style={{
                              fontSize: '0.65rem', background: 'rgba(99,102,241,0.2)',
                              color: '#a5b4fc', borderRadius: 4, padding: '1px 5px', fontWeight: 600,
                            }}>📋 Art. 26</span>
                          )}
                        </div>
                        <div className="js-agente-meta">
                          DNI {a.dni}
                          {a.ley_nombre && ` · ${a.ley_nombre}`}
                          {a.categoria_nombre && ` · ${a.categoria_nombre}`}
                          {dniSectorActivo[String(a.dni)] != null
                            ? ` · 📍 ${sectores.find((s: any) => String(s.id) === String(dniSectorActivo[String(a.dni)]))?.nombre || `Sector #${dniSectorActivo[String(a.dni)]}`}`
                            : ' · 📍 Sin sector'
                          }
                        </div>
                      </button>
                    ))}
                  </div>
                  {totalPags > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                        disabled={pagActual === 1}
                        onClick={() => setPaginaAgentes(p => Math.max(1, p - 1))}>← Ant</button>
                      {Array.from({ length: totalPags }, (_, i) => i + 1).map(n => (
                        <button key={n} className="btn"
                          style={{ fontSize: '0.72rem', padding: '3px 8px', background: n === pagActual ? '#7c3aed' : undefined, color: n === pagActual ? '#fff' : undefined }}
                          onClick={() => setPaginaAgentes(n)}>{n}</button>
                      ))}
                      <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                        disabled={pagActual === totalPags}
                        onClick={() => setPaginaAgentes(p => Math.min(totalPags, p + 1))}>Sig →</button>
                    </div>
                  )}
                </>
              );
            })()}
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
              <button
                type="button"
                className={`js-tab${tab === 'articulo26' ? ' active' : ''}`}
                onClick={() => setTab('articulo26')}
              >📋 Art. 26</button>
              <button
                type="button"
                className={`js-tab${tab === 'francos' ? ' active' : ''}`}
                onClick={() => setTab('francos')}
              >📅 Francos</button>
              <button
                type="button"
                className={`js-tab${tab === 'papcolpo' ? ' active' : ''}`}
                onClick={() => setTab('papcolpo')}
              >🩺 Pap/Colpo</button>
              <button
                type="button"
                className={`js-tab${tab === 'examen' ? ' active' : ''}`}
                onClick={() => setTab('examen')}
              >🎓 Examen</button>
              <button
                type="button"
                className={`js-tab${tab === 'prexamen' ? ' active' : ''}`}
                onClick={() => setTab('prexamen')}
              >📝 Pre-examen</button>
              <button
                type="button"
                className={`js-tab${tab === 'asignados' ? ' active' : ''}`}
                onClick={() => setTab('asignados')}
              >
                🟢 Agentes Asignados
                {asignadosBase.length > 0 && (
                  <span style={{
                    marginLeft: 6, background: '#22c55e', color: '#fff',
                    borderRadius: 99, fontSize: '0.68rem', padding: '1px 7px', fontWeight: 700,
                  }}>{asignadosBase.length}</span>
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
                        sectorId={servicioId}
                        jefeNombre={u?.nombre || ''}
                      />
                    </div>

                    {/* Artículo 26 (lectura + carga) — solo agentes becados */}
                    {(agenteActivo.ley_nombre || '').toLowerCase().includes('beca') && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 10, paddingTop: 10 }}>
                        <Art26Agente
                          agente={agenteActivo}
                          sectorId={sectorId}
                          jefeNombre={u?.nombre || ''}
                        />
                      </div>
                    )}

                    {/* Papanicolaou / Colposcopía */}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 10, paddingTop: 10 }}>
                      <MedAgente
                        agente={agenteActivo}
                        sectorId={sectorId}
                        jefeNombre={u?.nombre || ''}
                        endpoint="/papcolpo"
                        label="Pap / Colpo"
                        emoji="🩺"
                        tipoOpciones={['PAP', 'COLPO', 'PAP_COLPO']}
                      />
                    </div>

                    {/* Examen (académico / facultad) */}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 10, paddingTop: 10 }}>
                      <MedAgente
                        agente={agenteActivo}
                        sectorId={sectorId}
                        jefeNombre={u?.nombre || ''}
                        endpoint="/examen"
                        label="Examen"
                        emoji="🎓"
                        tipoOpciones={null}
                      />
                    </div>

                    {/* Pre-examen (académico / facultad) */}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 10, paddingTop: 10 }}>
                      <MedAgente
                        agente={agenteActivo}
                        sectorId={sectorId}
                        jefeNombre={u?.nombre || ''}
                        endpoint="/prexamen"
                        label="Pre-examen"
                        emoji="📝"
                        tipoOpciones={null}
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
                      {canAsignarServicio && (
                        <button
                          className="btn js-btn-asignar"
                          type="button"
                          onClick={intentarAsignar}
                          disabled={loadingPases}
                          title={paseActivo ? 'Cerrá el servicio actual antes de asignar uno nuevo' : 'Asignar nuevo servicio'}
                        >
                          ➕ Asignar Servicio
                        </button>
                      )}
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
                                {p.sector_id && <span style={{ color: '#a5b4fc' }}>
                                  📍 {sectores.find((s: any) => String(s.id) === String(p.sector_id))?.nombre || `Sector #${p.sector_id}`}
                                </span>}
                                {!p.sector_id && !p.fecha_hasta && <span style={{ color: '#64748b', fontSize: '0.7rem' }}>Sin sector asignado</span>}
                              </div>
                              {p.motivo && <div className="js-pase-motivo">{p.motivo}</div>}
                              {abierto && canAsignarServicio && (
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
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

                  {/* Sectores del agente (historial) */}
                  <div className="card js-card">
                    <SectoresAgente
                      agente={agenteActivo}
                      servicioId={servicioId}
                      sectores={sectores}
                      jefeNombre={u?.nombre || ''}
                    />
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
                        <th>Sector</th>
                        <th>Desde</th>
                        <th>Hasta</th>
                        <th>Estado</th>
                        <th>Jefe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pasesFiltrados.map((p: any) => {
                        const abierto = !p.fecha_hasta;
                        const sectorNom = p.sector_id ? sectores.find((s: any) => String(s.id) === String(p.sector_id))?.nombre || `Sector #${p.sector_id}` : null;
                        return (
                          <tr key={p.id} className={abierto ? 'js-tr-activo' : ''}>
                            <td className="js-td-dni">{p.dni}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {(() => { const ag = agentesMap[String(p.dni)]; return ag ? `${ag.apellido}, ${ag.nombre}` : (p.apellido ? `${p.apellido}, ${p.nombre}` : `DNI ${p.dni}`); })()}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{p.servicio_nombre || servicios.find((s: any) => String(s.id) === String(p.servicio_id))?.nombre || `#${p.servicio_id}`}</td>
                            <td>
                              {sectorNom
                                ? <span style={{ color: '#a5b4fc', fontSize: '0.8rem' }}>{sectorNom}</span>
                                : <span style={{ color: '#475569', fontSize: '0.75rem' }}>—</span>
                              }
                            </td>
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

          {/* ── Tab Artículo 26 (becados) ── */}
          {tab === 'articulo26' && (() => {
            const becados = agentes.filter((a: any) => (a.ley_nombre || '').toLowerCase().includes('beca'));
            return (
              <div className="card js-card">
                <div className="js-section-title" style={{ marginBottom: 12 }}>
                  📋 Artículo 26 — Agentes Becados
                  <span style={{ marginLeft: 8, fontSize: '0.72rem', color: '#64748b', fontWeight: 400 }}>
                    ({becados.length} en {isGlobal ? 'todo el sistema' : 'este sector'})
                  </span>
                </div>
                {loadingAg ? (
                  <div className="js-loading">🔄 Cargando agentes…</div>
                ) : becados.length === 0 ? (
                  <div className="js-empty">No hay agentes becados en este sector</div>
                ) : (
                  <div className="js-tabla-wrap">
                    <table className="js-tabla">
                      <thead>
                        <tr>
                          <th>Apellido y Nombre</th>
                          <th>DNI</th>
                          <th>Ley / Programa</th>
                          <th>Ingreso</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {becados.map((a: any) => (
                          <tr
                            key={a.dni}
                            style={{ cursor: 'pointer' }}
                            onClick={() => { seleccionarAgente(a); setTab('agentes'); }}
                          >
                            <td style={{ fontWeight: 600 }}>{a.apellido}, {a.nombre}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{a.dni}</td>
                            <td style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{a.ley_nombre || '—'}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{fmt(a.fecha_ingreso)}</td>
                            <td>
                              <span style={{
                                fontSize: '0.68rem', padding: '2px 7px', borderRadius: 5, fontWeight: 700,
                                background: a.estado_empleo === 'ACTIVO' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                color: a.estado_empleo === 'ACTIVO' ? '#4ade80' : '#f87171',
                              }}>{a.estado_empleo || 'ACTIVO'}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
          {/* ── Tabs genéricos: Papcolpo / Examen / Pre-examen ── */}
          {(tab === 'papcolpo' || tab === 'examen' || tab === 'prexamen') && (() => {
            const cfg = {
              papcolpo: { endpoint: '/papcolpo', label: 'Pap / Colposcopía',        emoji: '🩺' },
              examen:   { endpoint: '/examen',   label: 'Examen (Facultad)',         emoji: '🎓' },
              prexamen: { endpoint: '/prexamen',  label: 'Pre-examen (Facultad)',    emoji: '📝' },
            }[tab];

            return (
              <MedTablaGlobal
                endpoint={cfg.endpoint}
                label={cfg.label}
                emoji={cfg.emoji}
                agentesMap={agentesMap}
                sectorId={isGlobal ? null : sectorId}
                isGlobal={isGlobal}
                servicios={servicios}
                sectores={sectores}
              />
            );
          })()}

          {/* ── Tab Agentes Asignados ── */}
          {tab === 'asignados' && (
            <div className="card js-card">
              <div className="js-section-title" style={{ marginBottom: 10 }}>
                🟢 Agentes con Servicio Activo
                <span style={{ marginLeft: 8, fontSize: '0.72rem', color: '#64748b', fontWeight: 400 }}>
                  ({asignadosFiltrados.length}{asignadosFiltrados.length !== asignadosBase.length ? ` de ${asignadosBase.length}` : ''} agentes)
                </span>
              </div>
              {/* Filtro propio del tab */}
              <div className="js-search-grid" style={{ marginBottom: 8 }}>
                <div>
                  <div className="js-label">DNI</div>
                  <input
                    className="input"
                    value={busquedaAsigDni}
                    onChange={e => { setBusquedaAsigDni(e.target.value); setBusquedaAsigNombre(''); setPaginaAsignados(1); }}
                    placeholder="Filtrar por DNI"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div className="js-label">Apellido / Nombre</div>
                  <input
                    className="input"
                    value={busquedaAsigNombre}
                    onChange={e => { setBusquedaAsigNombre(e.target.value); setBusquedaAsigDni(''); setPaginaAsignados(1); }}
                    placeholder="Filtrar por nombre"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              {(busquedaAsigDni || busquedaAsigNombre) && (
                <button className="btn" style={{ marginBottom: 8, fontSize: '0.75rem' }}
                  onClick={() => { setBusquedaAsigDni(''); setBusquedaAsigNombre(''); setPaginaAsignados(1); }}>
                  ✕ Limpiar filtro
                </button>
              )}
              {loadingAg ? (
                <div className="js-loading">🔄 Cargando…</div>
              ) : asignadosFiltrados.length === 0 ? (
                <div className="js-empty">Sin agentes asignados a servicio actualmente</div>
              ) : (() => {
                const totalPags = Math.ceil(asignadosFiltrados.length / PAGE_SIZE);
                const pagActual = Math.min(paginaAsignados, totalPags);
                const desde = (pagActual - 1) * PAGE_SIZE;
                const paginados = asignadosFiltrados.slice(desde, desde + PAGE_SIZE);
                return (
                  <>
                    <div className="js-agentes-list">
                      {paginados.map((a: any) => (
                        <button
                          key={a.dni}
                          type="button"
                          className={`js-agente-item${agenteActivo?.dni === a.dni ? ' active' : ''}`}
                          onClick={() => { seleccionarAgente(a); setTab('agentes'); }}
                        >
                          <div className="js-agente-nombre">
                            {a.apellido}, {a.nombre}
                            <span title="Tiene servicio activo" style={{
                              fontSize: '0.65rem', background: 'rgba(34,197,94,0.15)',
                              color: '#4ade80', borderRadius: 4, padding: '1px 5px', fontWeight: 600, marginLeft: 6,
                            }}>🟢 En servicio</span>
                          </div>
                          <div className="js-agente-meta">
                            DNI {a.dni}
                            {a.ley_nombre && ` · ${a.ley_nombre}`}
                          </div>
                        </button>
                      ))}
                    </div>
                    {totalPags > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                          disabled={pagActual === 1}
                          onClick={() => setPaginaAsignados(p => Math.max(1, p - 1))}>← Ant</button>
                        {Array.from({ length: totalPags }, (_, i) => i + 1).map(n => (
                          <button key={n} className="btn"
                            style={{ fontSize: '0.72rem', padding: '3px 8px', background: n === pagActual ? '#7c3aed' : undefined, color: n === pagActual ? '#fff' : undefined }}
                            onClick={() => setPaginaAsignados(n)}>{n}</button>
                        ))}
                        <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                          disabled={pagActual === totalPags}
                          onClick={() => setPaginaAsignados(p => Math.min(totalPags, p + 1))}>Sig →</button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
          {/* ── Tab Francos Compensatorios ── */}
          {tab === 'francos' && (() => {
            const FRANCO_COLOR: Record<string, string> = {
              PENDIENTE: '#fbbf24', APROBADO: '#22c55e', TOMADO: '#64748b', ANULADO: '#ef4444',
            };
            const francosFiltrados = filtroFrancos === 'todos'
              ? francosSector
              : francosSector.filter((f: any) => f.estado === filtroFrancos);
            const pendientesCount = francosSector.filter((f: any) => f.estado === 'PENDIENTE').length;
            return (
              <div className="card js-card">
                <div className="js-section-header">
                  <div className="js-section-title">
                    📅 Francos Compensatorios
                    {pendientesCount > 0 && (
                      <span style={{
                        marginLeft: 8, fontSize: '0.68rem', background: 'rgba(251,191,36,0.2)',
                        color: '#fbbf24', borderRadius: 5, padding: '2px 7px', fontWeight: 700,
                      }}>{pendientesCount} pendientes</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn js-btn-save" style={{ fontSize: '0.72rem', padding: '3px 9px' }}
                      onClick={() => setModalNuevoFrancoSector(true)}>+ Nuevo Franco</button>
                    <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 9px' }}
                      onClick={cargarFrancos} disabled={loadingFrancos}>🔄</button>
                  </div>
                </div>

                {/* Filtro estado */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const, marginBottom: 10 }}>
                  {(['todos', 'PENDIENTE', 'APROBADO', 'TOMADO', 'ANULADO'] as const).map(f => (
                    <button key={f} type="button"
                      style={{
                        fontSize: '0.7rem', padding: '3px 10px', borderRadius: 7, cursor: 'pointer',
                        border: `1px solid ${filtroFrancos === f ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
                        background: filtroFrancos === f ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                        color: filtroFrancos === f ? '#c7d2fe' : '#94a3b8',
                      }}
                      onClick={() => setFiltroFrancos(f)}
                    >{f === 'todos' ? 'Todos' : f}</button>
                  ))}
                </div>

                {loadingFrancos ? (
                  <div className="js-loading">🔄 Cargando francos…</div>
                ) : francosFiltrados.length === 0 ? (
                  <div className="js-empty">Sin francos {filtroFrancos !== 'todos' ? filtroFrancos.toLowerCase() + 's' : ''} en este sector</div>
                ) : (
                  <div className="js-tabla-wrap">
                    <table className="js-tabla">
                      <thead>
                        <tr>
                          <th>DNI</th>
                          <th>Agente</th>
                          <th>Fecha Franco</th>
                          <th>Día Trabajado</th>
                          <th>Estado</th>
                          <th>Motivo</th>
                          <th>Jefe</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {francosFiltrados.map((f: any) => {
                          const ag = agentesMap[String(f.dni)];
                          const nombre = ag ? `${ag.apellido}, ${ag.nombre}` : `DNI ${f.dni}`;
                          const color = FRANCO_COLOR[f.estado] || '#94a3b8';
                          const isSaving = savingFrancoId === f.id;
                          return (
                            <tr key={f.id}>
                              <td className="js-td-dni"
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  const agente = agentes.find((a: any) => String(a.dni) === String(f.dni));
                                  if (agente) { seleccionarAgente(agente); setTab('agentes'); }
                                }}
                              >{f.dni}</td>
                              <td style={{ fontWeight: 600, cursor: 'pointer' }}
                                onClick={() => {
                                  const agente = agentes.find((a: any) => String(a.dni) === String(f.dni));
                                  if (agente) { seleccionarAgente(agente); setTab('agentes'); }
                                }}
                              >{nombre}</td>
                              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{fmt(f.fecha_franco)}</td>
                              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{f.fecha_trabajo ? fmt(f.fecha_trabajo) : '—'}</td>
                              <td>
                                <span style={{
                                  fontSize: '0.68rem', padding: '2px 7px', borderRadius: 5, fontWeight: 700,
                                  background: color + '28', color,
                                }}>{f.estado || 'PENDIENTE'}</span>
                              </td>
                              <td className="js-td-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {f.motivo || '—'}
                              </td>
                              <td className="js-td-muted">{f.jefe_nombre || '—'}</td>
                              <td onClick={e => e.stopPropagation()}>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                                  {f.estado === 'PENDIENTE' && (
                                    <button
                                      type="button" disabled={isSaving}
                                      style={{ fontSize: '0.66rem', padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
                                        background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                                        border: '1px solid rgba(34,197,94,0.3)' }}
                                      onClick={() => cambiarEstadoFranco(f.id, 'APROBADO')}
                                    >{isSaving ? '…' : '✔ Aprobar'}</button>
                                  )}
                                  {f.estado === 'APROBADO' && (
                                    <button
                                      type="button" disabled={isSaving}
                                      style={{ fontSize: '0.66rem', padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
                                        background: 'rgba(100,116,139,0.15)', color: '#94a3b8',
                                        border: '1px solid rgba(100,116,139,0.3)' }}
                                      onClick={() => cambiarEstadoFranco(f.id, 'TOMADO')}
                                    >{isSaving ? '…' : '✔ Tomado'}</button>
                                  )}
                                  {(f.estado === 'PENDIENTE' || f.estado === 'APROBADO') && (
                                    <button
                                      type="button" disabled={isSaving}
                                      style={{ fontSize: '0.66rem', padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
                                        background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                                        border: '1px solid rgba(239,68,68,0.25)' }}
                                      onClick={() => cambiarEstadoFranco(f.id, 'ANULADO')}
                                    >{isSaving ? '…' : '✕ Anular'}</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Modales ── */}
      {modalAsignar && agenteActivo && (
        <AsignarServicioModal
          agente={agenteActivo}
          servicios={servicios}
          dependencias={dependencias}
          sectores={sectores}
          onClose={() => setModalAsignar(false)}
          onSaved={() => { cargarPases(agenteActivo.dni); cargarAgentes(); }}
        />
      )}
      {modalCerrar && (
        <CerrarServicioModal
          pase={modalCerrar}
          onClose={() => setModalCerrar(null)}
          onSaved={() => { cargarPases(agenteActivo?.dni); cargarAgentes(); }}
        />
      )}
      {modalNuevoFrancoSector && (
        <NuevoFrancoSectorModal
          agentes={agentes}
          sectorId={sectorId}
          jefeNombre={u?.nombre || ''}
          onClose={() => setModalNuevoFrancoSector(false)}
          onSaved={cargarFrancos}
        />
      )}
    </Layout>
  );
}

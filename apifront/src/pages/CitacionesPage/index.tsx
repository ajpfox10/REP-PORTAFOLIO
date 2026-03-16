// src/pages/CitacionesPage/index.tsx
// Gestión de citaciones por agente
// Misma búsqueda que GestionPage + tabla de citaciones + alta/cierre

import React, { useState, useCallback, useEffect } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { AgenteSearchForm } from '../Gesytionpage/components/components/AgenteSearchForm';
import { AgenteInfoCard } from '../Gesytionpage/components/components/AgenteInfoCard';
import { MatchesList } from '../Gesytionpage/components/components/MatchesList';
import { useAgenteSearch } from '../Gesytionpage/hooks/useAgenteSearch';
import { useDebounce } from '../Gesytionpage/hooks/useDebounce';
import { loadSession } from '../../auth/session';
import './styles/CitacionesPage.css';

function fmtDateTime(dt?: string | null) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dt; }
}

// ─── Modal nueva citación ─────────────────────────────────────────────────────
interface NuevaCitacionModalProps {
  agente: any;
  onClose: () => void;
  onSaved: () => void;
}
function NuevaCitacionModal({ agente, onClose, onSaved }: NuevaCitacionModalProps) {
  const toast = useToast();
  const [form, setForm] = useState({
    motivo: '',
    fecha_citacion: '',
    citado_por: '',
  });
  const [saving, setSaving] = useState(false);

  // Pre-cargar citado_por con el usuario logueado
  useEffect(() => {
    const s = loadSession();
    const u: any = s?.user || {};
    setForm(f => ({ ...f, citado_por: u?.email || u?.nombre || '' }));
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const guardar = async () => {
    if (!form.motivo.trim()) { toast.error('Ingresá el motivo de la citación'); return; }
    if (!form.fecha_citacion) { toast.error('Ingresá la fecha de citación'); return; }
    setSaving(true);
    try {
      await apiFetch<any>('/crud/citaciones', {
        method: 'POST',
        body: JSON.stringify({
          dni: agente.dni,
          motivo: form.motivo.trim(),
          fecha_citacion: form.fecha_citacion,
          citado_por: form.citado_por.trim() || null,
          citacion_activa: 1,
        }),
      });
      toast.ok('Citación registrada', `${agente.apellido}, ${agente.nombre}`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al guardar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cit-overlay" onClick={onClose}>
      <div className="cit-modal" onClick={e => e.stopPropagation()}>
        <div className="cit-modal-header">
          <div>
            <div className="cit-modal-title">⚠️ Nueva Citación</div>
            <div className="cit-modal-sub">{agente.apellido}, {agente.nombre} · DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} type="button">✕</button>
        </div>
        <div className="cit-modal-body">
          <div className="cit-form-grid">
            <div className="cit-field cit-field-full">
              <label className="cit-label">Motivo *</label>
              <textarea
                className="input"
                rows={3}
                value={form.motivo}
                onChange={e => set('motivo', e.target.value)}
                placeholder="Describí el motivo de la citación…"
              />
            </div>
            <div className="cit-field">
              <label className="cit-label">Fecha de citación *</label>
              <input
                type="datetime-local"
                className="input"
                value={form.fecha_citacion}
                onChange={e => set('fecha_citacion', e.target.value)}
              />
            </div>
            <div className="cit-field">
              <label className="cit-label">Citado por</label>
              <input
                type="text"
                className="input"
                value={form.citado_por}
                onChange={e => set('citado_por', e.target.value)}
                placeholder="Nombre / área que cita"
              />
            </div>
          </div>
          <div className="cit-modal-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn cit-btn-save" onClick={guardar} disabled={saving}>
              {saving ? '⏳ Guardando…' : '💾 Registrar Citación'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal cerrar citación ────────────────────────────────────────────────────
interface CerrarCitacionModalProps {
  citacion: any;
  onClose: () => void;
  onSaved: () => void;
}
function CerrarCitacionModal({ citacion, onClose, onSaved }: CerrarCitacionModalProps) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const cerrar = async () => {
    setSaving(true);
    try {
      await apiFetch<any>(`/crud/citaciones/${citacion.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          citacion_activa: 0,
          cierre_citacion: new Date().toISOString(),
        }),
      });
      toast.ok('Citación cerrada');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Error al cerrar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cit-overlay" onClick={onClose}>
      <div className="cit-modal cit-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="cit-modal-header">
          <div className="cit-modal-title">🔒 Cerrar Citación</div>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="cit-modal-body">
          <div className="cit-info-row"><b>Motivo:</b> {citacion.motivo}</div>
          <div className="cit-info-row"><b>Fecha:</b> {fmtDateTime(citacion.fecha_citacion)}</div>
          <div className="cit-info-row"><b>Citado por:</b> {citacion.citado_por || '—'}</div>
          <div className="cit-aviso">
            ¿Confirmás que esta citación fue atendida/resuelta y querés cerrarla?
          </div>
          <div className="cit-modal-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn cit-btn-danger" onClick={cerrar} disabled={saving}>
              {saving ? '⏳…' : '🔒 Cerrar Citación'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export function CitacionesPage() {
  const toast = useToast();
  const agenteSearch = useAgenteSearch();
  const debouncedDni = useDebounce(agenteSearch.dni, 500);

  const [matches,  setMatches]  = useState<any[]>([]);
  const [row,      setRow]      = useState<any>(null);
  const [loading,  setLoading]  = useState(false);

  // Citaciones del agente
  const [citaciones,     setCitaciones]     = useState<any[]>([]);
  const [loadingCit,     setLoadingCit]     = useState(false);
  const [filtroEstado,   setFiltroEstado]   = useState<'todas' | 'activas' | 'cerradas'>('todas');

  // Modales
  const [modalNueva,  setModalNueva]  = useState(false);
  const [modalCerrar, setModalCerrar] = useState<any>(null);

  useEffect(() => { setRow(agenteSearch.row); }, [agenteSearch.row]);
  useEffect(() => { setLoading(agenteSearch.loading); }, [agenteSearch.loading]);

  // Auto-search por DNI al tipear
  useEffect(() => {
    const d = String(debouncedDni || '');
    if (d.replace(/\D/g, '').length >= 7) agenteSearch.onSearch();
  }, [debouncedDni]);

  // Cargar citaciones cuando hay agente
  const cargarCitaciones = useCallback(async (dni: string) => {
    if (!dni) return;
    setLoadingCit(true);
    try {
      const res = await apiFetch<any>(`/crud/citaciones?dni=${dni}&limit=100&sort=-created_at`);
      setCitaciones(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setCitaciones([]);
    } finally {
      setLoadingCit(false);
    }
  }, []);

  useEffect(() => {
    if (agenteSearch.cleanDni) cargarCitaciones(agenteSearch.cleanDni);
    else setCitaciones([]);
  }, [agenteSearch.cleanDni]);

  const onSearchByName = async () => {
    const q = agenteSearch.fullName.trim();
    if (!q) { toast.error('Ingresá apellido y/o nombre'); return; }
    try {
      setLoading(true);
      setMatches([]);
      setRow(null);
      const res = await apiFetch<any>(`/personal/search?q=${encodeURIComponent(q)}&limit=30&page=1`);
      const lista = res?.data || [];
      setMatches(lista);
      if (!lista.length) toast.error('Sin resultados', `No se encontró "${q}"`);
      else toast.ok(`${lista.length} resultado(s)`);
    } catch (e: any) {
      toast.error('Error al buscar', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const loadByDni = useCallback((dni: string) => {
    const clean = String(dni).replace(/\D/g, '');
    agenteSearch.setDni(clean);
    setMatches([]);
    setTimeout(() => agenteSearch.onSearch(), 20);
  }, [agenteSearch]);

  // Citaciones filtradas
  const citacionesFiltradas = citaciones.filter(c => {
    if (filtroEstado === 'activas')  return c.citacion_activa;
    if (filtroEstado === 'cerradas') return !c.citacion_activa;
    return true;
  });

  const totalActivas  = citaciones.filter(c => c.citacion_activa).length;
  const totalCerradas = citaciones.filter(c => !c.citacion_activa).length;

  return (
    <Layout title="Citaciones" showBack>
      <div className="cit-layout">

        {/* ── COLUMNA IZQUIERDA ── */}
        <div className="cit-left">

          {/* Mismo buscador que GestionPage */}
          <AgenteSearchForm
            dni={agenteSearch.dni}
            fullName={agenteSearch.fullName}
            loading={loading}
            onDniChange={e => agenteSearch.setDni(String(e.target.value))}
            onFullNameChange={e => agenteSearch.setFullName(e.target.value)}
            onSearch={() => agenteSearch.onSearch()}
            onSearchByName={onSearchByName}
          />

          {loading && <div className="card cit-card">🔄 Cargando…</div>}

          {matches.length > 0 && (
            <MatchesList matches={matches} onSelect={loadByDni} />
          )}

          <AgenteInfoCard row={row} />

          {/* Card resumen citaciones */}
          {row && (
            <div className="card cit-card cit-resumen-card">
              <div className="cit-resumen-row">
                <div className="cit-resumen-item cit-activa">
                  <div className="cit-resumen-num">{totalActivas}</div>
                  <div className="cit-resumen-label">Activas</div>
                </div>
                <div className="cit-resumen-sep" />
                <div className="cit-resumen-item cit-cerrada">
                  <div className="cit-resumen-num">{totalCerradas}</div>
                  <div className="cit-resumen-label">Cerradas</div>
                </div>
                <div className="cit-resumen-sep" />
                <div className="cit-resumen-item">
                  <div className="cit-resumen-num">{citaciones.length}</div>
                  <div className="cit-resumen-label">Total</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── COLUMNA DERECHA ── */}
        <div className="cit-right">

          {!row && (
            <div className="card cit-card cit-placeholder">
              <div className="cit-placeholder-icon">⚠️</div>
              <div className="cit-placeholder-text">
                Buscá un agente para ver sus citaciones
              </div>
            </div>
          )}

          {row && (
            <div className="card cit-card">
              <div className="cit-tabla-header">
                <div className="cit-tabla-title">
                  ⚠️ Citaciones
                  {totalActivas > 0 && (
                    <span className="cit-badge-activa">{totalActivas} activa{totalActivas > 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="cit-tabla-actions">
                  {/* Filtros */}
                  <div className="cit-filtro-btns">
                    {(['todas', 'activas', 'cerradas'] as const).map(e => (
                      <button
                        key={e}
                        type="button"
                        className={`cit-filtro-btn${filtroEstado === e ? ' active' : ''}`}
                        onClick={() => setFiltroEstado(e)}
                      >
                        {e === 'todas' ? 'Todas' : e === 'activas' ? '🟢 Activas' : '⬜ Cerradas'}
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn cit-btn-nueva"
                    type="button"
                    onClick={() => setModalNueva(true)}
                  >
                    ➕ Nueva Citación
                  </button>
                </div>
              </div>

              {loadingCit ? (
                <div className="cit-loading">🔄 Cargando citaciones…</div>
              ) : citacionesFiltradas.length === 0 ? (
                <div className="cit-empty">
                  {citaciones.length === 0
                    ? 'Sin citaciones registradas para este agente'
                    : 'Sin citaciones en este filtro'}
                </div>
              ) : (
                <div className="cit-lista">
                  {citacionesFiltradas.map((c: any) => (
                    <div
                      key={c.id}
                      className={`cit-item${c.citacion_activa ? ' cit-item-activa' : ''}`}
                    >
                      <div className="cit-item-head">
                        <span className={`cit-estado-badge ${c.citacion_activa ? 'activa' : 'cerrada'}`}>
                          {c.citacion_activa ? '🟢 ACTIVA' : '⬜ CERRADA'}
                        </span>
                        <span className="cit-item-id">#{c.id}</span>
                      </div>

                      <div className="cit-item-motivo">{c.motivo || '—'}</div>

                      <div className="cit-item-meta">
                        <span>📅 {fmtDateTime(c.fecha_citacion)}</span>
                        {c.citado_por && <span>👤 {c.citado_por}</span>}
                        {c.cierre_citacion && (
                          <span>🔒 Cerrada: {fmtDateTime(c.cierre_citacion)}</span>
                        )}
                      </div>

                      <div className="cit-item-footer">
                        <span className="cit-item-created">Registrada: {fmtDateTime(c.created_at)}</span>
                        {c.citacion_activa && (
                          <button
                            className="btn cit-btn-cerrar"
                            type="button"
                            onClick={() => setModalCerrar(c)}
                          >
                            🔒 Cerrar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modales */}
      {modalNueva && row && (
        <NuevaCitacionModal
          agente={row}
          onClose={() => setModalNueva(false)}
          onSaved={() => cargarCitaciones(agenteSearch.cleanDni)}
        />
      )}
      {modalCerrar && (
        <CerrarCitacionModal
          citacion={modalCerrar}
          onClose={() => setModalCerrar(null)}
          onSaved={() => cargarCitaciones(agenteSearch.cleanDni)}
        />
      )}
    </Layout>
  );
}

// src/pages/CitacionesPage/index.tsx
// Vista 1: Pendientes globales (carga automática todas las citaciones activas)
// Vista 2: Por Agente (búsqueda individual, histórico, alta/cierre)

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { getAllPersonal } from '../../api/searchPersonal';
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

async function fetchAll<T = any>(endpoint: string): Promise<T[]> {
  const PAGE = 200;
  let page = 1;
  let all: T[] = [];
  let total = Infinity;
  while (all.length < total) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await apiFetch<any>(`${endpoint}${sep}limit=${PAGE}&page=${page}&sort=-created_at`);
    const rows: T[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total);
    else total = all.length;
    if (rows.length < PAGE) break;
    page++;
  }
  return all;
}

// ─── Modal nueva citación ─────────────────────────────────────────────────────
interface NuevaCitacionModalProps {
  agente: any;
  onClose: () => void;
  onSaved: () => void;
}
function NuevaCitacionModal({ agente, onClose, onSaved }: NuevaCitacionModalProps) {
  const toast = useToast();
  const [form, setForm] = useState({ motivo: '', fecha_citacion: '', citado_por: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = loadSession();
    const u: any = s?.user || {};
    setForm(f => ({ ...f, citado_por: u?.email || u?.nombre || '' }));
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const guardar = async () => {
    if (!form.motivo.trim())    { toast.error('Ingresá el motivo'); return; }
    if (!form.fecha_citacion)   { toast.error('Ingresá la fecha'); return; }
    setSaving(true);
    try {
      await apiFetch<any>('/citaciones', {
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
              <textarea className="input" rows={3} value={form.motivo}
                onChange={e => set('motivo', e.target.value)}
                placeholder="Describí el motivo…" />
            </div>
            <div className="cit-field">
              <label className="cit-label">Fecha de citación *</label>
              <input type="datetime-local" className="input" value={form.fecha_citacion}
                onChange={e => set('fecha_citacion', e.target.value)} />
            </div>
            <div className="cit-field">
              <label className="cit-label">Citado por</label>
              <input type="text" className="input" value={form.citado_por}
                onChange={e => set('citado_por', e.target.value)}
                placeholder="Nombre / área que cita" />
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
  nombreAgente?: string;
  onClose: () => void;
  onSaved: () => void;
}
function CerrarCitacionModal({ citacion, nombreAgente, onClose, onSaved }: CerrarCitacionModalProps) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const cerrar = async () => {
    setSaving(true);
    try {
      await apiFetch<any>(`/citaciones/${citacion.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ citacion_activa: 0, cierre_citacion: new Date().toISOString() }),
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
          {nombreAgente && <div className="cit-info-row"><b>Agente:</b> {nombreAgente}</div>}
          <div className="cit-info-row"><b>Motivo:</b> {citacion.motivo}</div>
          <div className="cit-info-row"><b>Fecha:</b> {fmtDateTime(citacion.fecha_citacion)}</div>
          <div className="cit-info-row"><b>Citado por:</b> {citacion.citado_por || '—'}</div>
          <div className="cit-aviso">¿Confirmás que esta citación fue atendida/resuelta?</div>
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
type Vista = 'pendientes' | 'agente';

export function CitacionesPage() {
  const toast    = useToast();
  const [vista, setVista] = useState<Vista>('pendientes');

  // ── Vista Pendientes globales ─────────────────────────────────────────────
  const [pendientes,   setPendientes]   = useState<any[]>([]);
  const [personalMap,  setPersonalMap]  = useState<Record<string, { apellido: string; nombre: string }>>({});
  const [loadingPend,  setLoadingPend]  = useState(true);
  const [refreshPend,  setRefreshPend]  = useState(0);
  const [busqPend,     setBusqPend]     = useState('');
  const [modalCerrarG, setModalCerrarG] = useState<any>(null);

  const cargarPendientes = useCallback(async () => {
    setLoadingPend(true);
    try {
      const [cits, personal] = await Promise.all([
        fetchAll('/citaciones?citacion_activa=1'),
        getAllPersonal(),
      ]);
      setPendientes(cits);
      const map: Record<string, { apellido: string; nombre: string }> = {};
      for (const p of personal) {
        if (p.dni != null) map[String(p.dni)] = { apellido: p.apellido || '', nombre: p.nombre || '' };
      }
      setPersonalMap(map);
    } catch (e: any) {
      toast.error('Error al cargar pendientes', e?.message);
    } finally {
      setLoadingPend(false);
    }
  }, [refreshPend]); // eslint-disable-line

  useEffect(() => { cargarPendientes(); }, [cargarPendientes]);

  const nombreAgente = (row: any) => {
    const p = personalMap[String(row.dni)];
    if (p?.apellido) return `${p.apellido}, ${p.nombre}`;
    return row.apellido ? `${row.apellido}, ${row.nombre}` : `DNI ${row.dni}`;
  };

  const pendientesFiltradas = useMemo(() => {
    const q = busqPend.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!q) return pendientes;
    return pendientes.filter(c => {
      const p    = personalMap[String(c.dni)];
      const ape  = (p?.apellido || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const nom  = (p?.nombre   || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const dni  = String(c.dni || '');
      const mot  = (c.motivo || '').toLowerCase();
      return ape.includes(q) || nom.includes(q) || dni.includes(q) || mot.includes(q);
    });
  }, [pendientes, busqPend, personalMap]);

  // ── Vista Por Agente ──────────────────────────────────────────────────────
  const agenteSearch   = useAgenteSearch();
  const debouncedDni   = useDebounce(agenteSearch.dni, 500);
  const [matches,      setMatches]      = useState<any[]>([]);
  const [row,          setRow]          = useState<any>(null);
  const [loadingAg,    setLoadingAg]    = useState(false);
  const [citaciones,   setCitaciones]   = useState<any[]>([]);
  const [loadingCit,   setLoadingCit]   = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<'todas'|'activas'|'cerradas'>('todas');
  const [modalNueva,   setModalNueva]   = useState(false);
  const [modalCerrarA, setModalCerrarA] = useState<any>(null);

  useEffect(() => { setRow(agenteSearch.row); },         [agenteSearch.row]);
  useEffect(() => { setLoadingAg(agenteSearch.loading); }, [agenteSearch.loading]);

  useEffect(() => {
    const d = String(debouncedDni || '');
    if (d.replace(/\D/g, '').length >= 7) agenteSearch.onSearch();
  }, [debouncedDni]); // eslint-disable-line

  const cargarCitaciones = useCallback(async (dni: string) => {
    if (!dni) return;
    setLoadingCit(true);
    try {
      const res = await apiFetch<any>(`/citaciones?dni=${dni}&limit=100&sort=-created_at`);
      setCitaciones(Array.isArray(res?.data) ? res.data : []);
    } catch { setCitaciones([]); }
    finally { setLoadingCit(false); }
  }, []);

  useEffect(() => {
    if (agenteSearch.cleanDni) cargarCitaciones(agenteSearch.cleanDni);
    else setCitaciones([]);
  }, [agenteSearch.cleanDni]); // eslint-disable-line

  const onSearchByName = async () => {
    const q = agenteSearch.fullName.trim();
    if (!q) { toast.error('Ingresá apellido y/o nombre'); return; }
    setLoadingAg(true); setMatches([]); setRow(null);
    try {
      const res = await apiFetch<any>(`/personal/search?q=${encodeURIComponent(q)}&limit=30&page=1`);
      const lista = res?.data || [];
      setMatches(lista);
      if (!lista.length) toast.error('Sin resultados', `No se encontró "${q}"`);
      else toast.ok(`${lista.length} resultado(s)`);
    } catch (e: any) {
      toast.error('Error al buscar', e?.message || 'Error');
    } finally { setLoadingAg(false); }
  };

  const loadByDni = useCallback((dni: string) => {
    agenteSearch.setDni(String(dni).replace(/\D/g, ''));
    setMatches([]);
    setTimeout(() => agenteSearch.onSearch(), 20);
  }, [agenteSearch]);

  const citacionesFiltradas = citaciones.filter(c => {
    if (filtroEstado === 'activas')  return  c.citacion_activa;
    if (filtroEstado === 'cerradas') return !c.citacion_activa;
    return true;
  });

  const totalActivas  = citaciones.filter(c =>  c.citacion_activa).length;
  const totalCerradas = citaciones.filter(c => !c.citacion_activa).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout title="Citaciones" showBack>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Header + tabs ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ fontSize: '1.05rem' }}>⚠️ Citaciones</strong>
            {vista === 'pendientes' && !loadingPend && (
              <div className="muted" style={{ fontSize: '0.73rem', marginTop: 3 }}>
                {pendientes.length} citación{pendientes.length !== 1 ? 'es' : ''} activa{pendientes.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['pendientes', 'agente'] as Vista[]).map(v => (
              <button key={v} type="button"
                onClick={() => setVista(v)}
                style={{
                  fontSize: '0.82rem', padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${vista === v ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                  background: vista === v ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.04)',
                  color: vista === v ? '#fca5a5' : '#94a3b8',
                  fontWeight: vista === v ? 700 : 400,
                }}>
                {v === 'pendientes'
                  ? <>🟢 Pendientes {!loadingPend && pendientes.length > 0 && <span style={{ marginLeft: 5, background: '#ef4444', color: '#fff', borderRadius: 99, fontSize: '0.65rem', padding: '1px 6px' }}>{pendientes.length}</span>}</>
                  : '🔍 Por Agente'}
              </button>
            ))}
            {vista === 'pendientes' && (
              <button className="btn" style={{ fontSize: '0.75rem' }}
                onClick={() => setRefreshPend(k => k + 1)} disabled={loadingPend}>
                🔄 Actualizar
              </button>
            )}
          </div>
        </div>

        {/* ══ VISTA: PENDIENTES GLOBALES ══ */}
        {vista === 'pendientes' && (
          <div className="card" style={{ padding: '1rem 1.2rem' }}>

            {/* Buscador rápido */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
              <input className="input" style={{ flex: 1, maxWidth: 360, fontSize: '0.83rem' }}
                placeholder="Filtrar por DNI, apellido o motivo…"
                value={busqPend} onChange={e => setBusqPend(e.target.value)} />
              {busqPend && (
                <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => setBusqPend('')}>✕</button>
              )}
              <span className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                {pendientesFiltradas.length} resultado{pendientesFiltradas.length !== 1 ? 's' : ''}
              </span>
            </div>

            {loadingPend ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>🔄 Cargando citaciones pendientes…</div>
            ) : pendientesFiltradas.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#475569', fontSize: '0.88rem' }}>
                {pendientes.length === 0 ? '✅ No hay citaciones activas' : 'Sin resultados para el filtro'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.81rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                      {['#', 'DNI', 'Agente', 'Motivo', 'Fecha citación', 'Citado por', 'Registrada', ''].map(h => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: '#64748b', fontSize: '0.67rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pendientesFiltradas.map((c: any) => (
                      <tr key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(239,68,68,0.03)' }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.72rem', color: '#475569' }}>{c.id}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{c.dni}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{nombreAgente(c)}</td>
                        <td style={{ padding: '8px 10px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.motivo}>{c.motivo || '—'}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.76rem' }}>{fmtDateTime(c.fecha_citacion)}</td>
                        <td style={{ padding: '8px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{c.citado_por || '—'}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap', fontSize: '0.74rem' }}>{fmtDateTime(c.created_at)}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <button className="btn cit-btn-cerrar" type="button"
                            onClick={() => setModalCerrarG(c)}>
                            🔒 Cerrar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══ VISTA: POR AGENTE ══ */}
        {vista === 'agente' && (
          <div className="cit-layout">

            {/* Columna izquierda */}
            <div className="cit-left">
              <AgenteSearchForm
                dni={agenteSearch.dni}
                fullName={agenteSearch.fullName}
                loading={loadingAg}
                onDniChange={e => agenteSearch.setDni(String(e.target.value))}
                onFullNameChange={e => agenteSearch.setFullName(e.target.value)}
                onSearch={() => agenteSearch.onSearch()}
                onSearchByName={onSearchByName}
              />
              {loadingAg && <div className="card cit-card">🔄 Cargando…</div>}
              {matches.length > 0 && <MatchesList matches={matches} onSelect={loadByDni} />}
              <AgenteInfoCard row={row} />
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

            {/* Columna derecha */}
            <div className="cit-right">
              {!row && (
                <div className="card cit-card cit-placeholder">
                  <div className="cit-placeholder-icon">⚠️</div>
                  <div className="cit-placeholder-text">Buscá un agente para ver sus citaciones</div>
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
                      <div className="cit-filtro-btns">
                        {(['todas', 'activas', 'cerradas'] as const).map(e => (
                          <button key={e} type="button"
                            className={`cit-filtro-btn${filtroEstado === e ? ' active' : ''}`}
                            onClick={() => setFiltroEstado(e)}>
                            {e === 'todas' ? 'Todas' : e === 'activas' ? '🟢 Activas' : '⬜ Cerradas'}
                          </button>
                        ))}
                      </div>
                      <button className="btn cit-btn-nueva" type="button" onClick={() => setModalNueva(true)}>
                        ➕ Nueva Citación
                      </button>
                    </div>
                  </div>
                  {loadingCit ? (
                    <div className="cit-loading">🔄 Cargando citaciones…</div>
                  ) : citacionesFiltradas.length === 0 ? (
                    <div className="cit-empty">
                      {citaciones.length === 0 ? 'Sin citaciones para este agente' : 'Sin citaciones en este filtro'}
                    </div>
                  ) : (
                    <div className="cit-lista">
                      {citacionesFiltradas.map((c: any) => (
                        <div key={c.id} className={`cit-item${c.citacion_activa ? ' cit-item-activa' : ''}`}>
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
                            {c.cierre_citacion && <span>🔒 Cerrada: {fmtDateTime(c.cierre_citacion)}</span>}
                          </div>
                          <div className="cit-item-footer">
                            <span className="cit-item-created">Registrada: {fmtDateTime(c.created_at)}</span>
                            {c.citacion_activa && (
                              <button className="btn cit-btn-cerrar" type="button" onClick={() => setModalCerrarA(c)}>
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
        )}
      </div>

      {/* ── Modales ── */}
      {modalNueva && row && (
        <NuevaCitacionModal
          agente={row}
          onClose={() => setModalNueva(false)}
          onSaved={() => cargarCitaciones(agenteSearch.cleanDni)}
        />
      )}
      {modalCerrarA && (
        <CerrarCitacionModal
          citacion={modalCerrarA}
          onClose={() => setModalCerrarA(null)}
          onSaved={() => cargarCitaciones(agenteSearch.cleanDni)}
        />
      )}
      {modalCerrarG && (
        <CerrarCitacionModal
          citacion={modalCerrarG}
          nombreAgente={nombreAgente(modalCerrarG)}
          onClose={() => setModalCerrarG(null)}
          onSaved={() => setRefreshPend(k => k + 1)}
        />
      )}
    </Layout>
  );
}

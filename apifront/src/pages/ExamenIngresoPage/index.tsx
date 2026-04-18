// src/pages/ExamenIngresoPage/index.tsx
// Gestión de turnos para examen de ingreso
// Perfiles: app:gestion_turnos:access, crud:*:* (admin)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Candidato {
  id: number;
  dni: string | null;
  nombre: string;
  es_agente: boolean;
  observaciones: string | null;
  turno_laboratorio:    string | null;
  turno_rayos:          string | null;
  turno_cardiologia:    string | null;
  turno_psicologia:     string | null;
  turno_fonoaudiologia: string | null;
  turno_odontologia:    string | null;
  avisado: boolean;
  avisado_por_email:    string | null;
  avisado_at:           string | null;
  creado_por_email:     string | null;
  creado_at:            string;
  modificado_por_email: string | null;
  modificado_at:        string | null;
  eliminado_por_email:  string | null;
}

const TURNOS: { key: keyof Candidato; label: string }[] = [
  { key: 'turno_laboratorio',    label: 'Laboratorio'    },
  { key: 'turno_rayos',          label: 'Rayos'          },
  { key: 'turno_cardiologia',    label: 'Cardiología'    },
  { key: 'turno_psicologia',     label: 'Psicología'     },
  { key: 'turno_fonoaudiologia', label: 'Fonoaudiología' },
  { key: 'turno_odontologia',    label: 'Odontología'    },
];

function fmt(d?: string | null) {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

function turnosCompletos(c: Candidato) {
  return TURNOS.every(t => !!c[t.key]);
}

// ── BANNER ────────────────────────────────────────────────────────────────────

export function ExamenIngresoBanner() {
  const { session } = useAuth();
  const [data, setData]           = useState<{ pendientes: number; data: Candidato[] } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!session) return;
    apiFetch<any>('/examen-ingreso/alertas')
      .then(r => { if (r?.ok && r.pendientes > 0) setData(r); })
      .catch(() => {});
  }, [session]);

  if (!data || dismissed || data.pendientes === 0) return null;

  return (
    <div style={{
      margin: '0 0 16px 0', padding: '14px 16px',
      background: 'rgba(99,102,241,0.12)', border: '2px solid rgba(99,102,241,0.5)',
      borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>🩺</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#818cf8', marginBottom: 4 }}>
          Examen de Ingreso: {data.pendientes} candidato{data.pendientes !== 1 ? 's' : ''} con turnos pendientes
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {data.data.slice(0, 5).map(c => {
            const faltantes = TURNOS.filter(t => !c[t.key]).map(t => t.label);
            return (
              <div key={c.id} style={{ fontSize: '0.83rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                {c.dni && <span className="muted">DNI {c.dni}</span>}
                <span style={{ color: '#f87171', fontSize: '0.76rem' }}>Sin: {faltantes.join(', ')}</span>
              </div>
            );
          })}
          {data.pendientes > 5 && <div className="muted" style={{ fontSize: '0.76rem' }}>...y {data.pendientes - 5} más</div>}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem' }} className="muted">
          Ir a <a href="/app/examen-ingreso" style={{ color: '#818cf8', textDecoration: 'underline' }}>Examen de Ingreso</a> para asignar turnos.
        </div>
      </div>
      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: '1.1rem', padding: 0 }}
        onClick={() => setDismissed(true)} title="Cerrar">✕</button>
    </div>
  );
}

// ── MODAL CANDIDATO ───────────────────────────────────────────────────────────

function ModalCandidato({ initial, onSave, onClose }: {
  initial?: Partial<Candidato>;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [nombre,       setNombre]       = useState(initial?.nombre ?? '');
  const [dni,          setDni]          = useState(initial?.dni ?? '');
  const [esAgente,     setEsAgente]     = useState(initial?.es_agente ?? false);
  const [observaciones,setObservaciones]= useState(initial?.observaciones ?? '');
  const [saving,       setSaving]       = useState(false);

  const handleSave = async () => {
    if (!nombre.trim()) return;
    setSaving(true);
    await onSave({ nombre: nombre.trim(), dni: dni.trim() || null, es_agente: esAgente, observaciones: observaciones.trim() || null });
    setSaving(false);
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const box: React.CSSProperties = {
    background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 14, padding: 24, width: 420, maxWidth: '95vw',
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 16, fontSize: '1rem' }}>
          {initial?.id ? 'Editar candidato' : 'Nuevo candidato'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Nombre y Apellido *</div>
            <input className="input" style={{ width: '100%' }} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Apellido, Nombre" />
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>DNI</div>
            <input className="input" style={{ width: '100%' }} value={dni} onChange={e => setDni(e.target.value)} placeholder="opcional" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={esAgente} onChange={e => setEsAgente(e.target.checked)} />
            Ya es agente activo
          </label>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Observaciones</div>
            <textarea className="input" style={{ width: '100%', height: 70, resize: 'vertical' }} value={observaciones} onChange={e => setObservaciones(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button className="btn" type="button" onClick={onClose}>Cancelar</button>
          <button className="btn primary" type="button" onClick={handleSave} disabled={saving || !nombre.trim()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FILA EXPANDIBLE ───────────────────────────────────────────────────────────

function FilaCandidato({ c, isAdmin, onUpdate, onDelete, onAvisar }: {
  c: Candidato;
  isAdmin: boolean;
  onUpdate: (updated: Candidato) => void;
  onDelete: (id: number) => void;
  onAvisar: (id: number, val: boolean) => void;
}) {
  const toast        = useToast();
  const [open,       setOpen]    = useState(false);
  const [turnos,     setTurnos]  = useState<Record<string, string>>(() => {
    const obj: Record<string, string> = {};
    TURNOS.forEach(t => { obj[t.key as string] = (c[t.key] as string) ?? ''; });
    return obj;
  });
  const [saving,     setSaving]  = useState(false);
  const [editModal,  setEditModal]= useState(false);

  const completo  = turnosCompletos(c);
  const asignados = TURNOS.filter(t => !!c[t.key]).length;

  const saveTurnos = async () => {
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      TURNOS.forEach(t => { body[t.key as string] = turnos[t.key as string] || null; });
      const r = await apiFetch<any>(`/examen-ingreso/candidatos/${c.id}/turnos`, {
        method: 'PUT', body: JSON.stringify(body),
      });
      if (!r?.ok) throw new Error(r?.error ?? 'Error');
      onUpdate(r.data);
      toast.ok('Turnos guardados');
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSaving(false); }
  };

  const handleAvisar = async () => {
    try {
      const r = await apiFetch<any>(`/examen-ingreso/candidatos/${c.id}/avisar`, {
        method: 'PUT', body: JSON.stringify({ avisado: !c.avisado }),
      });
      if (!r?.ok) throw new Error(r?.error);
      onAvisar(c.id, !c.avisado);
      toast.ok(c.avisado ? 'Marcado como no avisado' : 'Marcado como avisado');
    } catch (e: any) { toast.error('Error', e?.message); }
  };

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar a ${c.nombre}?`)) return;
    try {
      const r = await apiFetch<any>(`/examen-ingreso/candidatos/${c.id}`, { method: 'DELETE' });
      if (!r?.ok) throw new Error(r?.error);
      onDelete(c.id);
      toast.ok('Eliminado');
    } catch (e: any) { toast.error('Error', e?.message); }
  };

  const rowBg = c.avisado
    ? 'rgba(34,197,94,0.06)'
    : completo
    ? 'rgba(99,102,241,0.06)'
    : 'transparent';

  return (
    <>
      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: rowBg, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <td style={{ padding: '9px 12px', width: 24, color: '#64748b' }}>{open ? '▼' : '▶'}</td>
        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {c.nombre}
          {c.es_agente && <span style={{ marginLeft: 6, fontSize: '0.68rem', background: 'rgba(99,102,241,0.2)', color: '#818cf8', borderRadius: 8, padding: '1px 6px' }}>Agente</span>}
        </td>
        <td style={{ padding: '9px 12px', fontFamily: 'monospace', color: '#94a3b8', fontSize: '0.82rem' }}>{c.dni ?? '—'}</td>
        <td style={{ padding: '9px 12px' }}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {TURNOS.map(t => (
              <span key={t.key as string} style={{
                fontSize: '0.68rem', padding: '2px 7px', borderRadius: 8, fontWeight: 600,
                background: c[t.key] ? 'rgba(34,197,94,0.18)' : 'rgba(100,116,139,0.18)',
                color: c[t.key] ? '#22c55e' : '#64748b',
              }} title={c[t.key] ? `${t.label}: ${fmt(c[t.key] as string)}` : `${t.label}: sin fecha`}>
                {t.label.slice(0, 3)}{c[t.key] ? ` ${fmt(c[t.key] as string)}` : ''}
              </span>
            ))}
          </div>
        </td>
        <td style={{ padding: '9px 12px', fontSize: '0.8rem' }}>
          <span style={{
            padding: '2px 10px', borderRadius: 20, fontWeight: 600, fontSize: '0.75rem',
            background: asignados === 6 ? 'rgba(99,102,241,0.18)' : 'rgba(100,116,139,0.1)',
            color: asignados === 6 ? '#818cf8' : '#94a3b8',
          }}>{asignados}/6</span>
        </td>
        <td style={{ padding: '9px 12px' }}>
          <span style={{
            padding: '2px 10px', borderRadius: 20, fontWeight: 600, fontSize: '0.75rem',
            background: c.avisado ? 'rgba(34,197,94,0.18)' : 'rgba(100,116,139,0.1)',
            color: c.avisado ? '#22c55e' : '#64748b',
          }}>{c.avisado ? '✓ Avisado' : 'Pendiente'}</span>
        </td>
        <td style={{ padding: '9px 12px' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 4 }}>
            {isAdmin && (
              <>
                <button className="btn" type="button" style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                  onClick={() => setEditModal(true)}>✏</button>
                <button className="btn danger" type="button" style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                  onClick={handleDelete}>✕</button>
              </>
            )}
          </div>
        </td>
      </tr>

      {open && (
        <tr style={{ background: 'rgba(15,23,42,0.4)' }}>
          <td colSpan={7} style={{ padding: '16px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
              {TURNOS.map(t => {
                const fechaActual = c[t.key] as string | null;
                return (
                  <div key={t.key as string}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span className="muted" style={{ fontSize: '0.72rem' }}>{t.label}</span>
                      {fechaActual
                        ? <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#22c55e' }}>{fmt(fechaActual)}</span>
                        : <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Sin fecha</span>
                      }
                    </div>
                    <input type="date" className="input" style={{ width: '100%' }}
                      value={turnos[t.key as string] ?? ''}
                      onChange={e => setTurnos(prev => ({ ...prev, [t.key as string]: e.target.value }))} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn primary" type="button" onClick={saveTurnos} disabled={saving}>
                {saving ? 'Guardando…' : '💾 Guardar turnos'}
              </button>
              <button className="btn" type="button" onClick={handleAvisar}
                style={{ background: c.avisado ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                         color: c.avisado ? '#ef4444' : '#22c55e' }}>
                {c.avisado ? '✕ Desmarcar avisado' : '✓ Marcar avisado'}
              </button>
              {c.avisado && c.avisado_por_email && (
                <span className="muted" style={{ fontSize: '0.75rem' }}>
                  Avisado por {c.avisado_por_email} el {fmt(c.avisado_at)}
                </span>
              )}
            </div>
            {c.observaciones && (
              <div style={{ marginTop: 10, fontSize: '0.82rem', color: '#94a3b8' }}>
                <span className="muted">Obs: </span>{c.observaciones}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#475569' }}>
              Cargado por {c.creado_por_email ?? '—'} · {fmt(c.creado_at)}
              {c.modificado_por_email && ` · Modificado por ${c.modificado_por_email} el ${fmt(c.modificado_at)}`}
            </div>
          </td>
        </tr>
      )}

      {editModal && (
        <ModalCandidato
          initial={c}
          onClose={() => setEditModal(false)}
          onSave={async (data) => {
            const r = await apiFetch<any>(`/examen-ingreso/candidatos/${c.id}`, {
              method: 'PUT', body: JSON.stringify(data),
            });
            if (r?.ok) { onUpdate(r.data); setEditModal(false); }
          }}
        />
      )}
    </>
  );
}

// ── PÁGINA PRINCIPAL ──────────────────────────────────────────────────────────

export function ExamenIngresoPage() {
  const { hasPerm, session } = useAuth();
  const toast = useToast();

  const isAdmin      = hasPerm('crud:*:*');
  const canGestionar = isAdmin || hasPerm('app:gestion_turnos:access');

  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [busqueda,   setBusqueda]   = useState('');
  const [filtro,     setFiltro]     = useState<'todos'|'pendientes'|'completos'|'avisados'>('todos');
  const [newModal,   setNewModal]   = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<any>('/examen-ingreso/candidatos');
      if (r?.ok) setCandidatos(r.data ?? []);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtrados = candidatos.filter(c => {
    const q = busqueda.toLowerCase();
    if (q && !c.nombre.toLowerCase().includes(q) && !(c.dni ?? '').includes(q)) return false;
    if (filtro === 'pendientes') return !turnosCompletos(c);
    if (filtro === 'completos')  return turnosCompletos(c);
    if (filtro === 'avisados')   return c.avisado;
    return true;
  });

  const handleUpdate  = (updated: Candidato) => setCandidatos(prev => prev.map(c => c.id === updated.id ? updated : c));
  const handleDelete  = (id: number)          => setCandidatos(prev => prev.filter(c => c.id !== id));
  const handleAvisar  = (id: number, val: boolean) =>
    setCandidatos(prev => prev.map(c => c.id === id ? { ...c, avisado: val } : c));

  const handleNew = async (data: any) => {
    const r = await apiFetch<any>('/examen-ingreso/candidatos', { method: 'POST', body: JSON.stringify(data) });
    if (r?.ok) {
      setCandidatos(prev => [r.data, ...prev]);
      setNewModal(false);
      toast.ok('Candidato agregado');
    } else {
      toast.error('Error', r?.error ?? 'No se pudo crear');
    }
  };

  const total      = candidatos.length;
  const pendientes = candidatos.filter(c => !turnosCompletos(c)).length;
  const completos  = candidatos.filter(turnosCompletos).length;
  const avisados   = candidatos.filter(c => c.avisado).length;

  const exportar = () => {
    const data = filtrados.map(c => ({
      Nombre:          c.nombre,
      DNI:             c.dni ?? '',
      'Es agente':     c.es_agente ? 'Sí' : 'No',
      Laboratorio:     fmt(c.turno_laboratorio),
      Rayos:           fmt(c.turno_rayos),
      Cardiología:     fmt(c.turno_cardiologia),
      Psicología:      fmt(c.turno_psicologia),
      Fonoaudiología:  fmt(c.turno_fonoaudiologia),
      Odontología:     fmt(c.turno_odontologia),
      Avisado:         c.avisado ? 'Sí' : 'No',
      'Avisado por':   c.avisado_por_email ?? '',
      'Cargado por':   c.creado_por_email ?? '',
      'Cargado el':    fmt(c.creado_at),
    }));
    exportToExcel('examen_ingreso', data);
  };

  return (
    <Layout title="Examen de Ingreso">
      {/* Resumen */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Total',      value: total,      color: '#e2e8f0' },
          { label: 'Pendientes', value: pendientes, color: '#f87171' },
          { label: 'Completos',  value: completos,  color: '#818cf8' },
          { label: 'Avisados',   value: avisados,   color: '#22c55e' },
        ].map(s => (
          <div key={s.label} className="card" style={{ minWidth: 110, flex: '0 0 auto', padding: '10px 16px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div className="muted" style={{ fontSize: '0.72rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Barra de herramientas */}
      <div className="card" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input className="input" placeholder="Buscar nombre o DNI…" value={busqueda}
          onChange={e => setBusqueda(e.target.value)} style={{ width: 220 }} />
        {(['todos','pendientes','completos','avisados'] as const).map(v => (
          <button key={v} type="button"
            className={`btn${filtro === v ? ' primary' : ''}`}
            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            onClick={() => setFiltro(v)}>
            {v === 'todos' ? 'Todos' : v === 'pendientes' ? 'Pendientes' : v === 'completos' ? 'Completos' : 'Avisados'}
          </button>
        ))}
        <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>{filtrados.length} registro{filtrados.length !== 1 ? 's' : ''}</span>
        <button className="btn" type="button" disabled={filtrados.length === 0} onClick={exportar}
          style={{ fontSize: '0.75rem', padding: '4px 12px' }}>📥 Excel</button>
        {isAdmin && (
          <button className="btn primary" type="button" onClick={() => setNewModal(true)}
            style={{ fontSize: '0.75rem', padding: '4px 12px' }}>+ Agregar</button>
        )}
        <button className="btn" type="button" onClick={cargar} disabled={loading}
          style={{ fontSize: '0.75rem', padding: '4px 10px' }}>↻</button>
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={{ width: 24 }} />
                {['Nombre', 'DNI', 'Turnos', 'Asignados', 'Avisado', 'Acciones'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Cargando…</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Sin resultados.</td></tr>
              ) : filtrados.map(c => (
                <FilaCandidato key={c.id} c={c} isAdmin={isAdmin}
                  onUpdate={handleUpdate} onDelete={handleDelete} onAvisar={handleAvisar} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {newModal && <ModalCandidato onClose={() => setNewModal(false)} onSave={handleNew} />}
    </Layout>
  );
}

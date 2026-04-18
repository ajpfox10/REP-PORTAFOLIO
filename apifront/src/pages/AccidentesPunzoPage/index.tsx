// src/pages/AccidentesPunzoPage/index.tsx
// Registro de accidentes punzo-cortantes
// app:infectologia:access = solo lectura | app:cargainfecto:access = carga/edita | crud:*:* = admin

import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel } from '../../utils/export';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Accidente {
  id: number;
  agente_dni:           string | null;
  agente_nombre:        string | null;
  servicio:             string | null;
  fecha:                string;
  caso:                 string | null;
  observaciones:        string | null;
  creado_por_email:     string | null;
  creado_at:            string;
  modificado_por_email: string | null;
  modificado_at:        string | null;
}

function fmt(d?: string | null) {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

// ── BANNER ────────────────────────────────────────────────────────────────────

export function AccidentesPunzoBanner() {
  const { session, hasPerm } = useAuth();
  const canVer =
    hasPerm('crud:*:*') ||
    hasPerm('app:infectologia:access') ||
    hasPerm('app:cargainfecto:access');
  const [data, setData]           = useState<{ recientes: number; data: Accidente[] } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!session || !canVer) return;
    apiFetch<any>('/accidentes-punzo/alertas')
      .then(r => { if (r?.ok && r.recientes > 0) setData(r); })
      .catch(() => {});
  }, [session]);

  if (!data || dismissed || data.recientes === 0) return null;

  return (
    <div style={{
      margin: '0 0 16px 0', padding: '14px 16px',
      background: 'rgba(239,68,68,0.1)', border: '2px solid rgba(239,68,68,0.45)',
      borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>🩹</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
          Accidentes punzo-cortantes: {data.recientes} en los últimos 30 días
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {data.data.slice(0, 4).map(a => (
            <div key={a.id} style={{ fontSize: '0.83rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{a.agente_nombre ?? 'Agente desconocido'}</span>
              {a.servicio && <span className="muted">{a.servicio}</span>}
              <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{fmt(a.fecha)}</span>
            </div>
          ))}
          {data.recientes > 4 && <div className="muted" style={{ fontSize: '0.76rem' }}>...y {data.recientes - 4} más</div>}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem' }} className="muted">
          Ir a <a href="/app/infectologia" style={{ color: '#f87171', textDecoration: 'underline' }}>Infectología</a> para ver el registro completo.
        </div>
      </div>
      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: '1.1rem', padding: 0 }}
        onClick={() => setDismissed(true)} title="Cerrar">✕</button>
    </div>
  );
}

// ── FORMULARIO ────────────────────────────────────────────────────────────────

const FORM_EMPTY = { agente_dni: '', agente_nombre: '', servicio: '', fecha: '', caso: '', observaciones: '' };

function FormAccidente({ initial, onSave, onClose }: {
  initial?: Partial<Accidente>;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [form,    setForm]    = useState({ ...FORM_EMPTY, ...initial, fecha: initial?.fecha?.slice(0,10) ?? '' });
  const [saving,  setSaving]  = useState(false);
  const [buscando,setBuscando]= useState(false);
  const [matches, setMatches] = useState<any[]>([]);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const buscarAgente = async () => {
    const q = (form.agente_nombre || form.agente_dni).trim();
    if (!q) return;
    setBuscando(true); setMatches([]);
    try {
      if (/^\d+$/.test(q)) {
        const r = await apiFetch<any>(`/personal/${q}`);
        if (r?.ok && r.data) {
          set('agente_dni',    r.data.dni ?? q);
          set('agente_nombre', `${r.data.apellido ?? ''}, ${r.data.nombre ?? ''}`.trim().replace(/^,\s*/, ''));
          setMatches([]);
        }
      } else {
        const res = await searchPersonal(q);
        setMatches(res.slice(0, 8));
      }
    } catch { toast.error('Error', 'No se pudo buscar'); }
    finally { setBuscando(false); }
  };

  const handleSave = async () => {
    if (!form.fecha) { toast.error('Falta fecha', 'La fecha es obligatoria'); return; }
    setSaving(true);
    await onSave({ ...form, agente_dni: form.agente_dni || null, agente_nombre: form.agente_nombre || null,
      servicio: form.servicio || null, caso: form.caso || null, observaciones: form.observaciones || null });
    setSaving(false);
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const box: React.CSSProperties = {
    background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 14, padding: 24, width: 480, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 16, fontSize: '1rem' }}>
          {initial?.id ? 'Editar accidente' : 'Registrar accidente punzo-cortante'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Buscar agente */}
          <div>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Buscar agente (DNI o apellido)</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" style={{ flex: 1 }}
                placeholder="DNI o apellido…"
                value={form.agente_dni || form.agente_nombre}
                onChange={e => {
                  const v = e.target.value;
                  if (/^\d+$/.test(v)) set('agente_dni', v);
                  else { set('agente_nombre', v); set('agente_dni', ''); }
                  setMatches([]);
                }}
                onKeyDown={e => e.key === 'Enter' && buscarAgente()} />
              <button className="btn" type="button" onClick={buscarAgente} disabled={buscando}
                style={{ whiteSpace: 'nowrap' }}>{buscando ? '…' : '🔍 Buscar'}</button>
            </div>
            {matches.length > 0 && (
              <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
                {matches.map((m, i) => (
                  <div key={i} style={{ padding: '7px 12px', cursor: 'pointer', fontSize: '0.83rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    onClick={() => {
                      set('agente_dni', String(m.dni ?? ''));
                      set('agente_nombre', `${m.apellido ?? ''}, ${m.nombre ?? ''}`.trim().replace(/^,\s*/, ''));
                      if (m.servicio_nombre) set('servicio', m.servicio_nombre);
                      setMatches([]);
                    }}>
                    <span style={{ fontWeight: 600 }}>{m.apellido}, {m.nombre}</span>
                    <span className="muted" style={{ marginLeft: 8, fontSize: '0.75rem' }}>DNI {m.dni}</span>
                    {m.servicio_nombre && <span className="muted" style={{ marginLeft: 6, fontSize: '0.73rem' }}>· {m.servicio_nombre}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Nombre completo</div>
              <input className="input" style={{ width: '100%' }} value={form.agente_nombre}
                onChange={e => set('agente_nombre', e.target.value)} placeholder="Apellido, Nombre" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>DNI</div>
              <input className="input" style={{ width: '100%' }} value={form.agente_dni}
                onChange={e => set('agente_dni', e.target.value)} placeholder="opcional" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Servicio *</div>
              <input className="input" style={{ width: '100%' }} value={form.servicio}
                onChange={e => set('servicio', e.target.value)} placeholder="Ej: Guardia, Emergencias…" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Fecha del accidente *</div>
              <input type="date" className="input" style={{ width: '100%' }} value={form.fecha}
                onChange={e => set('fecha', e.target.value)} />
            </div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Descripción del caso</div>
            <textarea className="input" style={{ width: '100%', height: 80, resize: 'vertical' }}
              value={form.caso} onChange={e => set('caso', e.target.value)}
              placeholder="Tipo de objeto, circunstancias, zona afectada…" />
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Observaciones / Seguimiento</div>
            <textarea className="input" style={{ width: '100%', height: 60, resize: 'vertical' }}
              value={form.observaciones} onChange={e => set('observaciones', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button className="btn" type="button" onClick={onClose}>Cancelar</button>
          <button className="btn primary" type="button" onClick={handleSave} disabled={saving || !form.fecha}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PÁGINA PRINCIPAL ──────────────────────────────────────────────────────────

export function AccidentesPunzoPage() {
  const { hasPerm } = useAuth();
  const toast = useToast();

  const isAdmin      = hasPerm('crud:*:*');
  const canCargar    = isAdmin || hasPerm('app:cargainfecto:access');
  const esCargainfecto = !isAdmin && hasPerm('app:cargainfecto:access');

  // Para cargainfecto: un registro es editable solo si fue cargado hace menos de 24h
  const puedeEditar = (r: Accidente) => {
    if (isAdmin) return true;
    if (!canCargar) return false;
    const cargadoAt = new Date(r.creado_at);
    return (Date.now() - cargadoAt.getTime()) < 24 * 60 * 60 * 1000;
  };

  const [registros, setRegistros] = useState<Accidente[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [busqueda,  setBusqueda]  = useState('');
  const [desdeFiltro, setDesdeFiltro] = useState('');
  const [hastaFiltro, setHastaFiltro] = useState('');
  const [editando,  setEditando]  = useState<Accidente | null | 'nuevo'>(null);
  const [detalle,   setDetalle]   = useState<number | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // cargainfecto: el backend filtra por turno (8h); los filtros de fecha solo aplican a admin/infectología
      if (!esCargainfecto) {
        if (desdeFiltro) params.set('desde', desdeFiltro);
        if (hastaFiltro) params.set('hasta', hastaFiltro);
      }
      const r = await apiFetch<any>(`/accidentes-punzo?${params}`);
      if (r?.ok) setRegistros(r.data ?? []);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, [toast, desdeFiltro, hastaFiltro, esCargainfecto]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtrados = registros.filter(r => {
    if (!busqueda) return true;
    const q = busqueda.toLowerCase();
    return (r.agente_nombre ?? '').toLowerCase().includes(q)
      || (r.agente_dni ?? '').includes(q)
      || (r.servicio ?? '').toLowerCase().includes(q)
      || (r.caso ?? '').toLowerCase().includes(q);
  });

  const handleSave = async (data: any) => {
    const isEdit = typeof editando === 'object' && editando !== null && 'id' in editando;
    const url    = isEdit ? `/accidentes-punzo/${(editando as Accidente).id}` : '/accidentes-punzo';
    const method = isEdit ? 'PUT' : 'POST';
    const r = await apiFetch<any>(url, { method, body: JSON.stringify(data) });
    if (r?.ok) {
      if (isEdit) setRegistros(prev => prev.map(x => x.id === r.data.id ? r.data : x));
      else        setRegistros(prev => [r.data, ...prev]);
      setEditando(null);
      toast.ok(isEdit ? 'Accidente actualizado' : 'Accidente registrado');
    } else {
      toast.error('Error', r?.error ?? 'No se pudo guardar');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar este registro?')) return;
    const r = await apiFetch<any>(`/accidentes-punzo/${id}`, { method: 'DELETE' });
    if (r?.ok) { setRegistros(prev => prev.filter(x => x.id !== id)); toast.ok('Eliminado'); }
    else        toast.error('Error', r?.error);
  };

  const exportar = () => {
    exportToExcel('accidentes_punzo', filtrados.map(r => ({
      Fecha:          fmt(r.fecha),
      Agente:         r.agente_nombre ?? '',
      DNI:            r.agente_dni ?? '',
      Servicio:       r.servicio ?? '',
      Caso:           r.caso ?? '',
      Observaciones:  r.observaciones ?? '',
      'Cargado por':  r.creado_por_email ?? '',
      'Cargado el':   fmt(r.creado_at),
    })));
  };

  return (
    <Layout title="Infectología — Accidentes Punzo-Cortantes">

      {/* Barra */}
      <div className="card" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input className="input" placeholder="Buscar agente, servicio, caso…"
          value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ width: 230 }} />
        {esCargainfecto ? (
          <span style={{ fontSize: '0.72rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '4px 10px' }}>
            🕐 Mostrando registros de las últimas 8 horas (tu turno)
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>Desde:</span>
            <input type="date" className="input" value={desdeFiltro} onChange={e => setDesdeFiltro(e.target.value)} style={{ width: 140 }} />
            <span className="muted" style={{ fontSize: '0.72rem' }}>Hasta:</span>
            <input type="date" className="input" value={hastaFiltro} onChange={e => setHastaFiltro(e.target.value)} style={{ width: 140 }} />
          </div>
        )}
        <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>{filtrados.length} registro{filtrados.length !== 1 ? 's' : ''}</span>
        <button className="btn" type="button" onClick={exportar} disabled={filtrados.length === 0}
          style={{ fontSize: '0.75rem', padding: '4px 12px' }}>📥 Excel</button>
        {canCargar && (
          <button className="btn primary" type="button" onClick={() => setEditando('nuevo')}
            style={{ fontSize: '0.75rem', padding: '4px 12px' }}>+ Nuevo</button>
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
                {['Fecha', 'Agente', 'DNI', 'Servicio', 'Caso', 'Cargado por', 'Acciones'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Cargando…</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Sin registros.</td></tr>
              ) : filtrados.map(r => (
                <React.Fragment key={r.id}>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
                    background: detalle === r.id ? 'rgba(255,255,255,0.04)' : 'transparent' }}
                    onClick={() => setDetalle(detalle === r.id ? null : r.id)}>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: '#fbbf24' }}>{fmt(r.fecha)}</td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={r.agente_nombre ?? ''}>{r.agente_nombre ?? '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#94a3b8', fontSize: '0.8rem' }}>{r.agente_dni ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#94a3b8', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={r.servicio ?? ''}>{r.servicio ?? '—'}</td>
                    <td style={{ padding: '8px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', color: '#cbd5e1' }}
                      title={r.caso ?? ''}>{r.caso ? r.caso.slice(0, 80) + (r.caso.length > 80 ? '…' : '') : '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: '0.76rem', color: '#64748b' }}>{r.creado_por_email ?? '—'}</td>
                    <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canCargar && (() => {
                          const editable = puedeEditar(r);
                          return (
                            <button className="btn" type="button"
                              style={{ fontSize: '0.72rem', padding: '3px 8px', opacity: editable ? 1 : 0.4 }}
                              title={editable ? 'Editar' : 'Solo se puede editar dentro de las 24h de carga'}
                              disabled={!editable}
                              onClick={() => editable && setEditando(r)}>✏</button>
                          );
                        })()}
                        {isAdmin && (
                          <button className="btn danger" type="button" style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                            onClick={() => handleDelete(r.id)}>✕</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {detalle === r.id && (
                    <tr style={{ background: 'rgba(15,23,42,0.5)' }}>
                      <td colSpan={7} style={{ padding: '12px 20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                          {[
                            { label: 'Caso completo', value: r.caso },
                            { label: 'Observaciones / Seguimiento', value: r.observaciones },
                            { label: 'Cargado por', value: r.creado_por_email },
                            { label: 'Cargado el', value: fmt(r.creado_at) },
                            { label: 'Modificado por', value: r.modificado_por_email },
                            { label: 'Modificado el', value: fmt(r.modificado_at) },
                          ].map(item => item.value && (
                            <div key={item.label}>
                              <div className="muted" style={{ fontSize: '0.69rem', marginBottom: 2 }}>{item.label}</div>
                              <div style={{ fontSize: '0.82rem' }}>{item.value}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editando !== null && (
        <FormAccidente
          initial={editando === 'nuevo' ? undefined : editando}
          onClose={() => setEditando(null)}
          onSave={handleSave}
        />
      )}
    </Layout>
  );
}

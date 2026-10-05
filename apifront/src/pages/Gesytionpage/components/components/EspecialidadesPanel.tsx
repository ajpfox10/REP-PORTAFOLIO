// Historial de especialidades del agente (agentes_especialidades) + cambio con fechas.
// Cambiar = cerrar la vigente en una fecha y abrir la nueva desde otra (por defecto el
// día siguiente). Cada período se puede corregir (fechas/observaciones) o anular.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../../api/http';
import { useToast } from '../../../../ui/toast';
import { SearchableSelect } from '../../../CargaAgentePage/components/SearchableSelect';

type Periodo = {
  id: number;
  especialidad_id: number;
  especialidad: string | null;
  profesion: string | null;
  fecha_desde: string;
  fecha_hasta: string | null;
  observaciones: string | null;
  vigente: 0 | 1;
};

const hoy = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmt = (iso?: string | null) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};
const etiqueta = (p: { especialidad: string | null; profesion: string | null }) =>
  p.profesion ? `${p.especialidad} (${p.profesion})` : (p.especialidad || '—');

const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: '0.8rem' };
const labelStyle: React.CSSProperties = { fontSize: '0.66rem', color: '#94a3b8', marginBottom: 2, display: 'block' };
const SOLO_CERRAR = '__cerrar__';

export function EspecialidadesPanel({ dni, onChanged }: { dni: number | string; onChanged?: () => void }) {
  const toast = useToast();
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [catalogo, setCatalogo] = useState<{ id: number | string; nombre: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // formulario de cambio
  const [nueva, setNueva] = useState('');
  const [cierre, setCierre] = useState(hoy());
  const [alta, setAlta] = useState(addDays(hoy(), 1));
  const [obs, setObs] = useState('');

  // corrección en línea
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ fecha_desde: string; fecha_hasta: string; observaciones: string }>({ fecha_desde: '', fecha_hasta: '', observaciones: '' });

  const vigente = periodos.find(p => p.vigente === 1) || null;

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/personal/${dni}/especialidades`);
      setPeriodos(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setPeriodos([]);
    } finally {
      setLoading(false);
    }
  }, [dni]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    apiFetch<any>('/personal/especialidades')
      .then(res => setCatalogo((res?.data || []).map((r: any) => ({ id: r.id, nombre: etiqueta(r) }))))
      .catch(() => setCatalogo([]));
  }, []);

  // sin vigente la nueva arranca hoy; con vigente, el día siguiente al cierre
  useEffect(() => {
    setNueva(''); setObs(''); setEditId(null);
    setCierre(hoy());
    setAlta(vigente ? addDays(hoy(), 1) : hoy());
  }, [dni, vigente?.id]); // eslint-disable-line

  const opciones = useMemo(() => {
    const base = catalogo.filter(o => !vigente || String(o.id) !== String(vigente.especialidad_id));
    return vigente ? [{ id: SOLO_CERRAR, nombre: '— Solo cerrar la vigente (sin nueva) —' }, ...base] : base;
  }, [catalogo, vigente]);

  const errorMsg = (e: any, def: string) => e?.details?.error || e?.message || def;

  const guardarCambio = async () => {
    if (!nueva) { toast.error('Elegí la especialidad nueva'); return; }
    const soloCerrar = nueva === SOLO_CERRAR;
    if (vigente && !cierre) { toast.error('Falta la fecha de cierre de la especialidad vigente'); return; }
    if (!soloCerrar && !alta) { toast.error('Falta la fecha de alta de la nueva especialidad'); return; }
    if (vigente && !soloCerrar && alta <= cierre) { toast.error('La fecha de alta tiene que ser posterior al cierre'); return; }
    setSaving(true);
    try {
      const res = await apiFetch<any>(`/personal/${dni}/especialidades/cambio`, {
        method: 'POST',
        body: JSON.stringify({
          especialidad_id: soloCerrar ? null : Number(nueva),
          ...(vigente ? { fecha_cierre: cierre } : {}),
          ...(soloCerrar ? {} : { fecha_desde: alta }),
          ...(obs.trim() ? { observaciones: obs.trim() } : {}),
        }),
      });
      if (!res?.ok) throw new Error(res?.error || 'Error al guardar');
      toast.ok(soloCerrar ? 'Especialidad cerrada' : 'Especialidad actualizada', `DNI ${dni}`);
      await cargar();
      onChanged?.();
    } catch (e: any) {
      toast.error('No se pudo cambiar la especialidad', errorMsg(e, 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const guardarCorreccion = async (p: Periodo) => {
    if (!edit.fecha_desde) { toast.error('La fecha desde es obligatoria'); return; }
    if (edit.fecha_hasta && edit.fecha_hasta < edit.fecha_desde) { toast.error('La fecha hasta no puede ser anterior a la desde'); return; }
    setSaving(true);
    try {
      const res = await apiFetch<any>(`/personal/${dni}/especialidades/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fecha_desde: edit.fecha_desde,
          fecha_hasta: edit.fecha_hasta || null,
          observaciones: edit.observaciones.trim() || null,
        }),
      });
      if (!res?.ok) throw new Error(res?.error || 'Error al guardar');
      toast.ok('Período corregido');
      setEditId(null);
      await cargar();
      onChanged?.();
    } catch (e: any) {
      toast.error('No se pudo corregir', errorMsg(e, 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const anular = async (p: Periodo) => {
    if (!window.confirm(`¿Anular ${etiqueta(p)} (${fmt(p.fecha_desde)} → ${p.fecha_hasta ? fmt(p.fecha_hasta) : 'vigente'})? Usalo solo si se cargó por error.`)) return;
    setSaving(true);
    try {
      const res = await apiFetch<any>(`/personal/${dni}/especialidades/${p.id}`, { method: 'DELETE' });
      if (!res?.ok) throw new Error(res?.error || 'Error al anular');
      toast.ok('Período anulado');
      await cargar();
      onChanged?.();
    } catch (e: any) {
      toast.error('No se pudo anular', errorMsg(e, 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const soloCerrar = nueva === SOLO_CERRAR;

  return (
    <div style={{ padding: '6px 2px' }}>
      {/* Historial */}
      {loading ? (
        <div style={{ padding: 12, color: '#64748b', fontSize: '0.82rem' }}>⏳ Cargando…</div>
      ) : periodos.length === 0 ? (
        <div style={{ padding: '12px 0', textAlign: 'center', color: '#475569', fontSize: '0.82rem' }}>
          Sin especialidades cargadas
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {periodos.map(p => {
            const activo = p.vigente === 1;
            const enEdicion = editId === p.id;
            return (
              <div key={p.id} style={{
                background: activo ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${activo ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: 9, padding: '9px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '0.86rem', color: '#e2e8f0' }}>{p.especialidad || '—'}</strong>
                  {p.profesion && <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{p.profesion}</span>}
                  {activo && (
                    <span style={{
                      padding: '1px 8px', borderRadius: 99, fontSize: '0.66rem', fontWeight: 700,
                      background: 'rgba(34,197,94,0.12)', color: '#86efac', border: '1px solid rgba(34,197,94,0.25)',
                    }}>VIGENTE</span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {!enEdicion && (
                      <button type="button" className="btn" disabled={saving} title="Corregir fechas u observaciones"
                        style={{ padding: '1px 8px', fontSize: '0.72rem' }}
                        onClick={() => {
                          setEditId(p.id);
                          setEdit({ fecha_desde: p.fecha_desde, fecha_hasta: p.fecha_hasta || '', observaciones: p.observaciones || '' });
                        }}>✏️</button>
                    )}
                    <button type="button" className="btn" disabled={saving} title="Anular (cargado por error)"
                      style={{ padding: '1px 8px', fontSize: '0.72rem' }}
                      onClick={() => anular(p)}>🗑</button>
                  </span>
                </div>

                {enEdicion ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                    <div>
                      <label style={labelStyle}>DESDE</label>
                      <input className="input" type="date" style={inputStyle} value={edit.fecha_desde}
                        onChange={e => setEdit(v => ({ ...v, fecha_desde: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>HASTA (vacío = vigente)</label>
                      <input className="input" type="date" style={inputStyle} value={edit.fecha_hasta}
                        onChange={e => setEdit(v => ({ ...v, fecha_hasta: e.target.value }))} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>OBSERVACIONES</label>
                      <input className="input" style={inputStyle} value={edit.observaciones} maxLength={255}
                        onChange={e => setEdit(v => ({ ...v, observaciones: e.target.value }))} />
                    </div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn" disabled={saving} onClick={() => setEditId(null)}
                        style={{ padding: '2px 10px', fontSize: '0.76rem' }}>Cancelar</button>
                      <button type="button" className="btn primary" disabled={saving} onClick={() => guardarCorreccion(p)}
                        style={{ padding: '2px 10px', fontSize: '0.76rem' }}>Guardar</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
                    📅 {fmt(p.fecha_desde)} → {p.fecha_hasta ? fmt(p.fecha_hasta) : 'Actual'}
                    {p.observaciones && <span style={{ marginLeft: 8, color: '#94a3b8' }}>· {p.observaciones}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cambio / alta */}
      <div style={{
        marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7,
      }}>
        <div style={{ gridColumn: '1 / -1', fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
          {vigente ? '— CAMBIAR ESPECIALIDAD —' : '— ASIGNAR ESPECIALIDAD —'}
        </div>
        <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
          <label style={labelStyle}>{vigente ? 'NUEVA ESPECIALIDAD' : 'ESPECIALIDAD'}</label>
          <SearchableSelect value={nueva} onChange={v => setNueva(String(v ?? ''))} options={opciones}
            placeholder="— elegir —" />
        </div>
        {vigente && (
          <div>
            <label style={labelStyle}>CIERRE DE {String(vigente.especialidad || '').toUpperCase()}</label>
            <input className="input" type="date" style={inputStyle} value={cierre} min={vigente.fecha_desde}
              onChange={e => { setCierre(e.target.value); if (e.target.value) setAlta(addDays(e.target.value, 1)); }} />
          </div>
        )}
        {!soloCerrar && (
          <div>
            <label style={labelStyle}>ALTA DE LA NUEVA</label>
            <input className="input" type="date" style={inputStyle} value={alta}
              onChange={e => setAlta(e.target.value)} />
          </div>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>OBSERVACIONES</label>
          <input className="input" style={inputStyle} value={obs} maxLength={255} placeholder="Opcional (p.ej. nº de resolución)"
            onChange={e => setObs(e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn primary" disabled={saving || !nueva} onClick={guardarCambio}
            style={{ padding: '4px 14px', fontSize: '0.8rem' }}>
            {saving ? 'Guardando…' : soloCerrar ? 'Cerrar especialidad' : vigente ? 'Cambiar especialidad' : 'Asignar'}
          </button>
        </div>
      </div>
    </div>
  );
}

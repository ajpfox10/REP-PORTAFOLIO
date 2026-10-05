// src/pages/CasosViolenciaPage/index.tsx
// Casos de violencia laboral: víctima, expediente (se espeja en expedientes del agente),
// agresor interno (agente) o externo, intervención y recomendaciones del equipo de
// violencia (DAVSAL / cambio de horario / cambio de sector) y todo lo remitido.
// Solo admin. API: /casos-violencia

import React, { useCallback, useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';

type Estado = 'ABIERTO' | 'EN_SEGUIMIENTO' | 'CERRADO';

const ESTADO_LABEL: Record<Estado, string> = {
  ABIERTO: '🔴 Abierto',
  EN_SEGUIMIENTO: '🟡 En seguimiento',
  CERRADO: '⚪ Cerrado',
};

type AgenteLite = { dni: number; apellido: string; nombre: string; servicio_id: number | null; servicio_nombre: string | null };

type CasoForm = {
  dni: string;
  fecha_hecho: string;
  descripcion: string;
  expediente_numero: string;
  agresor_tipo: 'INTERNO' | 'EXTERNO' | '';
  agresor_dni: string;
  agresor_externo_nombre: string;
  agresor_externo_vinculo: string;
  equipo_intervino: boolean;
  equipo_fecha_intervencion: string;
  equipo_observaciones: string;
  rec_davsal: boolean;
  rec_cambio_horario: boolean;
  rec_cambio_sector: boolean;
  rec_otra: string;
  estado: Estado;
};

const FORM_VACIO: CasoForm = {
  dni: '', fecha_hecho: '', descripcion: '', expediente_numero: '',
  agresor_tipo: '', agresor_dni: '', agresor_externo_nombre: '', agresor_externo_vinculo: '',
  equipo_intervino: false, equipo_fecha_intervencion: '', equipo_observaciones: '',
  rec_davsal: false, rec_cambio_horario: false, rec_cambio_sector: false, rec_otra: '',
  estado: 'ABIERTO',
};

const hoy = () => new Date().toISOString().slice(0, 10);
const fmtFecha = (f?: string | null) => (f ? f.slice(0, 10).split('-').reverse().join('/') : '—');

const S = {
  label: { fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#94a3b8', fontWeight: 600, marginBottom: 4, display: 'block' },
  seccion: { border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, gap: 10 },
  seccionTitulo: { fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', zIndex: 1000, overflowY: 'auto' as const },
  modal: { background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, width: 'min(860px, 100%)', padding: 18, display: 'flex', flexDirection: 'column' as const, gap: 14 },
  th: { padding: '7px 10px', textAlign: 'left' as const, color: '#64748b', fontSize: '0.67rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em', whiteSpace: 'nowrap' as const },
  td: { padding: '8px 10px', verticalAlign: 'top' as const },
  chip: (bg: string, fg: string) => ({ display: 'inline-block', fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: bg, color: fg, marginRight: 4, marginBottom: 2, whiteSpace: 'nowrap' as const }),
};

// ─── Selector de agente: DNI directo o búsqueda por apellido ──────────────────
function AgentePicker({ label, dni, onChange, excluirDni }: {
  label: string; dni: string; onChange: (dni: string) => void; excluirDni?: string;
}) {
  const [agente, setAgente]   = useState<AgenteLite | null>(null);
  const [error, setError]     = useState('');
  const [q, setQ]             = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const d = dni.replace(/\D/g, '');
    if (d.length < 7) { setAgente(null); setError(''); return; }
    let cancel = false;
    apiFetch<any>(`/casos-violencia/agente/${d}`)
      .then(r => { if (!cancel) { setAgente(r?.data ?? null); setError(''); } })
      .catch(e => { if (!cancel) { setAgente(null); setError(e?.message || 'No encontrado'); } });
    return () => { cancel = true; };
  }, [dni]);

  const buscar = async () => {
    const t = q.trim();
    if (t.length < 3) return;
    setBuscando(true);
    try {
      const r = await apiFetch<any>(`/personal/search?q=${encodeURIComponent(t)}&limit=20&page=1`);
      setMatches((r?.data || []).filter((m: any) => String(m.dni) !== excluirDni));
    } catch { setMatches([]); }
    finally { setBuscando(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={S.label}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input className="input" style={{ width: 130 }} placeholder="DNI" inputMode="numeric"
          value={dni} onChange={e => onChange(e.target.value.replace(/\D/g, ''))} />
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="…o buscar por apellido"
          value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }} />
        <button type="button" className="btn" onClick={buscar} disabled={buscando || q.trim().length < 3}>
          {buscando ? '⏳' : '🔍'}
        </button>
      </div>
      {matches.length > 0 && (
        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
          {matches.map(m => (
            <div key={m.dni} role="button" tabIndex={0}
              onClick={() => { onChange(String(m.dni)); setMatches([]); setQ(''); }}
              onKeyDown={e => { if (e.key === 'Enter') { onChange(String(m.dni)); setMatches([]); setQ(''); } }}
              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <b>{m.apellido}, {m.nombre}</b> <span className="muted">· DNI {m.dni}{m.servicio_nombre ? ` · ${m.servicio_nombre}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {agente && (
        <div style={{ fontSize: '0.8rem', color: '#a7f3d0' }}>
          ✔ {agente.apellido}, {agente.nombre} · {agente.servicio_nombre || 'sin servicio vigente'}
        </div>
      )}
      {error && <div style={{ fontSize: '0.78rem', color: '#fca5a5' }}>{error}</div>}
    </div>
  );
}

// ─── Modal alta / edición + remisiones ────────────────────────────────────────
function CasoModal({ casoId, destinos, onClose, onSaved }: {
  casoId: number | null; destinos: { id: number; nombre: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [id, setId]           = useState<number | null>(casoId);
  const [form, setForm]       = useState<CasoForm>(FORM_VACIO);
  const [remisiones, setRemisiones] = useState<any[]>([]);
  const [cargando, setCargando] = useState(!!casoId);
  const [guardando, setGuardando] = useState(false);
  const [rem, setRem] = useState({ destino_id: '', fecha: hoy(), numero: '', observacion: '' });

  const set = <K extends keyof CasoForm>(k: K, v: CasoForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const cargar = useCallback(async (cid: number) => {
    setCargando(true);
    try {
      const r = await apiFetch<any>(`/casos-violencia/${cid}`);
      const c = r?.data;
      setForm({
        dni: String(c.dni ?? ''), fecha_hecho: c.fecha_hecho || '', descripcion: c.descripcion || '',
        expediente_numero: c.expediente_numero || '', agresor_tipo: c.agresor_tipo || '',
        agresor_dni: c.agresor_dni ? String(c.agresor_dni) : '',
        agresor_externo_nombre: c.agresor_externo_nombre || '', agresor_externo_vinculo: c.agresor_externo_vinculo || '',
        equipo_intervino: !!c.equipo_intervino, equipo_fecha_intervencion: c.equipo_fecha_intervencion || '',
        equipo_observaciones: c.equipo_observaciones || '',
        rec_davsal: !!c.rec_davsal, rec_cambio_horario: !!c.rec_cambio_horario, rec_cambio_sector: !!c.rec_cambio_sector,
        rec_otra: c.rec_otra || '', estado: c.estado,
      });
      setRemisiones(c.remisiones || []);
    } catch (e: any) {
      toast.error('No se pudo abrir el caso', e?.message);
    } finally { setCargando(false); }
  }, []); // eslint-disable-line

  useEffect(() => { if (casoId) cargar(casoId); }, [casoId, cargar]);

  const guardar = async () => {
    if (!form.dni) { toast.error('Falta el agente (víctima)'); return; }
    if (!form.agresor_tipo) { toast.error('Indicá si el agresor es interno o externo'); return; }
    setGuardando(true);
    try {
      const r = await apiFetch<any>(id ? `/casos-violencia/${id}` : '/casos-violencia', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(form),
      });
      toast.ok(id ? 'Caso actualizado' : 'Caso registrado',
        form.expediente_numero ? 'Expediente cargado también en los expedientes del agente' : undefined);
      onSaved();
      if (!id && r?.data?.id) { setId(r.data.id); await cargar(r.data.id); }
    } catch (e: any) {
      toast.error('Error al guardar', e?.message);
    } finally { setGuardando(false); }
  };

  const agregarRemision = async () => {
    if (!id) return;
    if (!rem.destino_id) { toast.error('Elegí a dónde se remitió'); return; }
    try {
      await apiFetch<any>(`/casos-violencia/${id}/remisiones`, { method: 'POST', body: JSON.stringify(rem) });
      setRem({ destino_id: '', fecha: hoy(), numero: '', observacion: '' });
      await cargar(id);
      onSaved();
    } catch (e: any) { toast.error('Error al registrar la remisión', e?.message); }
  };

  const quitarRemision = async (rid: number) => {
    if (!id || !window.confirm('¿Quitar esta remisión?')) return;
    try {
      await apiFetch<any>(`/casos-violencia/${id}/remisiones/${rid}`, { method: 'DELETE' });
      await cargar(id);
      onSaved();
    } catch (e: any) { toast.error('Error al quitar', e?.message); }
  };

  const check = (k: 'rec_davsal' | 'rec_cambio_horario' | 'rec_cambio_sector' | 'equipo_intervino', label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)} /> {label}
    </label>
  );

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '1rem' }}>{id ? `🛡️ Caso #${id}` : '🛡️ Nuevo caso de violencia'}</strong>
          <button className="btn" type="button" onClick={onClose}>✕</button>
        </div>

        {cargando ? <div className="muted" style={{ padding: 30, textAlign: 'center' }}>🔄 Cargando…</div> : (<>
          {/* Víctima + hecho */}
          <div style={S.seccion}>
            <div style={S.seccionTitulo}>👤 Agente</div>
            <AgentePicker label="Agente (víctima) *" dni={form.dni} onChange={v => set('dni', v)} excluirDni={form.agresor_dni} />
            <div style={S.grid2}>
              <div>
                <span style={S.label}>Fecha del hecho</span>
                <input className="input" type="date" value={form.fecha_hecho} onChange={e => set('fecha_hecho', e.target.value)} />
              </div>
              <div>
                <span style={S.label}>Estado</span>
                <select className="input" value={form.estado} onChange={e => set('estado', e.target.value as Estado)}>
                  {(Object.keys(ESTADO_LABEL) as Estado[]).map(k => <option key={k} value={k}>{ESTADO_LABEL[k]}</option>)}
                </select>
              </div>
            </div>
            <div>
              <span style={S.label}>Descripción</span>
              <textarea className="input" rows={3} value={form.descripcion} onChange={e => set('descripcion', e.target.value)} />
            </div>
          </div>

          {/* Expediente */}
          <div style={S.seccion}>
            <div style={S.seccionTitulo}>📁 Expediente</div>
            <input className="input" placeholder="EX-2026-…-GDEBA-…" value={form.expediente_numero}
              onChange={e => set('expediente_numero', e.target.value)} />
            <div className="muted" style={{ fontSize: '0.72rem' }}>
              Se carga también en los expedientes del agente (Resoluciones → Expedientes).
            </div>
          </div>

          {/* Agresor */}
          <div style={S.seccion}>
            <div style={S.seccionTitulo}>⚠️ Agresor *</div>
            <div style={{ display: 'flex', gap: 16 }}>
              {(['INTERNO', 'EXTERNO'] as const).map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', cursor: 'pointer' }}>
                  <input type="radio" name="agresor_tipo" checked={form.agresor_tipo === t} onChange={() => set('agresor_tipo', t)} />
                  {t === 'INTERNO' ? 'Interno (del equipo)' : 'Externo'}
                </label>
              ))}
            </div>
            {form.agresor_tipo === 'INTERNO' && (
              <AgentePicker label="Agente agresor *" dni={form.agresor_dni} onChange={v => set('agresor_dni', v)} excluirDni={form.dni} />
            )}
            {form.agresor_tipo === 'EXTERNO' && (
              <div style={S.grid2}>
                <div>
                  <span style={S.label}>Nombre</span>
                  <input className="input" value={form.agresor_externo_nombre} onChange={e => set('agresor_externo_nombre', e.target.value)} />
                </div>
                <div>
                  <span style={S.label}>Vínculo</span>
                  <input className="input" list="cv-vinculos" placeholder="Paciente, familiar…" value={form.agresor_externo_vinculo}
                    onChange={e => set('agresor_externo_vinculo', e.target.value)} />
                  <datalist id="cv-vinculos">
                    <option value="Paciente" /><option value="Familiar de paciente" /><option value="Acompañante" />
                    <option value="Proveedor / contratista" /><option value="Otro" />
                  </datalist>
                </div>
              </div>
            )}
          </div>

          {/* Equipo de violencia */}
          <div style={S.seccion}>
            <div style={S.seccionTitulo}>🤝 Equipo de violencia</div>
            {check('equipo_intervino', 'El equipo de violencia intervino')}
            {form.equipo_intervino && (
              <div style={{ maxWidth: 220 }}>
                <span style={S.label}>Fecha de intervención</span>
                <input className="input" type="date" value={form.equipo_fecha_intervencion}
                  onChange={e => set('equipo_fecha_intervencion', e.target.value)} />
              </div>
            )}
            <span style={S.label}>Recomienda</span>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {check('rec_davsal', 'DAVSAL')}
              {check('rec_cambio_horario', 'Cambio de horario')}
              {check('rec_cambio_sector', 'Cambio de sector')}
            </div>
            <input className="input" placeholder="Otra recomendación…" value={form.rec_otra} onChange={e => set('rec_otra', e.target.value)} />
            <div>
              <span style={S.label}>Observaciones del equipo</span>
              <textarea className="input" rows={2} value={form.equipo_observaciones} onChange={e => set('equipo_observaciones', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" type="button" onClick={onClose} disabled={guardando}>Cerrar</button>
            <button className="btn" type="button" onClick={guardar} disabled={guardando}
              style={{ background: 'rgba(124,58,237,0.25)', borderColor: '#7c3aed', fontWeight: 700 }}>
              {guardando ? '⏳ Guardando…' : id ? '💾 Guardar cambios' : '💾 Registrar caso'}
            </button>
          </div>

          {/* Remisiones */}
          <div style={S.seccion}>
            <div style={S.seccionTitulo}>📤 Remitido ({remisiones.length})</div>
            {!id ? (
              <div className="muted" style={{ fontSize: '0.78rem' }}>Registrá el caso primero para cargar lo remitido.</div>
            ) : (<>
              {remisiones.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead><tr>{['Fecha', 'Destino', 'Nº nota / expediente', 'Observación', 'Cargó', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {remisiones.map(r => (
                        <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{fmtFecha(r.fecha)}</td>
                          <td style={{ ...S.td, fontWeight: 600 }}>{r.destino}</td>
                          <td style={{ ...S.td, fontFamily: 'monospace' }}>{r.numero || '—'}</td>
                          <td style={S.td}>{r.observacion || '—'}</td>
                          <td style={{ ...S.td, color: '#64748b' }}>{r.creado_por_email || '—'}</td>
                          <td style={S.td}><button className="btn" type="button" onClick={() => quitarRemision(r.id)} title="Quitar">🗑️</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
                <div>
                  <span style={S.label}>Destino *</span>
                  <select className="input" value={rem.destino_id} onChange={e => setRem(r => ({ ...r, destino_id: e.target.value }))}>
                    <option value="">Elegir…</option>
                    {destinos.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <span style={S.label}>Fecha *</span>
                  <input className="input" type="date" value={rem.fecha} onChange={e => setRem(r => ({ ...r, fecha: e.target.value }))} />
                </div>
                <div>
                  <span style={S.label}>Nº nota / expediente</span>
                  <input className="input" value={rem.numero} onChange={e => setRem(r => ({ ...r, numero: e.target.value }))} />
                </div>
                <div>
                  <span style={S.label}>Observación</span>
                  <input className="input" value={rem.observacion} onChange={e => setRem(r => ({ ...r, observacion: e.target.value }))} />
                </div>
                <button className="btn" type="button" onClick={agregarRemision}>➕ Remitir</button>
              </div>
            </>)}
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export function CasosViolenciaPage() {
  const toast = useToast();
  const [casos, setCasos]       = useState<any[]>([]);
  const [destinos, setDestinos] = useState<{ id: number; nombre: string }[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros]   = useState({ estado: '', agresor_tipo: '', equipo: '', recomendacion: '', q: '' });
  const [modal, setModal]       = useState<{ id: number | null } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v) as [string, string][]).toString();
      const r = await apiFetch<any>(`/casos-violencia${qs ? `?${qs}` : ''}`);
      setCasos(r?.data || []);
    } catch (e: any) {
      toast.error('Error al cargar casos', e?.message);
    } finally { setCargando(false); }
  }, [filtros]); // eslint-disable-line

  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);
  useEffect(() => {
    apiFetch<any>('/casos-violencia/destinos').then(r => setDestinos(r?.data || [])).catch(() => setDestinos([]));
  }, []);

  const eliminar = async (c: any) => {
    if (!window.confirm(`¿Eliminar el caso #${c.id} de ${c.victima_nombre}?`)) return;
    try {
      await apiFetch<any>(`/casos-violencia/${c.id}`, { method: 'DELETE' });
      toast.ok('Caso eliminado');
      cargar();
    } catch (e: any) { toast.error('Error al eliminar', e?.message); }
  };

  const setF = (k: keyof typeof filtros, v: string) => setFiltros(f => ({ ...f, [k]: v }));
  const abiertos = casos.filter(c => c.estado !== 'CERRADO').length;

  return (
    <Layout title="Casos de Violencia" showBack>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ fontSize: '1.05rem' }}>🛡️ Casos de Violencia</strong>
            {!cargando && <div className="muted" style={{ fontSize: '0.73rem', marginTop: 3 }}>{casos.length} caso(s) · {abiertos} sin cerrar</div>}
          </div>
          <button className="btn" type="button" onClick={() => setModal({ id: null })}
            style={{ background: 'rgba(124,58,237,0.25)', borderColor: '#7c3aed', fontWeight: 700 }}>
            ➕ Nuevo caso
          </button>
        </div>

        <div className="card" style={{ padding: '0.8rem 1rem', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="DNI, apellido, agresor o expediente…"
            aria-label="Buscar" value={filtros.q} onChange={e => setF('q', e.target.value)} />
          <select className="input" style={{ width: 'auto' }} aria-label="Estado" value={filtros.estado} onChange={e => setF('estado', e.target.value)}>
            <option value="">Todos los estados</option>
            {(Object.keys(ESTADO_LABEL) as Estado[]).map(k => <option key={k} value={k}>{ESTADO_LABEL[k]}</option>)}
          </select>
          <select className="input" style={{ width: 'auto' }} aria-label="Agresor" value={filtros.agresor_tipo} onChange={e => setF('agresor_tipo', e.target.value)}>
            <option value="">Agresor: todos</option>
            <option value="INTERNO">Interno</option>
            <option value="EXTERNO">Externo</option>
          </select>
          <select className="input" style={{ width: 'auto' }} aria-label="Equipo" value={filtros.equipo} onChange={e => setF('equipo', e.target.value)}>
            <option value="">Equipo: todos</option>
            <option value="1">Intervino</option>
            <option value="0">No intervino</option>
          </select>
          <select className="input" style={{ width: 'auto' }} aria-label="Recomendación" value={filtros.recomendacion} onChange={e => setF('recomendacion', e.target.value)}>
            <option value="">Recomendación: todas</option>
            <option value="davsal">DAVSAL</option>
            <option value="horario">Cambio de horario</option>
            <option value="sector">Cambio de sector</option>
          </select>
        </div>

        <div className="card" style={{ padding: '0.6rem 0.8rem', overflowX: 'auto' }}>
          {cargando ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>🔄 Cargando…</div>
          ) : casos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Sin casos registrados</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.81rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                  {['#', 'Fecha', 'Agente', 'Agresor', 'Expediente', 'Equipo', 'Recomienda', 'Remitido', 'Estado', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {casos.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
                    onClick={() => setModal({ id: c.id })}>
                    <td style={{ ...S.td, fontFamily: 'monospace', color: '#64748b' }}>{c.id}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{fmtFecha(c.fecha_hecho)}</td>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600 }}>{c.victima_nombre}</div>
                      <div className="muted" style={{ fontSize: '0.72rem' }}>DNI {c.dni}{c.servicio_nombre ? ` · ${c.servicio_nombre}` : ''}</div>
                    </td>
                    <td style={S.td}>
                      {c.agresor_tipo === 'INTERNO' ? (<>
                        <span style={S.chip('rgba(239,68,68,0.18)', '#fca5a5')}>INTERNO</span>
                        <div>{c.agresor_nombre}</div>
                        <div className="muted" style={{ fontSize: '0.72rem' }}>DNI {c.agresor_dni}{c.agresor_servicio_nombre ? ` · ${c.agresor_servicio_nombre}` : ''}</div>
                      </>) : (<>
                        <span style={S.chip('rgba(148,163,184,0.18)', '#cbd5e1')}>EXTERNO</span>
                        <div>{c.agresor_externo_nombre || '—'}</div>
                        {c.agresor_externo_vinculo && <div className="muted" style={{ fontSize: '0.72rem' }}>{c.agresor_externo_vinculo}</div>}
                      </>)}
                    </td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: '0.74rem' }}>{c.expediente_numero || '—'}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      {c.equipo_intervino ? `✅ ${fmtFecha(c.equipo_fecha_intervencion)}` : '—'}
                    </td>
                    <td style={S.td}>
                      {!!c.rec_davsal && <span style={S.chip('rgba(124,58,237,0.22)', '#c4b5fd')}>DAVSAL</span>}
                      {!!c.rec_cambio_horario && <span style={S.chip('rgba(14,165,233,0.2)', '#7dd3fc')}>Horario</span>}
                      {!!c.rec_cambio_sector && <span style={S.chip('rgba(16,185,129,0.2)', '#6ee7b7')}>Sector</span>}
                      {c.rec_otra && <span style={S.chip('rgba(148,163,184,0.18)', '#cbd5e1')} title={c.rec_otra}>Otra</span>}
                      {!c.rec_davsal && !c.rec_cambio_horario && !c.rec_cambio_sector && !c.rec_otra && '—'}
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' }}>{Number(c.remisiones_count) || '—'}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{ESTADO_LABEL[c.estado as Estado] || c.estado}</td>
                    <td style={S.td} onClick={e => e.stopPropagation()}>
                      <button className="btn" type="button" title="Eliminar" onClick={() => eliminar(c)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal && (
        <CasoModal casoId={modal.id} destinos={destinos}
          onClose={() => setModal(null)} onSaved={cargar} />
      )}
    </Layout>
  );
}

export default CasosViolenciaPage;

// src/pages/VacacionesAdelantadasPage/index.tsx
// Herramientas → Vacaciones adelantadas (tabla vacaciones_adelantadas, mig 092).
// Búsqueda por agente/DNI, servicio, dependencia, año imputado y período; alta, edición y
// borrado lógico. Cada fila muestra quién la cargó, quién la editó y (con "ver borradas") quién la borró.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel } from '../../utils/export';
import { fmtFecha } from '../../components/Comisiones';

type VacAdel = {
  id: number; dni: number; apellido: string; nombre: string; agente_id: number | null;
  fecha_desde: string; fecha_hasta: string; dias: number; anio_imputado: number;
  servicio_id: number | null; servicio: string | null;
  dependencia_id: number | null; dependencia: string | null;
  observaciones: string | null;
  created_at: string | null; updated_at: string | null; deleted_at: string | null;
  creado_por: string | null; editado_por: string | null; borrado_por: string | null;
};
type Opcion = { id: string; nombre: string };

const card: React.CSSProperties = { padding: '14px 16px' };
const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 8px', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' };
const lbl: React.CSSProperties = { fontSize: '0.7rem', color: '#94a3b8', marginBottom: 2, display: 'block' };
const fld: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: '0.86rem' };
const btnAzul: React.CSSProperties = { background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' };

/** Días corridos entre dos fechas ISO, ambas inclusive. */
function diasCorridos(desde: string, hasta: string): number | null {
  if (!desde || !hasta) return null;
  const n = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1;
  return n > 0 ? n : null;
}

const aOpciones = (res: any): Opcion[] => {
  const raw: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
  return raw.filter(x => !Number(x.oculto)).map(x => ({ id: String(x.id), nombre: String(x.nombre) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
};

// ─── Alta / edición ───────────────────────────────────────────────────────────
function VacAdelModal({ editar, onClose, onDone }: { editar: VacAdel | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [dni, setDni] = useState(editar ? String(editar.dni) : '');
  const [agente, setAgente] = useState<string | null>(editar ? `${editar.apellido}, ${editar.nombre}` : null);
  const [f, setF] = useState({
    fecha_desde: editar?.fecha_desde ?? '', fecha_hasta: editar?.fecha_hasta ?? '',
    dias: editar ? String(editar.dias) : '',
    anio_imputado: String(editar?.anio_imputado ?? new Date().getFullYear()),
    observaciones: editar?.observaciones ?? '',
  });
  const [diasManual, setDiasManual] = useState(!!editar);
  const [saving, setSaving] = useState(false);

  const buscarAgente = async () => {
    const d = dni.replace(/\D/g, '');
    if (!/^\d{6,8}$/.test(d)) return toast.error('DNI inválido');
    try {
      const res = await apiFetch<any>(`/personal/${d}`);
      if (!res?.data) { setAgente(null); return toast.error('No se encontró el agente'); }
      setAgente(`${res.data.apellido}, ${res.data.nombre}`);
    } catch (e: any) { setAgente(null); toast.error('No se encontró el agente', e?.message); }
  };

  // Mientras no se toquen a mano, los días siguen al período (corridos).
  const setFecha = (k: 'fecha_desde' | 'fecha_hasta', v: string) => setF(p => {
    const n = { ...p, [k]: v };
    if (!diasManual) { const c = diasCorridos(n.fecha_desde, n.fecha_hasta); n.dias = c ? String(c) : ''; }
    return n;
  });

  const guardar = async () => {
    if (!editar && !agente) return toast.error('Buscá primero el agente por DNI');
    if (!f.fecha_desde || !f.fecha_hasta) return toast.error('Completá desde y hasta');
    if (f.fecha_hasta < f.fecha_desde) return toast.error('La fecha hasta no puede ser anterior a la fecha desde');
    if (!(Number(f.dias) > 0)) return toast.error('Indicá los días');
    const body = {
      fecha_desde: f.fecha_desde, fecha_hasta: f.fecha_hasta, dias: Number(f.dias),
      anio_imputado: Number(f.anio_imputado), observaciones: f.observaciones.trim() || null,
    };
    setSaving(true);
    try {
      const res = editar
        ? await apiFetch<any>(`/vacaciones-adelantadas/${editar.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await apiFetch<any>('/vacaciones-adelantadas', { method: 'POST', body: JSON.stringify({ dni: Number(dni), ...body }) });
      if (!res?.ok) throw new Error(res?.error || 'No se pudo guardar');
      toast.ok(editar ? '✅ Cambios guardados' : '✅ Vacaciones adelantadas cargadas');
      onDone();
    } catch (e: any) { toast.error('Error al guardar', e?.message); } finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div className="card" style={{ maxWidth: 540, width: '100%', padding: '1.25rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <strong>{editar ? '✏️ Editar vacaciones adelantadas' : '➕ Cargar vacaciones adelantadas'}</strong>
          <button className="btn" type="button" onClick={onClose}>✕</button>
        </div>
        {editar ? (
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 12 }}>
            {editar.apellido}, {editar.nombre} · DNI {editar.dni} · {editar.servicio ?? 'sin servicio'}
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>DNI del agente *</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" style={{ ...fld, flex: 1 }} value={dni} autoFocus
                onChange={e => { setDni(e.target.value.replace(/\D/g, '')); setAgente(null); }}
                onKeyDown={e => { if (e.key === 'Enter') buscarAgente(); }} />
              <button className="btn" type="button" onClick={buscarAgente}>🔎 Buscar</button>
            </div>
            {agente && <div style={{ fontSize: '0.8rem', color: '#4ade80', marginTop: 4 }}>✔ {agente}</div>}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Desde *</label>
            <input type="date" className="input" style={fld} value={f.fecha_desde} onChange={e => setFecha('fecha_desde', e.target.value)} /></div>
          <div><label style={lbl}>Hasta *</label>
            <input type="date" className="input" style={fld} value={f.fecha_hasta} onChange={e => setFecha('fecha_hasta', e.target.value)} /></div>
          <div><label style={lbl}>Días * {!diasManual && <span style={{ color: '#64748b' }}>(corridos)</span>}</label>
            <input type="number" min={1} className="input" style={fld} value={f.dias}
              onChange={e => { setDiasManual(true); setF(p => ({ ...p, dias: e.target.value })); }} /></div>
          <div><label style={lbl}>Año imputado *</label>
            <input type="number" min={2000} max={2100} className="input" style={fld} value={f.anio_imputado}
              onChange={e => setF(p => ({ ...p, anio_imputado: e.target.value }))} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Observaciones</label>
            <textarea className="input" rows={2} style={{ ...fld, resize: 'vertical' }} value={f.observaciones}
              onChange={e => setF(p => ({ ...p, observaciones: e.target.value }))} /></div>
        </div>
        {!editar && (
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 8 }}>
            Se guarda con el servicio y la dependencia que tiene hoy el agente.
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" type="button" onClick={onClose}>Cancelar</button>
          <button className="btn" type="button" disabled={saving} onClick={guardar} style={btnAzul}>{saving ? '⏳…' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export function VacacionesAdelantadasPage() {
  const toast = useToast();
  const [rows, setRows] = useState<VacAdel[]>([]);
  const [loading, setLoading] = useState(false);
  const [servicios, setServicios] = useState<Opcion[]>([]);
  const [dependencias, setDependencias] = useState<Opcion[]>([]);
  const [filtros, setFiltros] = useState({ q: '', servicio_id: '', dependencia_id: '', anio: '', desde: '', hasta: '', borradas: false });
  const [modal, setModal] = useState<{ editar: VacAdel | null } | null>(null);

  useEffect(() => {
    apiFetch<any>('/servicios?limit=2000').then(r => setServicios(aOpciones(r))).catch(() => toast.error('No se pudieron cargar los servicios'));
    apiFetch<any>('/dependencias?limit=500').then(r => setDependencias(aOpciones(r))).catch(() => toast.error('No se pudieron cargar las dependencias'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const buscar = useCallback(async () => {
    const p = new URLSearchParams();
    if (filtros.q.trim()) p.set('q', filtros.q.trim());
    if (filtros.servicio_id) p.set('servicio_id', filtros.servicio_id);
    if (filtros.dependencia_id) p.set('dependencia_id', filtros.dependencia_id);
    if (filtros.anio) p.set('anio', filtros.anio);
    if (filtros.desde) p.set('desde', filtros.desde);
    if (filtros.hasta) p.set('hasta', filtros.hasta);
    if (filtros.borradas) p.set('borradas', '1');
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/vacaciones-adelantadas?${p.toString()}`);
      setRows(Array.isArray(res?.data) ? res.data : []);
    } catch (e: any) {
      toast.error('No se pudieron cargar las vacaciones adelantadas', e?.message);
    } finally { setLoading(false); }
  }, [filtros, toast]);
  useEffect(() => { buscar(); }, [filtros.servicio_id, filtros.dependencia_id, filtros.anio, filtros.borradas]); // eslint-disable-line react-hooks/exhaustive-deps

  const borrar = async (r: VacAdel) => {
    if (!window.confirm(`¿Borrar el adelanto de ${r.apellido}, ${r.nombre} (${fmtFecha(r.fecha_desde)} al ${fmtFecha(r.fecha_hasta)})?`)) return;
    try {
      const res = await apiFetch<any>(`/vacaciones-adelantadas/${r.id}`, { method: 'DELETE' });
      if (!res?.ok) throw new Error(res?.error || 'No se pudo borrar');
      toast.ok('🗑️ Registro borrado');
      buscar();
    } catch (e: any) { toast.error('Error al borrar', e?.message); }
  };

  const totalDias = useMemo(() => rows.filter(r => !r.deleted_at).reduce((a, r) => a + Number(r.dias || 0), 0), [rows]);
  const agentes = useMemo(() => new Set(rows.filter(r => !r.deleted_at).map(r => r.dni)).size, [rows]);

  const exportar = () => exportToExcel(`vacaciones_adelantadas_${new Date().toISOString().slice(0, 10)}`, rows.map(r => ({
    DNI: r.dni, Apellido: r.apellido, Nombre: r.nombre, Desde: fmtFecha(r.fecha_desde), Hasta: fmtFecha(r.fecha_hasta),
    Días: r.dias, 'Año imputado': r.anio_imputado, Servicio: r.servicio ?? '', Dependencia: r.dependencia ?? '',
    Observaciones: r.observaciones ?? '', 'Cargó': r.creado_por ?? '', 'Cargado el': r.created_at ?? '',
    'Editó': r.editado_por ?? '', 'Editado el': r.updated_at ?? '', 'Borró': r.borrado_por ?? '', 'Borrado el': r.deleted_at ?? '',
  })));

  const setFil = (k: keyof typeof filtros, v: any) => setFiltros(p => ({ ...p, [k]: v }));

  return (
    <Layout title="Vacaciones adelantadas">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card" style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>🏖️ Vacaciones adelantadas</div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Período adelantado, días y año al que se imputa. Queda registrado quién cargó, editó o borró cada uno.
            </div>
          </div>
          <button className="btn" type="button" onClick={() => setModal({ editar: null })} style={btnAzul}>➕ Cargar adelanto</button>
        </div>

        <div className="card" style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
            <div><label style={lbl}>Agente o DNI</label>
              <input className="input" style={fld} placeholder="Apellido, nombre o DNI" value={filtros.q}
                onChange={e => setFil('q', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') buscar(); }} /></div>
            <div><label style={lbl}>Servicio</label>
              <select className="input" style={fld} value={filtros.servicio_id} onChange={e => setFil('servicio_id', e.target.value)}>
                <option value="">Todos</option>{servicios.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select></div>
            <div><label style={lbl}>Dependencia</label>
              <select className="input" style={fld} value={filtros.dependencia_id} onChange={e => setFil('dependencia_id', e.target.value)}>
                <option value="">Todas</option>{dependencias.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select></div>
            <div><label style={lbl}>Año imputado</label>
              <input type="number" className="input" style={fld} placeholder="Todos" value={filtros.anio}
                onChange={e => setFil('anio', e.target.value)} /></div>
            <div><label style={lbl}>Período desde</label>
              <input type="date" className="input" style={fld} value={filtros.desde} onChange={e => setFil('desde', e.target.value)} /></div>
            <div><label style={lbl}>Período hasta</label>
              <input type="date" className="input" style={fld} value={filtros.hasta} onChange={e => setFil('hasta', e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn" type="button" onClick={buscar} style={btnAzul}>{loading ? '⏳' : '🔎'} Buscar</button>
            <label style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <input type="checkbox" checked={filtros.borradas} onChange={e => setFil('borradas', e.target.checked)} /> Ver borradas
            </label>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{rows.length} registro(s) · {agentes} agente(s) · {totalDias} día(s)</span>
            <button className="btn" type="button" onClick={exportar} disabled={!rows.length}>⬇ Excel</button>
          </div>
        </div>

        <div className="card" style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead><tr>
                <th style={th}>Agente</th><th style={th}>Desde</th><th style={th}>Hasta</th><th style={th}>Días</th>
                <th style={th}>Año</th><th style={th}>Servicio / Dependencia</th><th style={th}>Observaciones</th>
                <th style={th}>Registro</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={r.deleted_at ? { opacity: 0.55 } : undefined}>
                    <td style={td}><b>{r.apellido}, {r.nombre}</b><div style={{ color: '#64748b', fontSize: '0.72rem' }}>DNI {r.dni}</div></td>
                    <td style={td}>{fmtFecha(r.fecha_desde)}</td>
                    <td style={td}>{fmtFecha(r.fecha_hasta)}</td>
                    <td style={td}>{r.dias}</td>
                    <td style={td}>{r.anio_imputado}</td>
                    <td style={{ ...td, fontSize: '0.74rem' }}>
                      <div>{r.servicio ?? '—'}</div><div style={{ color: '#64748b' }}>{r.dependencia ?? ''}</div>
                    </td>
                    <td style={{ ...td, fontSize: '0.74rem', maxWidth: 220, whiteSpace: 'pre-wrap' }}>{r.observaciones ?? ''}</td>
                    <td style={{ ...td, fontSize: '0.7rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      <div>Cargó: {r.creado_por ?? '—'} · {r.created_at ?? ''}</div>
                      {r.editado_por && r.updated_at !== r.created_at && <div>Editó: {r.editado_por} · {r.updated_at}</div>}
                      {r.deleted_at && <div style={{ color: '#e66767' }}>Borró: {r.borrado_por ?? '—'} · {r.deleted_at}</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {!r.deleted_at && (<>
                        <button className="btn" type="button" title="Editar" onClick={() => setModal({ editar: r })}
                          style={{ fontSize: '0.72rem', padding: '2px 8px' }}>✏️</button>{' '}
                        <button className="btn" type="button" title="Borrar" onClick={() => borrar(r)}
                          style={{ fontSize: '0.72rem', padding: '2px 8px' }}>🗑️</button>
                      </>)}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#64748b', padding: 20 }}>
                    {loading ? 'Cargando…' : 'No hay vacaciones adelantadas para esta búsqueda'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modal && (
        <VacAdelModal editar={modal.editar} onClose={() => setModal(null)}
          onDone={() => { setModal(null); buscar(); }} />
      )}
    </Layout>
  );
}

export default VacacionesAdelantadasPage;

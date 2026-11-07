// src/pages/CargaHorariaLeyPage/index.tsx
// Herramientas → Carga horaria por ley (mig 114/115). Horas semanales que salen en los
// certificados (Certificado de Trabajo y Cert. Base Vieja):
//   ocupación insalubre → horas insalubre · servicio de agotamiento prematuro → horas agotamiento
//   · si no, horas base de la ley · ley sin nada cargado → régimen horario del agente.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type Ley = {
  id: number; nombre: string;
  horas_base: number | null; horas_insalubre: number | null; horas_agotamiento: number | null;
  observaciones: string | null; updated_at: string | null; editado_por: string | null;
  activos: number; insalubres: number; agotamiento: number; horas: Record<string, number>;
};
type Ocupacion = { id: number; nombre: string; insalubre_jubilacion: number; insalubre_horas: number; activos: number };
type ServAgot = { servicio_id: number; nombre: string; agentes: number; created_at: string | null; creado_por: string | null };
type SectorInsal = { sector_id: number; nombre: string; servicio: string | null; agentes: number; created_at: string | null; creado_por: string | null };
type Opcion = { id: string; nombre: string };

const card: React.CSSProperties = { padding: '14px 16px' };
const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 8px', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'middle' };
const inpHs: React.CSSProperties = { width: 64, fontSize: '0.84rem', textAlign: 'center' };
const btnAzul: React.CSSProperties = { background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' };

type Edit = { horas_base: string; horas_insalubre: string; horas_agotamiento: string; observaciones: string };
const aEdit = (l: Ley): Edit => ({
  horas_base: l.horas_base != null ? String(l.horas_base) : '',
  horas_insalubre: l.horas_insalubre != null ? String(l.horas_insalubre) : '',
  horas_agotamiento: l.horas_agotamiento != null ? String(l.horas_agotamiento) : '',
  observaciones: l.observaciones ?? '',
});

export function CargaHorariaLeyPage() {
  const toast = useToast();
  const [leyes, setLeyes] = useState<Ley[]>([]);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [loading, setLoading] = useState(false);
  const [soloConActivos, setSoloConActivos] = useState(true);
  const [leyOcup, setLeyOcup] = useState<number | null>(null);
  const [ocupaciones, setOcupaciones] = useState<Ocupacion[]>([]);
  const [agot, setAgot] = useState<ServAgot[]>([]);
  const [servicios, setServicios] = useState<Opcion[]>([]);
  const [servSel, setServSel] = useState('');
  const [sectInsal, setSectInsal] = useState<SectorInsal[]>([]);
  const [sectores, setSectores] = useState<Opcion[]>([]);
  const [sectSel, setSectSel] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2, r3] = await Promise.all([
        apiFetch<any>('/carga-horaria-ley'),
        apiFetch<any>('/carga-horaria-ley/agotamiento'),
        apiFetch<any>('/carga-horaria-ley/sectores'),
      ]);
      const ls: Ley[] = r1?.data ?? [];
      setLeyes(ls);
      setEdits(Object.fromEntries(ls.map(l => [l.id, aEdit(l)])));
      setAgot(r2?.data ?? []);
      setSectInsal(r3?.data ?? []);
    } catch (e: any) { toast.error('No se pudo cargar la configuración', e?.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    apiFetch<any>('/servicios?limit=2000').then(r => {
      const raw: any[] = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : []);
      setServicios(raw.filter(x => !Number(x.oculto)).map(x => ({ id: String(x.id), nombre: String(x.nombre) }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)));
    }).catch(() => toast.error('No se pudieron cargar los servicios'));
    apiFetch<any>('/sectores?limit=500').then(r => {
      const raw: any[] = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : []);
      setSectores(raw.map(x => ({ id: String(x.id), nombre: String(x.nombre) })).sort((a, b) => a.nombre.localeCompare(b.nombre)));
    }).catch(() => toast.error('No se pudieron cargar los sectores'));
  }, [toast]);

  const cargarOcupaciones = useCallback(async (leyId: number) => {
    try {
      const r = await apiFetch<any>(`/carga-horaria-ley/ocupaciones?ley_id=${leyId}`);
      setOcupaciones(r?.data ?? []);
    } catch (e: any) { toast.error('No se pudieron cargar las ocupaciones', e?.message); }
  }, [toast]);
  useEffect(() => { if (leyOcup) cargarOcupaciones(leyOcup); else setOcupaciones([]); }, [leyOcup, cargarOcupaciones]);

  const visibles = useMemo(() => leyes.filter(l => !soloConActivos || l.activos > 0 || l.horas_base || l.horas_insalubre || l.horas_agotamiento), [leyes, soloConActivos]);

  const setE = (id: number, k: keyof Edit, v: string) => setEdits(p => ({ ...p, [id]: { ...p[id], [k]: v } }));
  const cambiada = (l: Ley) => JSON.stringify(edits[l.id]) !== JSON.stringify(aEdit(l));

  const guardar = async (l: Ley) => {
    const e = edits[l.id];
    for (const k of ['horas_base', 'horas_insalubre', 'horas_agotamiento'] as const) {
      if (e[k] && !/^\d{1,2}$/.test(e[k])) return toast.error('Las horas tienen que ser un número entero');
    }
    try {
      await apiFetch(`/carga-horaria-ley/${l.id}`, { method: 'PUT', body: JSON.stringify(e) });
      toast.ok(`✅ ${l.nombre}: guardado`);
      cargar();
    } catch (err: any) { toast.error('Error al guardar', err?.message); }
  };

  const toggleOcup = async (o: Ocupacion) => {
    try {
      await apiFetch(`/carga-horaria-ley/ocupaciones/${o.id}`, { method: 'PUT', body: JSON.stringify({ insalubre: !Number(o.insalubre_horas) }) });
      if (leyOcup) cargarOcupaciones(leyOcup);
      cargar();
    } catch (err: any) { toast.error('Error al guardar la ocupación', err?.message); }
  };

  const agregarServ = async () => {
    if (!servSel) return toast.error('Elegí un servicio');
    try {
      await apiFetch('/carga-horaria-ley/agotamiento', { method: 'POST', body: JSON.stringify({ servicio_id: Number(servSel) }) });
      setServSel('');
      toast.ok('✅ Servicio agregado');
      cargar();
    } catch (err: any) { toast.error('Error al agregar el servicio', err?.message); }
  };
  const quitarServ = async (s: ServAgot) => {
    if (!window.confirm(`¿Quitar ${s.nombre} de agotamiento prematuro?`)) return;
    try {
      await apiFetch(`/carga-horaria-ley/agotamiento/${s.servicio_id}`, { method: 'DELETE' });
      cargar();
    } catch (err: any) { toast.error('Error al quitar el servicio', err?.message); }
  };

  const agregarSect = async () => {
    if (!sectSel) return toast.error('Elegí un sector');
    try {
      await apiFetch('/carga-horaria-ley/sectores', { method: 'POST', body: JSON.stringify({ sector_id: Number(sectSel) }) });
      setSectSel('');
      toast.ok('✅ Sector agregado');
      cargar();
    } catch (err: any) { toast.error('Error al agregar el sector', err?.message); }
  };
  const quitarSect = async (s: SectorInsal) => {
    if (!window.confirm(`¿Quitar ${s.nombre} de sectores insalubres?`)) return;
    try {
      await apiFetch(`/carga-horaria-ley/sectores/${s.sector_id}`, { method: 'DELETE' });
      cargar();
    } catch (err: any) { toast.error('Error al quitar el sector', err?.message); }
  };

  const nombreLeyOcup =leyes.find(l => l.id === leyOcup)?.nombre ?? '';

  return (
    <Layout title="Carga horaria por ley">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card" style={card}>
          <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>⏱️ Carga horaria por ley</div>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
            Horas semanales que salen en el Certificado de Trabajo y en el Cert. Base Vieja. Se elige en este orden:
            ocupación o sector insalubre → <b>Insalubre</b> · servicio de agotamiento prematuro → <b>Agotamiento</b> · si no → <b>Base</b>.
            Si la ley no tiene nada cargado se usa el régimen horario del agente.
          </div>
        </div>

        <div className="card" style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>Leyes</div>
            <label style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <input type="checkbox" checked={soloConActivos} onChange={e => setSoloConActivos(e.target.checked)} /> Solo con activos o configuradas
            </label>
            <span style={{ flex: 1 }} />
            {loading && <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>⏳ Cargando…</span>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead><tr>
                <th style={th}>Ley</th><th style={th}>Activos</th>
                <th style={th}>Base</th><th style={th}>Insalubre</th><th style={th}>Agotamiento</th>
                <th style={th}>Observaciones</th><th style={th}>Cómo salen hoy</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {visibles.map(l => {
                  const e = edits[l.id] ?? aEdit(l);
                  return (
                    <tr key={l.id}>
                      <td style={td}><b>{l.nombre}</b>
                        {l.editado_por && <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{l.editado_por} · {l.updated_at}</div>}</td>
                      <td style={td}>{l.activos}
                        {l.activos > 0 && <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{l.insalubres} insal. · {l.agotamiento} agot.</div>}</td>
                      <td style={td}><input className="input" style={inpHs} value={e.horas_base} placeholder="—" onChange={ev => setE(l.id, 'horas_base', ev.target.value)} /></td>
                      <td style={td}><input className="input" style={inpHs} value={e.horas_insalubre} placeholder="—" onChange={ev => setE(l.id, 'horas_insalubre', ev.target.value)} /></td>
                      <td style={td}><input className="input" style={inpHs} value={e.horas_agotamiento} placeholder="—" onChange={ev => setE(l.id, 'horas_agotamiento', ev.target.value)} /></td>
                      <td style={td}><input className="input" style={{ width: '100%', minWidth: 160, fontSize: '0.8rem' }} value={e.observaciones} onChange={ev => setE(l.id, 'observaciones', ev.target.value)} /></td>
                      <td style={{ ...td, fontSize: '0.74rem', color: '#cbd5e1' }}>
                        {Object.entries(l.horas).sort((a, b) => b[1] - a[1]).map(([k, n]) => <div key={k}>{k}: <b>{n}</b></div>)}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button className="btn" type="button" disabled={!cambiada(l)} onClick={() => guardar(l)} style={cambiada(l) ? btnAzul : undefined}>💾</button>{' '}
                        <button className="btn" type="button" disabled={!l.activos} onClick={() => setLeyOcup(leyOcup === l.id ? null : l.id)} title="Ocupaciones de la ley">👷</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {leyOcup && (
          <div className="card" style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>👷 Ocupaciones insalubres — {nombreLeyOcup}</div>
              <span style={{ flex: 1 }} />
              <button className="btn" type="button" onClick={() => setLeyOcup(null)}>✕</button>
            </div>
            <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: 8 }}>
              Tildá las ocupaciones que hacen horario reducido por insalubridad. Esta marca es solo para las horas:
              no cambia la insalubridad de jubilación (las que ya vienen marcadas desde jubilación cuentan igual).
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Insalubre (horas)</th><th style={th}>Ocupación</th><th style={th}>Activos</th><th style={th}>Jubilación</th></tr></thead>
                <tbody>
                  {ocupaciones.map(o => (
                    <tr key={o.id}>
                      <td style={td}><input type="checkbox" checked={!!Number(o.insalubre_horas) || !!Number(o.insalubre_jubilacion)}
                        disabled={!!Number(o.insalubre_jubilacion)} onChange={() => toggleOcup(o)} /></td>
                      <td style={td}>{o.nombre}</td>
                      <td style={td}>{o.activos}</td>
                      <td style={{ ...td, fontSize: '0.72rem', color: '#94a3b8' }}>{Number(o.insalubre_jubilacion) ? 'Insalubre neta' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card" style={card}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>☣️ Sectores insalubres</div>
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: 8 }}>
            Los agentes con sector vigente en estos sectores toman las horas de <b>Insalubre</b> de su ley.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select className="input" style={{ minWidth: 280, fontSize: '0.84rem' }} value={sectSel} onChange={e => setSectSel(e.target.value)}>
              <option value="">Elegí un sector…</option>
              {sectores.filter(s => !sectInsal.some(a => String(a.sector_id) === s.id)).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <button className="btn" type="button" onClick={agregarSect} style={btnAzul}>➕ Agregar</button>
          </div>
          {sectInsal.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Sector</th><th style={th}>Servicio</th><th style={th}>Agentes</th><th style={th}>Agregado</th><th style={th}></th></tr></thead>
              <tbody>
                {sectInsal.map(s => (
                  <tr key={s.sector_id}>
                    <td style={td}>{s.nombre}</td>
                    <td style={td}>{s.servicio ?? '—'}</td>
                    <td style={td}>{s.agentes}</td>
                    <td style={{ ...td, fontSize: '0.72rem', color: '#94a3b8' }}>{[s.creado_por, s.created_at].filter(Boolean).join(' · ')}</td>
                    <td style={td}><button className="btn" type="button" onClick={() => quitarSect(s)}>🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Todavía no hay sectores marcados.</div>}
        </div>

        <div className="card" style={card}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚡ Servicios de agotamiento prematuro</div>
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: 8 }}>
            Los agentes con servicio vigente en estos servicios toman las horas de <b>Agotamiento</b> de su ley.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select className="input" style={{ minWidth: 280, fontSize: '0.84rem' }} value={servSel} onChange={e => setServSel(e.target.value)}>
              <option value="">Elegí un servicio…</option>
              {servicios.filter(s => !agot.some(a => String(a.servicio_id) === s.id)).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <button className="btn" type="button" onClick={agregarServ} style={btnAzul}>➕ Agregar</button>
          </div>
          {agot.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Servicio</th><th style={th}>Agentes</th><th style={th}>Agregado</th><th style={th}></th></tr></thead>
              <tbody>
                {agot.map(s => (
                  <tr key={s.servicio_id}>
                    <td style={td}>{s.nombre}</td>
                    <td style={td}>{s.agentes}</td>
                    <td style={{ ...td, fontSize: '0.72rem', color: '#94a3b8' }}>{[s.creado_por, s.created_at].filter(Boolean).join(' · ')}</td>
                    <td style={td}><button className="btn" type="button" onClick={() => quitarServ(s)}>🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Todavía no hay servicios marcados.</div>}
        </div>
      </div>
    </Layout>
  );
}

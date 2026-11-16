// Salud Laboral → pestaña ⚖️ Juntas médicas (backend /juntas-medicas, mig 133).
// Cargar una junta hecha (agente, fecha, resultado, desde/hasta → días, observaciones), escanearla
// (abre Escaneo del agente con tipo "Dictamen Junta Médica" y al volver queda en esta pestaña),
// vincular el escaneo y verlo en PDF. Listado con filtros + Excel. Arriba: escaneos con "junta" en
// el nombre que todavía no se registraron (Registrar / No es junta).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';

export const RESULTADOS_JUNTA = ['APTO', 'TAREAS LIVIANAS', 'NO APTO', 'REUBICACIÓN', 'LICENCIA', 'OTRO'];
const COLOR_RES: Record<string, string> = {
  'APTO': 'rgba(34,197,94,0.22)', 'TAREAS LIVIANAS': 'rgba(14,165,233,0.22)', 'NO APTO': 'rgba(239,68,68,0.25)',
  'REUBICACIÓN': 'rgba(168,85,247,0.22)', 'LICENCIA': 'rgba(234,179,8,0.22)', 'OTRO': 'rgba(100,116,139,0.25)',
};

interface Junta {
  id: number; dni: string; agente_nombre: string | null; servicio: string | null; servicio_actual: string | null;
  fecha_junta: string | null; resultado: string | null; fecha_desde: string | null; fecha_hasta: string | null;
  cantidad_dias: number | null; observaciones: string | null; archivo_id: number | null; archivo_nombre: string | null;
  creado_por_email: string | null; creado_at: string; modificado_por_email: string | null; modificado_at: string | null;
}
interface Escaneo { id: number; nombre: string | null; tipo: string | null; fecha: string | null; created_at: string; descartado?: number | null }
interface SinRegistrar { archivo_id: number; dni: number; nombre: string | null; tipo: string | null; fecha: string | null; created_at: string; agente_nombre: string | null; servicio_actual: string | null }
interface Agente { dni: string; apellido: string; nombre: string; servicio?: string | null }

const VACIO = { fecha_junta: '', resultado: '', fecha_desde: '', fecha_hasta: '', observaciones: '', archivo_id: '', servicio: '' };

const d10 = (s?: string | null) => (s ? String(s).slice(0, 10) : '');
function fmt(s?: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
function hoyISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function calcDias(desde: string, hasta: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(desde), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hasta);
  if (!a || !b) return null;
  const d1 = Date.UTC(+a[1], +a[2] - 1, +a[3]), d2 = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  return d2 < d1 ? null : Math.round((d2 - d1) / 86_400_000) + 1;
}
/** desde + N (días: incluye el día desde; meses/años: mismo día, fin de mes si no existe). */
function sumar(desde: string, n: number, unit: 'dias' | 'meses' | 'anios'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(desde);
  if (!m || !(n > 0)) return '';
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = new Date(y, mo - 1, d);
  if (unit === 'dias') t.setDate(t.getDate() + n - 1);
  else {
    t.setMonth(t.getMonth() + (unit === 'anios' ? n * 12 : n));
    if (t.getDate() !== d) t.setDate(0);
  }
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
/** vigente / vencida / sin período, según desde-hasta. */
function estadoJunta(j: Junta): 'vigente' | 'vencida' | 'sin' {
  const h = d10(j.fecha_hasta), dd = d10(j.fecha_desde), hoy = hoyISO();
  if (h) return h >= hoy ? 'vigente' : 'vencida';
  return dd ? 'vigente' : 'sin';
}
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export async function abrirPdf(id: number, onError: (msg: string) => void) {
  try {
    const { blob } = await apiFetchBlobWithMeta(`/documents/${id}/file`);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e: any) { onError(e?.message || 'Error'); }
}

const lbl: React.CSSProperties = { fontSize: '0.78rem', display: 'block', marginBottom: 4, opacity: 0.8 };
const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: '0.75rem', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.15)' };
const td: React.CSSProperties = { padding: '6px 8px', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'top' };
const BTN_S: React.CSSProperties = { fontSize: '0.72rem', padding: '3px 8px' };

export function JuntasMedicasTab({ isAdmin, puedeCargar, puedeEditar, dniInicial }: {
  isAdmin: boolean; puedeCargar: boolean; puedeEditar: boolean; dniInicial?: string;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const errorPdf = useCallback((m: string) => toast.error('No se pudo abrir la junta', m), [toast]);

  // ── listado + sin registrar ──
  const [juntas, setJuntas] = useState<Junta[]>([]);
  const [sinReg, setSinReg] = useState<SinRegistrar[]>([]);
  const [cargando, setCargando] = useState(false);
  const [verSinReg, setVerSinReg] = useState(false);
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [a, b] = await Promise.all([apiFetch<any>('/juntas-medicas'), apiFetch<any>('/juntas-medicas/sin-registrar')]);
      setJuntas(a?.data || []); setSinReg(b?.data || []);
    } catch (e: any) { toast.error('Juntas médicas', e?.message); }
    finally { setCargando(false); }
  }, [toast]);
  useEffect(() => { void cargar(); }, [cargar]);

  // ── agente ──
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Agente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [agente, setAgente] = useState<Agente | null>(null);
  const [escaneos, setEscaneos] = useState<Escaneo[]>([]);

  const elegirPorDni = useCallback(async (dni: string, nombreFallback?: string | null) => {
    const clean = dni.replace(/\D/g, '');
    if (!clean) return;
    setBuscando(true);
    try {
      const r = await apiFetch<any>(`/personal/${clean}`);
      const p = r?.data;
      if (p) setAgente({ dni: clean, apellido: p.apellido || '', nombre: p.nombre || '', servicio: p.servicio_nombre || p.dependencia || null });
      else if (nombreFallback) {
        const [ape, nom] = nombreFallback.split(',').map(s => s.trim());
        setAgente({ dni: clean, apellido: ape || '', nombre: nom || '' });
      } else toast.error('No encontrado', `Sin agente con DNI ${clean}`);
    } catch (e: any) {
      if (nombreFallback) {
        const [ape, nom] = nombreFallback.split(',').map(s => s.trim());
        setAgente({ dni: clean, apellido: ape || '', nombre: nom || '' });
      } else toast.error('Error', e?.message);
    } finally { setBuscando(false); setMatches([]); setQ(''); }
  }, [toast]);

  useEffect(() => { if (dniInicial) void elegirPorDni(dniInicial); }, [dniInicial, elegirPorDni]);

  const buscar = async () => {
    const t = q.trim();
    if (!t) return;
    if (/^\d{6,9}$/.test(t.replace(/\D/g, '')) && /^[\d.\s]+$/.test(t)) { await elegirPorDni(t); return; }
    setBuscando(true);
    try {
      const r = await searchPersonal(t);
      setMatches(r.slice(0, 30).map((p: any) => ({ dni: String(p.dni), apellido: p.apellido || '', nombre: p.nombre || '' })));
      if (!r.length) toast.error('Sin resultados', `No se encontró "${t}"`);
    } catch (e: any) { toast.error('Error al buscar', e?.message); }
    finally { setBuscando(false); }
  };

  const cargarEscaneos = useCallback(async (dni: string) => {
    try { const r = await apiFetch<any>(`/juntas-medicas/por-dni/${dni}`); setEscaneos(r?.escaneos || []); }
    catch { setEscaneos([]); }
  }, []);
  // Al cambiar de agente el form se limpia, salvo que venga precargado (Editar / Registrar escaneo)
  const pendiente = useRef<{ form: typeof VACIO; editando: Junta | null } | null>(null);
  useEffect(() => {
    const p = pendiente.current; pendiente.current = null;
    setEditando(p?.editando ?? null);
    setForm(p?.form ?? { ...VACIO, servicio: agente?.servicio || '' });
    setDur({ n: '', unit: 'meses' });
    if (agente) void cargarEscaneos(agente.dni); else setEscaneos([]);
  }, [agente, cargarEscaneos]);

  // ── formulario ──
  const [form, setForm] = useState(VACIO);
  const [dur, setDur] = useState<{ n: string; unit: 'dias' | 'meses' | 'anios' }>({ n: '', unit: 'meses' });
  const [editando, setEditando] = useState<Junta | null>(null);
  const [guardando, setGuardando] = useState(false);
  const diasForm = calcDias(form.fecha_desde, form.fecha_hasta);

  const setDesde = (v: string) => setForm(f => ({ ...f, fecha_desde: v, fecha_hasta: dur.n && +dur.n > 0 ? sumar(v, +dur.n, dur.unit) : f.fecha_hasta }));
  const aplicarDur = (n: string, unit: 'dias' | 'meses' | 'anios') => {
    setDur({ n, unit });
    setForm(f => ({ ...f, fecha_hasta: f.fecha_desde && +n > 0 ? sumar(f.fecha_desde, +n, unit) : f.fecha_hasta }));
  };

  const partirNombre = (s: string | null) => { const [a, n] = String(s || '').split(',').map(x => x.trim()); return { apellido: a || '', nombre: n || '' }; };

  const editar = (j: Junta) => {
    pendiente.current = {
      editando: j,
      form: {
        fecha_junta: d10(j.fecha_junta), resultado: j.resultado || '', fecha_desde: d10(j.fecha_desde), fecha_hasta: d10(j.fecha_hasta),
        observaciones: j.observaciones || '', archivo_id: j.archivo_id ? String(j.archivo_id) : '', servicio: j.servicio || '',
      },
    };
    setAgente({ dni: String(j.dni), ...partirNombre(j.agente_nombre), servicio: j.servicio });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const registrarEscaneo = (s: SinRegistrar) => {
    pendiente.current = { editando: null, form: { ...VACIO, servicio: s.servicio_actual || '', archivo_id: String(s.archivo_id), fecha_junta: d10(s.fecha) } };
    setAgente({ dni: String(s.dni), ...partirNombre(s.agente_nombre), servicio: s.servicio_actual });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const descartar = async (archivoId: number) => {
    if (!window.confirm('¿Marcar este escaneo como "no es una junta médica"? Deja de aparecer como sin registrar (el archivo no se borra).')) return;
    try {
      await apiFetch('/juntas-medicas/descartar', { method: 'POST', body: JSON.stringify({ archivo_id: archivoId }) });
      toast.ok('Listo', 'Ya no aparece como junta sin registrar.');
      void cargar(); if (agente) void cargarEscaneos(agente.dni);
    } catch (e: any) { toast.error('Error', e?.message); }
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agente) { toast.error('Sin agente', 'Buscá y elegí el agente.'); return; }
    if (!form.fecha_junta && !form.archivo_id) { toast.error('Falta la fecha', 'Poné la fecha de la junta o vinculá el escaneo.'); return; }
    if (form.fecha_desde && form.fecha_hasta && diasForm == null) { toast.error('Fechas', 'La fecha hasta es anterior a la fecha desde.'); return; }
    setGuardando(true);
    try {
      const body = {
        dni: agente.dni, agente_nombre: `${agente.apellido}, ${agente.nombre}`, servicio: form.servicio || null,
        fecha_junta: form.fecha_junta || null, resultado: form.resultado || null,
        fecha_desde: form.fecha_desde || null, fecha_hasta: form.fecha_hasta || null,
        observaciones: form.observaciones || null, archivo_id: form.archivo_id ? Number(form.archivo_id) : null,
      };
      if (editando) await apiFetch(`/juntas-medicas/${editando.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await apiFetch('/juntas-medicas', { method: 'POST', body: JSON.stringify(body) });
      toast.ok(editando ? 'Junta actualizada' : 'Junta cargada', `${agente.apellido}, ${agente.nombre}`);
      setEditando(null); setForm({ ...VACIO, servicio: agente.servicio || '' }); setDur({ n: '', unit: 'meses' });
      void cargar(); void cargarEscaneos(agente.dni);
    } catch (err: any) { toast.error('No se guardó', err?.message); }
    finally { setGuardando(false); }
  };

  const borrar = async (j: Junta) => {
    if (!window.confirm(`¿Borrar la junta de ${j.agente_nombre || j.dni} del ${fmt(j.fecha_junta)}? (el escaneo no se borra)`)) return;
    try { await apiFetch(`/juntas-medicas/${j.id}`, { method: 'DELETE' }); toast.ok('Borrada', ''); void cargar(); }
    catch (e: any) { toast.error('Error', e?.message); }
  };

  const irAEscanear = () => {
    if (!agente) return;
    // Al volver (← atrás) queda en esta pestaña con el agente elegido
    navigate(`/app/salud-laboral?tab=juntas&dni=${agente.dni}`, { replace: true });
    navigate(`/app/escaneo-agente/${agente.dni}?tipo=dictamen_junta`);
  };

  // ── filtros ──
  const [fTexto, setFTexto] = useState('');
  const [fServicio, setFServicio] = useState('');
  const [fResultado, setFResultado] = useState('');
  const [fEstado, setFEstado] = useState<'' | 'vigente' | 'vencida' | 'sin' | 'sin_pdf'>('');
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [soloAgente, setSoloAgente] = useState(true);

  const servicios = useMemo(() => Array.from(new Set(juntas.map(j => j.servicio_actual || j.servicio || '').filter(Boolean))).sort(), [juntas]);
  const filtradas = useMemo(() => juntas.filter(j => {
    if (agente && soloAgente && String(j.dni) !== agente.dni) return false;
    if (fTexto) { const t = norm(fTexto); if (!norm(`${j.agente_nombre || ''} ${j.dni} ${j.observaciones || ''}`).includes(t)) return false; }
    if (fServicio && (j.servicio_actual || j.servicio || '') !== fServicio) return false;
    if (fResultado && (j.resultado || '') !== fResultado) return false;
    if (fEstado === 'sin_pdf') { if (j.archivo_id) return false; }
    else if (fEstado && estadoJunta(j) !== fEstado) return false;
    const fj = d10(j.fecha_junta);
    if (fDesde && (!fj || fj < fDesde)) return false;
    if (fHasta && (!fj || fj > fHasta)) return false;
    return true;
  }), [juntas, agente, soloAgente, fTexto, fServicio, fResultado, fEstado, fDesde, fHasta]);

  const exportar = () => exportToExcel('juntas_medicas', filtradas.map(j => ({
    DNI: j.dni, Agente: j.agente_nombre || '', 'Servicio actual': j.servicio_actual || j.servicio || '',
    'Fecha junta': fmt(j.fecha_junta), Resultado: j.resultado || '', Desde: fmt(j.fecha_desde), Hasta: fmt(j.fecha_hasta),
    'Días': j.cantidad_dias ?? '', Estado: { vigente: 'Vigente', vencida: 'Vencida', sin: 'Sin período' }[estadoJunta(j)],
    'Escaneo': j.archivo_id ? 'Sí' : 'No', Observaciones: j.observaciones || '', 'Cargó': j.creado_por_email || '',
  })));

  const nombreEsc = (e: Escaneo) => `${e.nombre || `Documento #${e.id}`} · ${fmt(e.fecha || e.created_at)}`;

  return (
    <>
      {/* ── Escaneos sin registrar ── */}
      {sinReg.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #eab308' }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600 }}>📎 {sinReg.length} escaneo(s) con "junta" en el nombre todavía sin registrar</div>
            <button className="btn" type="button" onClick={() => setVerSinReg(v => !v)}>{verSinReg ? 'Ocultar' : 'Ver'}</button>
          </div>
          {verSinReg && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Agente', 'DNI', 'Servicio', 'Archivo', 'Fecha', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {sinReg.map(s => (
                    <tr key={s.archivo_id}>
                      <td style={td}>{s.agente_nombre || '—'}</td>
                      <td style={td}>{s.dni}</td>
                      <td style={td}>{s.servicio_actual || <span className="muted">—</span>}</td>
                      <td style={td}>{s.nombre || `Documento #${s.archivo_id}`}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(s.fecha || s.created_at)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button className="btn" type="button" style={BTN_S} onClick={() => abrirPdf(s.archivo_id, errorPdf)}>📄 Ver</button>
                        {puedeCargar && <button className="btn ok" type="button" style={{ ...BTN_S, marginLeft: 4 }} onClick={() => registrarEscaneo(s)}>➕ Registrar</button>}
                        {puedeCargar && <button className="btn" type="button" style={{ ...BTN_S, marginLeft: 4 }} onClick={() => descartar(s.archivo_id)} title="No es un dictamen (solicitud, cédula, descargo…)">✕ No es junta</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Agente + formulario ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="h2" style={{ marginBottom: 8 }}>
          {editando ? '✏️ Editar junta médica' : '➕ Cargar junta médica hecha'}
        </div>
        {!agente ? (
          <>
            <label htmlFor="jm-buscar" style={lbl}>Agente (DNI o apellido)</label>
            <div className="row" style={{ gap: 6 }}>
              <input id="jm-buscar" className="input" style={{ flex: 1 }} value={q} placeholder="DNI o apellido y Enter"
                onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()} />
              <button className="btn" type="button" onClick={buscar}>{buscando ? '...' : 'Buscar'}</button>
            </div>
            {matches.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {matches.map(m => (
                  <button key={m.dni} className="btn" type="button" style={{ textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => elegirPorDni(m.dni, `${m.apellido}, ${m.nombre}`)}>
                    <strong>{m.apellido}, {m.nombre}</strong><span className="muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>DNI {m.dni}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '10px 14px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 10, marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{agente.apellido}, {agente.nombre}</div>
                <div className="muted" style={{ fontSize: '0.82rem' }}>DNI {agente.dni}{agente.servicio ? ` · ${agente.servicio}` : ''}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={irAEscanear}>📷 Escanear junta</button>
                <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={() => { setAgente(null); setEditando(null); }}>✕ Cambiar agente</button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Escaneos de junta del agente</div>
              {escaneos.length === 0 ? <div className="muted">No tiene escaneos de junta. Usá 📷 Escanear junta.</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {escaneos.map(e => (
                    <div key={e.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <button className="btn" type="button" style={BTN_S} onClick={() => abrirPdf(e.id, errorPdf)}>📄 Ver</button>
                      <span style={{ opacity: e.descartado ? 0.5 : 1 }}>{nombreEsc(e)}{e.descartado ? ' (marcado como no es junta)' : ''}</span>
                      {puedeCargar && !e.descartado && String(form.archivo_id) !== String(e.id) && (
                        <button className="btn" type="button" style={BTN_S} onClick={() => setForm(f => ({ ...f, archivo_id: String(e.id), fecha_junta: f.fecha_junta || d10(e.fecha) }))}>Vincular</button>
                      )}
                      {String(form.archivo_id) === String(e.id) && <span style={{ color: '#10b981', fontWeight: 600 }}>✓ vinculado</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {agente && (puedeCargar || (editando && puedeEditar)) && (
          <form onSubmit={guardar}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <div>
                <label htmlFor="jm-fecha" style={lbl}>Fecha de la junta *</label>
                <input id="jm-fecha" className="input" type="date" value={form.fecha_junta} onChange={e => setForm(f => ({ ...f, fecha_junta: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="jm-res" style={lbl}>Resultado</label>
                <select id="jm-res" className="input" value={form.resultado} onChange={e => setForm(f => ({ ...f, resultado: e.target.value }))}>
                  <option value="">— Resultado —</option>
                  {RESULTADOS_JUNTA.map(r => <option key={r} value={r}>{r}</option>)}
                  {form.resultado && !RESULTADOS_JUNTA.includes(form.resultado) && <option value={form.resultado}>{form.resultado}</option>}
                </select>
              </div>
              <div>
                <label htmlFor="jm-desde" style={lbl}>Desde</label>
                <input id="jm-desde" className="input" type="date" value={form.fecha_desde} onChange={e => setDesde(e.target.value)} />
              </div>
              <div>
                <label htmlFor="jm-dur" style={lbl}>Duración (completa “hasta”)</label>
                <div className="row" style={{ gap: 6 }}>
                  <input id="jm-dur" className="input" type="number" min={0} placeholder="N°" style={{ flex: '0 0 80px' }} value={dur.n} onChange={e => aplicarDur(e.target.value, dur.unit)} />
                  <select className="input" value={dur.unit} onChange={e => aplicarDur(dur.n, e.target.value as any)}>
                    <option value="dias">Días</option><option value="meses">Meses</option><option value="anios">Años</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="jm-hasta" style={lbl}>
                  Hasta {diasForm != null && <span style={{ marginLeft: 6, color: '#10b981', fontWeight: 700 }}>{diasForm} días</span>}
                </label>
                <input id="jm-hasta" className="input" type="date" value={form.fecha_hasta} min={form.fecha_desde || undefined} onChange={e => setForm(f => ({ ...f, fecha_hasta: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="jm-esc" style={lbl}>Escaneo de la junta</label>
                <select id="jm-esc" className="input" value={form.archivo_id} onChange={e => setForm(f => ({ ...f, archivo_id: e.target.value }))}>
                  <option value="">— Sin escaneo —</option>
                  {escaneos.map(e => <option key={e.id} value={e.id}>{nombreEsc(e)}</option>)}
                  {form.archivo_id && !escaneos.some(e => String(e.id) === String(form.archivo_id)) && <option value={form.archivo_id}>Documento #{form.archivo_id}</option>}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="jm-obs" style={lbl}>Observaciones</label>
                <input id="jm-obs" className="input" value={form.observaciones} placeholder="Lo que indicó la junta, tareas, restricciones…" onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} />
              </div>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn ok" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : editando ? 'Actualizar' : 'Guardar junta'}</button>
              {editando && <button className="btn" type="button" onClick={() => { setEditando(null); setForm({ ...VACIO, servicio: agente.servicio || '' }); }}>Cancelar</button>}
              {form.archivo_id && <button className="btn" type="button" onClick={() => abrirPdf(Number(form.archivo_id), errorPdf)}>📄 Ver escaneo vinculado</button>}
            </div>
          </form>
        )}
      </div>

      {/* ── Listado ── */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="h2">Juntas médicas hechas ({filtradas.length}{filtradas.length !== juntas.length ? ` de ${juntas.length}` : ''})</div>
          <div className="row" style={{ gap: 6 }}>
            {agente && (
              <label style={{ fontSize: '0.8rem', display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={soloAgente} onChange={e => setSoloAgente(e.target.checked)} /> Solo {agente.apellido}
              </label>
            )}
            <button className="btn" type="button" onClick={() => void cargar()} title="Recargar">🔄</button>
            <button className="btn" type="button" disabled={!filtradas.length} onClick={exportar}>📊 Excel</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
          <input className="input" placeholder="Buscar agente / DNI / obs." value={fTexto} onChange={e => setFTexto(e.target.value)} aria-label="Buscar" />
          <select className="input" value={fServicio} onChange={e => setFServicio(e.target.value)} aria-label="Servicio">
            <option value="">Todos los servicios</option>
            {servicios.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={fResultado} onChange={e => setFResultado(e.target.value)} aria-label="Resultado">
            <option value="">Todos los resultados</option>
            {RESULTADOS_JUNTA.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="input" value={fEstado} onChange={e => setFEstado(e.target.value as any)} aria-label="Estado">
            <option value="">Vigentes y vencidas</option>
            <option value="vigente">Solo vigentes</option>
            <option value="vencida">Solo vencidas</option>
            <option value="sin">Sin período</option>
            <option value="sin_pdf">Sin escaneo</option>
          </select>
          <input className="input" type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} title="Fecha de junta desde" aria-label="Fecha de junta desde" />
          <input className="input" type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} title="Fecha de junta hasta" aria-label="Fecha de junta hasta" />
        </div>

        {cargando ? <div className="muted">Cargando…</div> : filtradas.length === 0 ? (
          <div className="muted">{juntas.length ? 'Ninguna junta con esos filtros.' : 'Todavía no hay juntas cargadas.'}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Agente', 'DNI', 'Servicio', 'Junta', 'Resultado', 'Desde', 'Hasta', 'Días', 'Estado', 'PDF', 'Observaciones', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {filtradas.map(j => {
                  const est = estadoJunta(j);
                  return (
                    <tr key={j.id}>
                      <td style={{ ...td, minWidth: 160 }}>{j.agente_nombre || '—'}</td>
                      <td style={td}>{j.dni}</td>
                      <td style={td}>{j.servicio_actual || j.servicio || <span className="muted">—</span>}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(j.fecha_junta)}</td>
                      <td style={td}>{j.resultado ? <span className="badge" style={{ background: COLOR_RES[j.resultado] || COLOR_RES.OTRO }}>{j.resultado}</span> : <span className="muted">—</span>}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(j.fecha_desde)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(j.fecha_hasta)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{j.cantidad_dias != null ? <b style={{ color: '#10b981' }}>{j.cantidad_dias}</b> : '—'}</td>
                      <td style={td}>
                        {est === 'vigente' && <span className="badge" style={{ background: 'rgba(14,165,233,0.22)' }}>Vigente</span>}
                        {est === 'vencida' && <span className="badge" style={{ background: 'rgba(100,116,139,0.25)' }}>Vencida</span>}
                        {est === 'sin' && <span className="muted">—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {j.archivo_id
                          ? <button className="btn" type="button" style={BTN_S} title={j.archivo_nombre || 'Ver junta'} onClick={() => abrirPdf(j.archivo_id!, errorPdf)}>📄</button>
                          : <span className="muted" title="Sin escaneo vinculado">—</span>}
                      </td>
                      <td style={{ ...td, maxWidth: 220, whiteSpace: 'pre-wrap' }}>{j.observaciones || <span className="muted">—</span>}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {puedeEditar && <button className="btn" type="button" style={BTN_S} onClick={() => editar(j)} title="Editar">✏️</button>}
                        {isAdmin && <button className="btn" type="button" style={{ ...BTN_S, marginLeft: 4 }} onClick={() => borrar(j)} title="Borrar">🗑️</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

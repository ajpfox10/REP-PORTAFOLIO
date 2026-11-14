// /app/gestiones-personales-avisos — avisos por WhatsApp a los agentes que el robot
// "intranet_gp_confirmar" confirmó en Gestiones Personales (Intranet MS; clave provisoria = DNI).
// Pestañas: para avisar · escritos · enviados · con error · omitidos, + corridas del robot.
// "Dejar escritos" → la extensión abre el chat de cada uno (nombre agendado y, si no, celular de la
// base) y deja el mensaje ESCRITO sin enviar; la persona toca Enviar en WhatsApp y marca ✓ Enviado.
// La tarjeta de Herramientas del dashboard (DashboardPage/components/GpAvisosTile.tsx) trae hasta acá.
// Backend: /gp-avisos (mig 127; historial con usuario en mig 128 → pestaña 📜 Historial).
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { aExtension, celularPrueba } from '../LicenciasMedicasControlPage/WhatsappTab';

export interface GpAviso {
  id: number; dni: number; cuil: string; legajo: string | null; agente: string | null;
  confirmado_at: string; estado: 'PENDIENTE' | 'ESCRITO' | 'ENVIADO' | 'OMITIDO'; estado_at: string | null;
  telefono_usado: string | null; detalle: string | null;
  apellido: string | null; nombre: string | null; celular: string | null; dudoso: boolean;
}
interface Corrida { id: number; estado: string; motivo: string | null; duracion_seg: number | null; at: string }
type Tab = 'avisar' | 'escritos' | 'enviados' | 'error' | 'omitidos' | 'historial' | 'robot';
interface Mov {
  id: number; aviso_id: number; dni: number; agente: string | null; estado_anterior: string | null; estado: string;
  telefono: string | null; detalle: string | null; usuario_email: string | null; at: string;
}

// Desde la 1.8.0 la extensión deja el mensaje escrito sin enviar. Con una más vieja lo MANDARÍA: no se usa.
const EXT_MIN = '1.8.0';
const verMayorIgual = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return true;
};
const palabrasDe = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z]+/).filter(w => w.length > 1);
const tc = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fh = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11)}` : '');
const LS_PRUEBA = 'gp_avisos_prueba';

function nombreDe(a: GpAviso) {
  const [apeGp, nomGp] = String(a.agente || '').split(',').map(s => s.trim());
  return { apellido: a.apellido || apeGp || '', nombre: a.nombre || nomGp || '' };
}
function textoPara(plantilla: string, a: GpAviso) {
  const { apellido, nombre } = nombreDe(a);
  return plantilla
    .replace(/\{nombre\}/g, tc(nombre.split(/\s+/)[0] || ''))
    .replace(/\{apellido\}/g, tc(apellido))
    .replace(/\{dni\}/g, String(a.dni));
}

const BTN: CSSProperties = { padding: '4px 10px', fontSize: '0.78rem', whiteSpace: 'nowrap' };
const COLOR: Record<GpAviso['estado'], string> = { PENDIENTE: '#fbbf24', ESCRITO: '#60a5fa', ENVIADO: '#4ade80', OMITIDO: '#94a3b8' };
const INPUT: CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '4px 6px', fontSize: '0.8rem' };

export function GpAvisosPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('avisar');
  const [avisos, setAvisos] = useState<GpAviso[]>([]);
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [mensajeGuardado, setMensajeGuardado] = useState('');
  const [numeros, setNumeros] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState<number | 'TANDA' | null>(null);
  const [progreso, setProgreso] = useState('');
  const [cortando, setCortando] = useState(false);
  const [buscar, setBuscar] = useState('');
  const [prueba, setPrueba] = useState<{ activa: boolean; numero: string }>(() => {
    try { return JSON.parse(localStorage.getItem(LS_PRUEBA) || '') || { activa: true, numero: '' }; } catch { return { activa: true, numero: '' }; }
  });
  useEffect(() => { try { localStorage.setItem(LS_PRUEBA, JSON.stringify(prueba)); } catch { /* sin storage */ } }, [prueba]);

  const cargar = useCallback(async () => {
    try {
      const [r, rb] = await Promise.all([apiFetch<any>('/gp-avisos?todos=1'), apiFetch<any>('/gp-avisos/robot')]);
      if (r?.ok) {
        setAvisos(r.data || []);
        setMensajeGuardado(prev => { setMensaje(m => (m && m !== prev ? m : r.mensaje)); return r.mensaje; });
      }
      if (rb?.ok) setCorridas(rb.data || []);
    } catch (e: any) { toast.error('Avisos Gestiones Personales', e?.message); }
  }, [toast]);
  useEffect(() => { void cargar(); }, [cargar]);

  const grupos = useMemo(() => ({
    avisar: avisos.filter(a => a.estado === 'PENDIENTE'),
    escritos: avisos.filter(a => a.estado === 'ESCRITO'),
    enviados: avisos.filter(a => a.estado === 'ENVIADO'),
    error: avisos.filter(a => a.estado === 'PENDIENTE' && a.detalle),
    omitidos: avisos.filter(a => a.estado === 'OMITIDO'),
  }), [avisos]);
  const robotMal = corridas[0]?.estado === 'error';

  const marcar = async (ids: number[], estado: GpAviso['estado'], extra: { telefono?: string | null; detalle?: string | null } = {}) => {
    await apiFetch('/gp-avisos/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, estado, ...extra }) });
  };
  const guardarMensaje = async () => {
    try {
      await apiFetch('/gp-avisos/mensaje', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje }) });
      setMensajeGuardado(mensaje); toast.ok('Mensaje guardado', '');
    } catch (e: any) { toast.error('No se guardó el mensaje', e?.message); }
  };

  const extensionLista = async () => {
    const ping = await aExtension('PING', undefined, 1500).catch(() => ({ ok: false } as any));
    if (!ping.ok) { toast.warning('Falta la extensión de WhatsApp', 'Instalala desde Reportes → WhatsApp y tené WhatsApp Web abierto.'); return false; }
    if (!ping.version || !verMayorIgual(ping.version, EXT_MIN)) {
      toast.warning('Extensión vieja', `Tenés la ${ping.version || '?'}: con esa el mensaje se mandaría solo. Se actualiza sola en unas horas (o bajala de nuevo desde Reportes → WhatsApp).`);
      return false;
    }
    return true;
  };

  /** Deja escrito el mensaje de UN aviso. En prueba va a tu número y no cambia el estado. */
  const escribirUno = async (a: GpAviso): Promise<boolean> => {
    const texto = textoPara(mensaje, a);
    const enPrueba = prueba.activa;
    const tel = enPrueba ? celularPrueba(prueba.numero) : (numeros[a.id] ? celularPrueba(numeros[a.id]) : a.celular);
    if (!tel) {
      if (!enPrueba) await marcar([a.id], 'PENDIENTE', { detalle: 'Sin celular en la base' });
      return false;
    }
    const { apellido, nombre } = nombreDe(a);
    const ape = palabrasDe(apellido), nom = palabrasDe(nombre);
    const r = await aExtension('ENVIAR', enPrueba
      ? { modo: 'TELEFONO', telefono: tel, texto: `[PRUEBA] ${texto}`, sinEnviar: true }
      : { modo: numeros[a.id] ? 'TELEFONO' : 'NOMBRE_TELEFONO', buscar: ape[0] || '', palabras: [ape[0], nom[0]].filter(Boolean), telefono: tel, texto, sinEnviar: true },
    150000);
    if (enPrueba) return r.ok;
    if (r.ok) await marcar([a.id], 'ESCRITO', { telefono: r.modo === 'TELEFONO' ? tel : null, detalle: r.modo === 'NOMBRE' ? 'Chat encontrado por nombre' : null });
    else await marcar([a.id], 'PENDIENTE', { detalle: `${r.estado}: ${r.detalle || ''}`.slice(0, 300) });
    return r.ok;
  };

  const uno = async (a: GpAviso) => {
    if (prueba.activa && !celularPrueba(prueba.numero)) { toast.warning('Modo prueba', 'Poné tu número de prueba o destildá "Prueba".'); return; }
    if (!(await extensionLista())) return;
    setOcupado(a.id);
    try {
      const ok = await escribirUno(a);
      if (ok) toast.ok('Mensaje escrito en WhatsApp', prueba.activa ? 'Prueba: quedó escrito en tu chat, sin enviar.' : 'Revisalo en el chat y tocá Enviar.');
      else toast.warning('No se pudo dejar escrito', 'Mirá el detalle en la pestaña Con error.');
    } catch (e: any) { toast.error('WhatsApp', e?.message); }
    finally { setOcupado(null); void cargar(); }
  };

  const tanda = async () => {
    const lista = grupos.avisar;
    if (!lista.length) return;
    if (prueba.activa) { toast.warning('Modo prueba', 'La tanda es solo para el envío real: probá con ✍️ de una fila.'); return; }
    if (!window.confirm(`Se va a dejar el mensaje ESCRITO (sin enviar) en el chat de ${lista.length} agente(s). Después entrás a cada chat y tocás Enviar. ¿Seguir?`)) return;
    if (!(await extensionLista())) return;
    setOcupado('TANDA'); setCortando(false); (window as any).__gpCortar = false;
    let ok = 0, mal = 0;
    try {
      for (let i = 0; i < lista.length; i++) {
        if ((window as any).__gpCortar) break;
        setProgreso(`${i + 1}/${lista.length}: ${nombreDe(lista[i]).apellido}`);
        try { (await escribirUno(lista[i])) ? ok++ : mal++; } catch { mal++; }
        if (i < lista.length - 1) await sleep(3000 + Math.random() * 2000);
      }
      toast.ok('Tanda terminada', `${ok} escritos${mal ? `, ${mal} con error` : ''}. Ahora entrá a cada chat en WhatsApp y tocá Enviar.`);
    } finally { (window as any).__gpCortar = false; setOcupado(null); setProgreso(''); void cargar(); }
  };

  const marcarTodos = async (lista: GpAviso[], estado: GpAviso['estado'], pregunta: string) => {
    if (!lista.length || !window.confirm(pregunta)) return;
    await marcar(lista.map(a => a.id), estado); void cargar();
  };

  const q = buscar.trim().toUpperCase();
  const filas = (tab === 'robot' || tab === 'historial' ? [] : grupos[tab]).filter(a => !q || `${a.agente} ${a.apellido} ${a.nombre} ${a.dni}`.toUpperCase().includes(q));

  const TABS: [Tab, string, number | null][] = [
    ['avisar', '📲 Para avisar', grupos.avisar.length], ['escritos', '✍️ Escritos (falta Enviar)', grupos.escritos.length],
    ['enviados', '✅ Enviados', grupos.enviados.length], ['error', '⚠️ Con error', grupos.error.length],
    ['omitidos', '⊘ Omitidos', grupos.omitidos.length], ['historial', '📜 Historial', null], ['robot',robotMal ? '🤖❌ Robot' : '🤖 Robot', null],
  ];

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px' }}>📲 Avisos de Gestiones Personales</h2>
      <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 12 }}>
        El robot entra a la Intranet cada 30 min y confirma a los que se registraron en Gestiones Personales (quedan con su DNI como clave
        provisoria). Acá se les avisa por WhatsApp: la extensión deja el mensaje <b>escrito sin enviar</b> en el chat de cada uno; vos lo revisás y tocás Enviar.
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.82rem' }}>
          Mensaje (<code>{'{nombre}'}</code> = primer nombre, <code>{'{apellido}'}</code>, <code>{'{dni}'}</code>):
        </label>
        <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={3} style={{ ...INPUT, width: '100%', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="btn" style={BTN} disabled={mensaje === mensajeGuardado} onClick={guardarMensaje}>💾 Guardar mensaje</button>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.82rem' }}>
            <input type="checkbox" checked={prueba.activa} onChange={e => setPrueba(p => ({ ...p, activa: e.target.checked }))} /> Prueba (escribe en tu número, no cambia nada)
          </label>
          {prueba.activa && <input value={prueba.numero} onChange={e => setPrueba(p => ({ ...p, numero: e.target.value }))} placeholder="Tu celular" style={{ ...INPUT, width: 150 }} />}
          <span style={{ flex: 1 }} />
          {ocupado === 'TANDA'
            ? <><b>✍️ {progreso}</b><button type="button" className="btn" style={BTN} disabled={cortando} onClick={() => { (window as any).__gpCortar = true; setCortando(true); }}>⏹ Cortar</button></>
            : <button type="button" className="btn" style={{ ...BTN, fontWeight: 700 }} disabled={!!ocupado || prueba.activa || !grupos.avisar.length} onClick={tanda}
                title={prueba.activa ? 'Destildá Prueba para la tanda real' : ''}>✍️ Dejar escritos los {grupos.avisar.length} para avisar</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        {TABS.map(([k, t, n]) => (
          <button key={k} type="button" className={`btn${tab === k ? ' active' : ''}`} style={BTN} onClick={() => setTab(k)}>
            {t}{n != null ? ` (${n})` : ''}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {tab !== 'robot' && tab !== 'historial' && <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar apellido o DNI" style={{ ...INPUT, width: 200 }} />}
        <button type="button" className="btn" style={BTN} onClick={() => void cargar()}>↻ Actualizar</button>
      </div>

      {tab === 'escritos' && grupos.escritos.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <button type="button" className="btn" style={BTN} onClick={() => marcarTodos(grupos.escritos, 'ENVIADO', `¿Marcar los ${grupos.escritos.length} escritos como ENVIADOS? Hacelo solo si ya tocaste Enviar en cada chat.`)}>
            ✓ Ya envié todos los escritos
          </button>
        </div>
      )}

      {tab === 'historial' ? <HistorialTab /> : tab === 'robot' ? (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}><th style={{ padding: 8 }}>Cuándo</th><th>Resultado</th><th>Duró</th><th>Detalle</th></tr></thead>
            <tbody>
              {corridas.map(c => (
                <tr key={c.id} style={{ borderTop: '1px solid #1e293b' }}>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fh(c.at)}</td>
                  <td style={{ color: c.estado === 'ok' ? '#4ade80' : '#f87171', fontWeight: 700 }}>{c.estado === 'ok' ? 'OK' : 'ERROR'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.duracion_seg != null ? `${Math.round(c.duracion_seg)} s` : ''}</td>
                  <td style={{ overflowWrap: 'anywhere', padding: '6px 8px' }}>{c.motivo}</td>
                </tr>
              ))}
              {!corridas.length && <tr><td colSpan={4} style={{ padding: 12, color: '#94a3b8' }}>Todavía no hay corridas registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                <th style={{ padding: 8 }}>Agente</th><th>DNI</th><th>Confirmado</th><th>Celular</th><th>Estado</th><th>Detalle</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(a => {
                const { apellido, nombre } = nombreDe(a);
                const editable = a.estado === 'PENDIENTE' || a.estado === 'ESCRITO';
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid #1e293b' }}>
                    <td style={{ padding: 8 }}><b>{apellido}</b>{nombre ? `, ${nombre}` : ''}</td>
                    <td>{a.dni}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fh(a.confirmado_at)}</td>
                    <td>
                      {editable
                        ? <input value={numeros[a.id] ?? (a.celular || '')} onChange={e => setNumeros(n => ({ ...n, [a.id]: e.target.value }))} placeholder="sin celular"
                            title={a.dudoso ? 'Número dudoso en la base' : 'Celular de la base (si lo cambiás, se usa este solo para el aviso)'}
                            style={{ ...INPUT, width: 130, color: a.dudoso ? '#fbbf24' : '#e2e8f0' }} />
                        : (a.telefono_usado || a.celular || '—')}
                    </td>
                    <td style={{ color: COLOR[a.estado], fontWeight: 700, whiteSpace: 'nowrap' }}>{a.estado}{a.estado_at ? <div style={{ color: '#64748b', fontWeight: 400, fontSize: '0.7rem' }}>{fh(a.estado_at)}</div> : null}</td>
                    <td style={{ color: a.estado === 'PENDIENTE' && a.detalle ? '#fca5a5' : '#94a3b8', fontSize: '0.75rem', maxWidth: 280, overflowWrap: 'anywhere' }}>{a.detalle}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right', padding: '4px 8px' }}>
                      {editable && <button type="button" className="btn" style={BTN} disabled={!!ocupado} onClick={() => uno(a)}>
                        {ocupado === a.id ? '…' : a.estado === 'ESCRITO' ? '✍️ Reescribir' : '✍️ Escribir'}</button>}{' '}
                      {editable && <button type="button" className="btn" style={BTN} disabled={!!ocupado} onClick={async () => { await marcar([a.id], 'ENVIADO'); void cargar(); }}>✓ Enviado</button>}{' '}
                      {editable && <button type="button" className="btn" style={BTN} disabled={!!ocupado} onClick={async () => { if (window.confirm(`¿Omitir el aviso a ${apellido}?`)) { await marcar([a.id], 'OMITIDO'); void cargar(); } }}>⊘ Omitir</button>}
                      {!editable && <button type="button" className="btn" style={BTN} disabled={!!ocupado} onClick={async () => { await marcar([a.id], 'PENDIENTE'); void cargar(); }}>↩ Volver a avisar</button>}
                    </td>
                  </tr>
                );
              })}
              {!filas.length && <tr><td colSpan={7} style={{ padding: 12, color: '#94a3b8' }}>Nada en esta pestaña.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const COLOR_HIST: Record<string, string> = { ...COLOR, ERROR: '#f87171' };

/** Todos los movimientos (gp_avisos_historial): a quién, qué estado, a qué número y qué usuario lo hizo. */
function HistorialTab() {
  const toast = useToast();
  const hoy = new Date().toLocaleDateString('sv-SE');
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toLocaleDateString('sv-SE'); });
  const [hasta, setHasta] = useState(hoy);
  const [texto, setTexto] = useState('');
  const [rows, setRows] = useState<Mov[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const qs = new URLSearchParams({ desde, hasta, q: texto.trim() });
      const r = await apiFetch<any>(`/gp-avisos/historial?${qs}`);
      if (r?.ok) setRows(r.data || []);
    } catch (e: any) { toast.error('Historial', e?.message); }
    finally { setCargando(false); }
  }, [desde, hasta, texto, toast]);
  useEffect(() => { const t = setTimeout(() => void cargar(), 300); return () => clearTimeout(t); }, [cargar]);

  const cuenta = rows.reduce<Record<string, number>>((acc, m) => { acc[m.estado] = (acc[m.estado] || 0) + 1; return acc; }, {});
  const personasEnviadas = new Set(rows.filter(m => m.estado === 'ENVIADO').map(m => m.dni)).size;

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8, fontSize: '0.8rem' }}>
        Desde <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={INPUT} />
        hasta <input type="date" value={hasta} max={hoy} onChange={e => setHasta(e.target.value)} style={INPUT} />
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Apellido o DNI" style={{ ...INPUT, width: 180 }} />
        {cargando && <span style={{ color: '#94a3b8' }}>cargando…</span>}
        <span style={{ flex: 1 }} />
        <span style={{ color: '#94a3b8' }}>
          {rows.length} movimientos · <b style={{ color: COLOR.ENVIADO }}>{personasEnviadas} personas avisadas</b>
          {Object.entries(cuenta).map(([k, n]) => <span key={k} style={{ color: COLOR_HIST[k] || '#e2e8f0' }}> · {n} {k.toLowerCase()}</span>)}
        </span>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
              <th style={{ padding: 8 }}>Cuándo</th><th>Agente</th><th>DNI</th><th>Pasó a</th><th>Número</th><th>Detalle</th><th>Quién</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.id} style={{ borderTop: '1px solid #1e293b' }}>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fh(m.at)}</td>
                <td>{m.agente}</td>
                <td>{m.dni}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {m.estado_anterior && <span style={{ color: '#64748b' }}>{m.estado_anterior} → </span>}
                  <b style={{ color: COLOR_HIST[m.estado] || '#e2e8f0' }}>{m.estado}</b>
                </td>
                <td>{m.telefono || '—'}</td>
                <td style={{ color: '#94a3b8', fontSize: '0.75rem', maxWidth: 300, overflowWrap: 'anywhere' }}>{m.detalle}</td>
                <td style={{ whiteSpace: 'nowrap', paddingRight: 8 }}>{m.usuario_email ? m.usuario_email.split('@')[0] : <span style={{ color: '#64748b' }}>sistema</span>}</td>
              </tr>
            ))}
            {!rows.length && !cargando && <tr><td colSpan={7} style={{ padding: 12, color: '#94a3b8' }}>No hay movimientos en ese período.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

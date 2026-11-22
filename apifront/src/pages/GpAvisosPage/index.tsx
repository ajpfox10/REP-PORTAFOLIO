// /app/gestiones-personales-avisos — avisos por WhatsApp a los agentes que el robot
// "intranet_gp_confirmar" confirmó en Gestiones Personales (Intranet MS; clave provisoria = DNI).
// Pestañas: para avisar · escritos · enviados · con error · omitidos, + corridas del robot.
// "Dejar escritos" → la extensión abre el chat de cada uno (nombre agendado y, si no, celular de la
// base) y deja el mensaje ESCRITO sin enviar; la persona toca Enviar en WhatsApp y marca ✓ Enviado.
// La tarjeta de Herramientas del dashboard (DashboardPage/components/GpAvisosTile.tsx) trae hasta acá.
// Backend: /gp-avisos (mig 127; historial con usuario en mig 128 → pestaña 📜 Historial).
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../api/http';
import ReseteosTab from './ReseteosTab';
import { useToast } from '../../ui/toast';
import {
  ESPERA_ENVIO_MS, EXT_MIN, aExtensionGp as aExtension, avisarUno, celular549 as celularPrueba, idPcGp, nombreDe, textoPara, verMayorIgual,
} from './gpEnvio';

export interface GpAviso {
  id: number; dni: number; cuil: string; legajo: string | null; agente: string | null;
  confirmado_at: string; estado: 'PENDIENTE' | 'ESCRITO' | 'ENVIADO' | 'OMITIDO'; estado_at: string | null;
  telefono_usado: string | null; detalle: string | null;
  apellido: string | null; nombre: string | null; celular: string | null; dudoso: boolean;
}
interface Corrida { id: number; estado: string; motivo: string | null; duracion_seg: number | null; at: string }
type Tab = 'avisar' | 'escritos' | 'enviados' | 'error' | 'omitidos' | 'programados' | 'historial' | 'reseteos' | 'robot';
interface PcGp {
  id: string; nombre: string | null; etiqueta: string; ip: string | null; usuario_email: string | null;
  ext_version: string | null; ultima_senal: string; minutos: number; activa: boolean;
}
interface Programado {
  id: number; cuando: string; pc: string; pc_etiqueta: string; modo: 'ESCRIBIR' | 'ENVIAR'; estado: 'PROGRAMADO' | 'EN_CURSO' | 'HECHO' | 'CANCELADO' | 'ERROR';
  creado_por: string | null; creado_at: string; terminado_at: string | null; resultado: string | null; vencido: boolean; ids: number[]; agentes: string[];
}
type Modo = 'ESCRIBIR' | 'ENVIAR';
interface AutoCfg { activo: boolean; hora: string; pc: string; modo: Modo; solo_habiles: boolean; ultimo?: string | null }
const COLOR_PROG: Record<Programado['estado'], string> = { PROGRAMADO: '#fbbf24', EN_CURSO: '#60a5fa', HECHO: '#4ade80', CANCELADO: '#94a3b8', ERROR: '#f87171' };
const enUnaHora = () => { const d = new Date(Date.now() + 60 * 60 * 1000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
interface Mov {
  id: number; aviso_id: number; dni: number; agente: string | null; estado_anterior: string | null; estado: string;
  telefono: string | null; detalle: string | null; usuario_email: string | null; at: string;
}

// Desde la 1.8.0 (EXT_MIN) la extensión deja el mensaje escrito sin enviar. Con una más vieja lo MANDARÍA: no se usa.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fh = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11)}` : '');
const LS_PRUEBA = 'gp_avisos_prueba';

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
  // Elegidos (casillas), modo (dejar escrito / enviar solo) y programación
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [modo, setModo] = useState<Modo>('ESCRIBIR');
  const [pcs, setPcs] = useState<PcGp[]>([]);
  const [programados, setProgramados] = useState<Programado[]>([]);
  const [progCuando, setProgCuando] = useState(enUnaHora);
  const [progPc, setProgPc] = useState('');
  const miPc = useMemo(() => idPcGp(), []);
  // Envío automático diario: lo guardado (auto) y lo que se está editando (autoForm)
  const [auto, setAuto] = useState<AutoCfg | null>(null);
  const [autoForm, setAutoForm] = useState<AutoCfg | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [r, rb, rp, rg] = await Promise.all([
        apiFetch<any>('/gp-avisos?todos=1'), apiFetch<any>('/gp-avisos/robot'),
        apiFetch<any>('/gp-avisos/pcs').catch(() => null), apiFetch<any>('/gp-avisos/programados').catch(() => null),
      ]);
      if (r?.ok) {
        setAvisos(r.data || []);
        setMensajeGuardado(prev => { setMensaje(m => (m && m !== prev ? m : r.mensaje)); return r.mensaje; });
        if (r.auto) {
          setAuto(prev => {
            // si no se está editando nada, el formulario sigue a lo guardado
            setAutoForm(f => (!f || !prev || JSON.stringify({ ...f, ultimo: null }) === JSON.stringify({ ...prev, ultimo: null }) ? r.auto : f));
            return r.auto;
          });
        }
        // los elegidos que ya no están para avisar se sueltan
        const vivos = new Set((r.data || []).filter((a: GpAviso) => a.estado === 'PENDIENTE' || a.estado === 'ESCRITO').map((a: GpAviso) => a.id));
        setSel(s => new Set([...s].filter(id => vivos.has(id))));
      }
      if (rb?.ok) setCorridas(rb.data || []);
      if (rp?.ok) setPcs(rp.data || []);
      if (rg?.ok) setProgramados(rg.data || []);
    } catch (e: any) { toast.error('Avisos Gestiones Personales', e?.message); }
  }, [toast]);
  useEffect(() => { void cargar(); }, [cargar]);
  // Programados y PCs se refrescan solos cada 30 s (para ver cuándo arranca/termina)
  useEffect(() => {
    const t = setInterval(() => {
      void Promise.all([apiFetch<any>('/gp-avisos/pcs'), apiFetch<any>('/gp-avisos/programados')])
        .then(([rp, rg]) => { if (rp?.ok) setPcs(rp.data || []); if (rg?.ok) setProgramados(rg.data || []); }).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (!progPc && pcs.length) setProgPc(pcs.find(p => p.activa)?.id || pcs[0].id); }, [pcs, progPc]);

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

  /** Avisa UN aviso según el modo (dejar escrito / enviar solo). En prueba va a tu número y no cambia el estado. */
  const escribirUno = async (a: GpAviso): Promise<boolean> => {
    const enviar = modo === 'ENVIAR';
    if (prueba.activa) {
      const tel = celularPrueba(prueba.numero);
      if (!tel) return false;
      const r = await aExtension('ENVIAR', { modo: 'TELEFONO', telefono: tel, texto: `[PRUEBA] ${textoPara(mensaje, a)}`, sinEnviar: !enviar }, ESPERA_ENVIO_MS);
      return r.ok;
    }
    return avisarUno(a, mensaje, { enviar, telManual: numeros[a.id] || null });
  };

  // Los elegidos que siguen para avisar (PENDIENTE / ESCRITO), en el orden de la lista
  const elegidos = useMemo(() => avisos.filter(a => sel.has(a.id) && (a.estado === 'PENDIENTE' || a.estado === 'ESCRITO')), [avisos, sel]);
  const pcElegida = pcs.find(p => p.id === progPc);

  /** ya=true → "Enviar ahora en esa PC": se programa para este minuto y la PC lo toma en menos de 1 min. */
  const programar = async (ya = false) => {
    if (!elegidos.length) { toast.warning('Elegí a quién', 'Tildá en la lista los agentes a los que se les manda.'); return; }
    if (!progPc || !pcElegida) { toast.warning('Elegí la PC', 'Aparecen solas las PCs que tienen la app abierta con la extensión de WhatsApp.'); return; }
    const cuando = ya ? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : progCuando;
    if (!cuando) { toast.warning('Falta día y hora', ''); return; }
    const cuandoTxt = cuando.replace('T', ' ');
    const accion = modo === 'ENVIAR' ? 'ENVIAR SOLO (sin que nadie toque Enviar)' : 'dejar ESCRITO (alguien toca Enviar)';
    const cuandoDicho = ya ? 'AHORA (en menos de un minuto)' : `el ${cuandoTxt.slice(8, 10)}/${cuandoTxt.slice(5, 7)} a las ${cuandoTxt.slice(11)}`;
    const aviso = ya && !pcElegida.activa ? `\n\n⚠️ Esa PC no da señales desde ${fh(pcElegida.ultima_senal)}: va a salir cuando se abra.` : '';
    if (!window.confirm(`${ya ? 'Mandar' : 'Programar'} ${elegidos.length} aviso(s) ${cuandoDicho} desde la PC "${pcElegida.etiqueta}", modo ${accion}.${aviso}\n\nEsa PC tiene que estar prendida con la app y WhatsApp Web abiertos. ¿Seguir?`)) return;
    try {
      const telefonos: Record<number, string> = {};
      for (const a of elegidos) if (numeros[a.id]) telefonos[a.id] = numeros[a.id];
      const r = await apiFetch<any>('/gp-avisos/programados', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: elegidos.map(a => a.id), cuando, pc: progPc, modo, mensaje, telefonos }),
      });
      toast.ok(ya ? 'Mandado a la PC' : 'Programado',
        `${r?.programados ?? elegidos.length} aviso(s) en "${pcElegida.etiqueta}"${ya ? ': arranca en menos de un minuto' : ''}. Lo seguís en ⏰ Programados.`);
      setSel(new Set()); void cargar();
    } catch (e: any) { toast.error('No se pudo programar', e?.message); }
  };

  const cancelarProgramado = async (p: Programado) => {
    if (!window.confirm(`¿Cancelar el envío programado #${p.id} (${p.ids.length} aviso/s)?`)) return;
    try { await apiFetch(`/gp-avisos/programados/${p.id}/cancelar`, { method: 'POST' }); void cargar(); }
    catch (e: any) { toast.error('No se pudo cancelar', e?.message); }
  };

  const autoCambiado = !!auto && !!autoForm && JSON.stringify({ ...autoForm, ultimo: null }) !== JSON.stringify({ ...auto, ultimo: null });
  const guardarAuto = async () => {
    if (!autoForm) return;
    if (autoForm.activo && !autoForm.pc) { toast.warning('Elegí la PC', 'La PC que va a mandar el automático todos los días.'); return; }
    if (autoForm.activo && autoForm.modo === 'ENVIAR' && !auto?.activo
        && !window.confirm('El automático en modo ENVIAR SOLO manda los mensajes sin que nadie toque Enviar, todos los días. WhatsApp puede bloquear el número si detecta envíos automáticos. ¿Activarlo igual?')) return;
    try {
      await apiFetch('/gp-avisos/auto', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(autoForm) });
      setAuto(autoForm);
      toast.ok(autoForm.activo ? 'Automático diario activado' : 'Automático diario apagado',
        autoForm.activo ? `Todos los ${autoForm.solo_habiles ? 'días hábiles' : 'días'} a las ${autoForm.hora}. Usa el mensaje GUARDADO.` : '');
      void cargar();
    } catch (e: any) { toast.error('No se guardó el automático', e?.message); }
  };

  /** Ponerle nombre a la PC elegida (desde cualquier PC). Vacío = vuelve a mostrarse por IP · usuario. */
  const renombrarPc = async () => {
    if (!pcElegida) return;
    const v = window.prompt(`Nombre para la PC ${pcElegida.ip || ''}${pcElegida.usuario_email ? ` (${pcElegida.usuario_email.split('@')[0]})` : ''}:\n(vacío = mostrar por IP y usuario)`, pcElegida.nombre || '');
    if (v == null) return;
    try {
      await apiFetch(`/gp-avisos/pcs/${encodeURIComponent(pcElegida.id)}/nombre`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: v.trim() }) });
      void cargar();
    } catch (e: any) { toast.error('No se pudo poner el nombre', e?.message); }
  };
  const quitarPc = async () => {
    if (!pcElegida || !window.confirm(`¿Sacar "${pcElegida.etiqueta}" de la lista? Si sigue abierta con la extensión, vuelve a aparecer sola.`)) return;
    try { await apiFetch(`/gp-avisos/pcs/${encodeURIComponent(pcElegida.id)}`, { method: 'DELETE' }); setProgPc(''); void cargar(); }
    catch (e: any) { toast.error('No se pudo sacar', e?.message); }
  };

  const uno = async (a: GpAviso) => {
    if (prueba.activa && !celularPrueba(prueba.numero)) { toast.warning('Modo prueba', 'Poné tu número de prueba o destildá "Prueba".'); return; }
    if (!(await extensionLista())) return;
    setOcupado(a.id);
    try {
      const ok = await escribirUno(a);
      if (ok && modo === 'ENVIAR') toast.ok('Mensaje enviado por WhatsApp', prueba.activa ? 'Prueba: se envió a tu número.' : '');
      else if (ok) toast.ok('Mensaje escrito en WhatsApp', prueba.activa ? 'Prueba: quedó escrito en tu chat, sin enviar.' : 'Revisalo en el chat y tocá Enviar.');
      else toast.warning('No se pudo dejar escrito', 'Mirá el detalle en la pestaña Con error.');
    } catch (e: any) { toast.error('WhatsApp', e?.message); }
    finally { setOcupado(null); void cargar(); }
  };

  const tanda = async () => {
    const lista = elegidos.length ? elegidos : grupos.avisar;
    if (!lista.length) return;
    if (prueba.activa) { toast.warning('Modo prueba', 'La tanda es solo para el envío real: probá con ✍️ de una fila.'); return; }
    const pregunta = modo === 'ENVIAR'
      ? `Se va a ENVIAR el mensaje (solo, sin que toques Enviar) a ${lista.length} agente(s). ¿Seguir?`
      : `Se va a dejar el mensaje ESCRITO (sin enviar) en el chat de ${lista.length} agente(s). Después entrás a cada chat y tocás Enviar. ¿Seguir?`;
    if (!window.confirm(pregunta)) return;
    if (!(await extensionLista())) return;
    setOcupado('TANDA'); setCortando(false); (window as any).__gpCortar = false;
    let ok = 0, mal = 0;
    try {
      for (let i = 0; i < lista.length; i++) {
        if ((window as any).__gpCortar) break;
        setProgreso(`${i + 1}/${lista.length}: ${nombreDe(lista[i]).apellido}`);
        try { (await escribirUno(lista[i])) ? ok++ : mal++; } catch { mal++; }
        if (i < lista.length - 1) await sleep(modo === 'ENVIAR' ? 20000 + Math.random() * 20000 : 3000 + Math.random() * 2000);
      }
      toast.ok('Tanda terminada', modo === 'ENVIAR'
        ? `${ok} enviados${mal ? `, ${mal} con error` : ''}.`
        : `${ok} escritos${mal ? `, ${mal} con error` : ''}. Ahora entrá a cada chat en WhatsApp y tocá Enviar.`);
    } finally { (window as any).__gpCortar = false; setOcupado(null); setProgreso(''); setSel(new Set()); void cargar(); }
  };

  const marcarTodos = async (lista: GpAviso[], estado: GpAviso['estado'], pregunta: string) => {
    if (!lista.length || !window.confirm(pregunta)) return;
    await marcar(lista.map(a => a.id), estado); void cargar();
  };

  const q = buscar.trim().toUpperCase();
  const filas = (tab === 'robot' || tab === 'historial' || tab === 'reseteos' || tab === 'programados' ? [] : grupos[tab]).filter(a => !q || `${a.agente} ${a.apellido} ${a.nombre} ${a.dni}`.toUpperCase().includes(q));

  const TABS: [Tab, string, number | null][] = [
    ['avisar', '📲 Para avisar', grupos.avisar.length], ['escritos', '✍️ Escritos (falta Enviar)', grupos.escritos.length],
    ['enviados', '✅ Enviados', grupos.enviados.length], ['error', '⚠️ Con error', grupos.error.length],
    ['omitidos', '⊘ Omitidos', grupos.omitidos.length],
    ['programados', '⏰ Programados', programados.filter(p => p.estado === 'PROGRAMADO' || p.estado === 'EN_CURSO').length],
    ['historial', '📜 Historial', null], ['reseteos', '📊 Reseteos', null], ['robot',robotMal ? '🤖❌ Robot' : '🤖 Robot', null],
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
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.82rem', marginLeft: 8 }}>
            <b>Modo:</b>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="radio" checked={modo === 'ESCRIBIR'} onChange={() => setModo('ESCRIBIR')} /> ✍️ Dejar escrito
            </label>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: modo === 'ENVIAR' ? '#fca5a5' : undefined }}
              title="La extensión toca Enviar sola. WhatsApp puede bloquear el número si detecta envíos automáticos.">
              <input type="radio" checked={modo === 'ENVIAR'} onChange={() => setModo('ENVIAR')} /> 📤 Enviar solo
            </label>
          </span>
          <span style={{ flex: 1 }} />
          {ocupado === 'TANDA'
            ? <><b>{modo === 'ENVIAR' ? '📤' : '✍️'} {progreso}</b><button type="button" className="btn" style={BTN} disabled={cortando} onClick={() => { (window as any).__gpCortar = true; setCortando(true); }}>⏹ Cortar</button></>
            : (() => {
                const n = elegidos.length || grupos.avisar.length;
                const quien = elegidos.length ? `los ${n} elegidos` : `los ${n} para avisar`;
                return (
                  <button type="button" className="btn" style={{ ...BTN, fontWeight: 700 }} disabled={!!ocupado || prueba.activa || !n} onClick={tanda}
                    title={prueba.activa ? 'Destildá Prueba para la tanda real' : ''}>
                    {modo === 'ENVIAR' ? `📤 Enviar desde esta PC a ${quien}` : `✍️ Dejar escritos en esta PC ${quien}`}
                  </button>
                );
              })()}
        </div>
      </div>

      {/* Programar: a quién (casillas), cuándo, qué PC. Y el nombre de esta PC. */}
      <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.82rem' }}>
        <b>⏰ Programar</b>
        <span style={{ color: elegidos.length ? '#e2e8f0' : '#94a3b8' }}>
          {elegidos.length ? `${elegidos.length} elegido(s)` : 'tildá en la lista a quiénes'}
        </span>
        día y hora <input type="datetime-local" value={progCuando} onChange={e => setProgCuando(e.target.value)} style={INPUT} />
        en la PC
        <select value={progPc} onChange={e => setProgPc(e.target.value)} style={{ ...INPUT, minWidth: 220 }}>
          {!pcs.length && <option value="">(ninguna PC con la extensión abierta)</option>}
          {pcs.map(p => (
            <option key={p.id} value={p.id}>
              {p.activa ? '🟢' : '⚪'} {p.etiqueta}{p.nombre && p.ip ? ` (${p.ip})` : ''}{p.id === miPc ? ' · esta PC' : ''}
              {p.ext_version ? ` · ext ${p.ext_version}` : ''}{p.activa ? '' : ` · visto ${fh(p.ultima_senal)}`}
            </option>
          ))}
        </select>
        <button type="button" className="btn" style={BTN} disabled={!pcElegida} onClick={renombrarPc} title="Ponerle nombre a esta PC (se ve igual desde todas)">✏️</button>
        <button type="button" className="btn" style={BTN} disabled={!pcElegida} onClick={quitarPc} title="Sacarla de la lista">🗑</button>
        <button type="button" className="btn" style={{ ...BTN, fontWeight: 700 }} disabled={!elegidos.length || !progPc || prueba.activa} onClick={() => void programar(false)}
          title={prueba.activa ? 'Destildá Prueba: lo programado es siempre real' : ''}>
          ⏰ Programar ({modo === 'ENVIAR' ? 'enviar solo' : 'dejar escrito'})
        </button>
        <button type="button" className="btn" style={{ ...BTN, fontWeight: 700 }} disabled={!elegidos.length || !progPc || prueba.activa} onClick={() => void programar(true)}
          title={prueba.activa ? 'Destildá Prueba: lo que se manda a otra PC es siempre real' : 'Lo manda YA la PC elegida (no esta), sin poner hora'}>
          ▶ Enviar ahora en esa PC
        </button>
        {pcElegida && !pcElegida.activa && <span style={{ color: '#fbbf24' }}>⚠️ esa PC no da señales desde {fh(pcElegida.ultima_senal)}</span>}
        {pcElegida?.activa && (!pcElegida.ext_version || !verMayorIgual(pcElegida.ext_version, EXT_MIN)) && <span style={{ color: '#fbbf24' }}>⚠️ esa PC no tiene la extensión {EXT_MIN}+</span>}
        <div style={{ flexBasis: '100%', color: '#64748b', fontSize: '0.75rem' }}>
          Las PCs aparecen solas: cualquier PC con la app abierta y la extensión de WhatsApp se anota cada minuto (🟢 = conectada ahora).
          Para que mande lo programado tiene que estar prendida con la app y WhatsApp Web abiertos a esa hora.
        </div>
      </div>

      {/* Envío automático diario: todos los pendientes, sin elegir ni programar */}
      {autoForm && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.82rem',
          borderColor: auto?.activo ? 'rgba(74,222,128,0.5)' : undefined }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700 }}>
            <input type="checkbox" checked={autoForm.activo} onChange={e => setAutoForm(f => f && { ...f, activo: e.target.checked })} />
            🔁 Automático diario
          </label>
          <span style={{ color: '#94a3b8' }}>avisa a todos los "Para avisar" (sin error) todos los</span>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={autoForm.solo_habiles} onChange={e => setAutoForm(f => f && { ...f, solo_habiles: e.target.checked })} /> días hábiles
          </label>
          a las <input type="time" value={autoForm.hora} onChange={e => setAutoForm(f => f && { ...f, hora: e.target.value })} style={INPUT} />
          en
          <select value={autoForm.pc} onChange={e => setAutoForm(f => f && { ...f, pc: e.target.value })} style={{ ...INPUT, minWidth: 200 }}>
            <option value="">(elegí la PC)</option>
            {autoForm.pc && !pcs.some(p => p.id === autoForm.pc) && <option value={autoForm.pc}>⚠️ PC que ya no está en la lista</option>}
            {pcs.map(p => <option key={p.id} value={p.id}>{p.activa ? '🟢' : '⚪'} {p.etiqueta}{p.id === miPc ? ' · esta PC' : ''}</option>)}
          </select>
          <select value={autoForm.modo} onChange={e => setAutoForm(f => f && { ...f, modo: e.target.value as Modo })} style={INPUT}>
            <option value="ESCRIBIR">✍️ Dejar escrito</option>
            <option value="ENVIAR">📤 Enviar solo</option>
          </select>
          <button type="button" className="btn" style={{ ...BTN, fontWeight: 700 }} disabled={!autoCambiado} onClick={guardarAuto}>💾 Guardar</button>
          {auto?.activo && !autoCambiado && (
            <span style={{ color: '#4ade80' }}>
              Activo{auto.ultimo ? ` · última vez ${auto.ultimo.slice(8, 10)}/${auto.ultimo.slice(5, 7)}` : ''}
            </span>
          )}
          <div style={{ flexBasis: '100%', color: '#64748b', fontSize: '0.75rem' }}>
            Usa el mensaje <b>guardado</b> (💾 Guardar mensaje). Cada día arma un envío en ⏰ Programados con los pendientes de ese momento;
            los que se confirman después de la hora salen al día siguiente. Si la PC está apagada a esa hora, sale cuando se prenda ese mismo día.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        {TABS.map(([k, t, n]) => (
          <button key={k} type="button" className={`btn${tab === k ? ' active' : ''}`} style={BTN} onClick={() => setTab(k)}>
            {t}{n != null ? ` (${n})` : ''}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {tab !== 'robot' && tab !== 'historial' && tab !== 'reseteos' && tab !== 'programados' && <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar apellido o DNI" style={{ ...INPUT, width: 200 }} />}
        <button type="button" className="btn" style={BTN} onClick={() => void cargar()}>↻ Actualizar</button>
      </div>

      {tab === 'escritos' && grupos.escritos.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <button type="button" className="btn" style={BTN} onClick={() => marcarTodos(grupos.escritos, 'ENVIADO', `¿Marcar los ${grupos.escritos.length} escritos como ENVIADOS? Hacelo solo si ya tocaste Enviar en cada chat.`)}>
            ✓ Ya envié todos los escritos
          </button>
        </div>
      )}

      {tab === 'programados' ? (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}>
              <th style={{ padding: 8 }}>#</th><th>Cuándo</th><th>PC</th><th>Modo</th><th>A quiénes</th><th>Estado</th><th>Resultado</th><th>Programó</th><th></th>
            </tr></thead>
            <tbody>
              {programados.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid #1e293b', verticalAlign: 'top' }}>
                  <td style={{ padding: 8 }}>{p.id}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fh(p.cuando)}{p.estado === 'PROGRAMADO' && p.vencido ? <div style={{ color: '#fbbf24', fontSize: '0.7rem' }}>atrasado: esperando la PC</div> : null}</td>
                  <td>{p.pc_etiqueta}</td>
                  <td style={{ whiteSpace: 'nowrap', color: p.modo === 'ENVIAR' ? '#fca5a5' : '#93c5fd' }}>{p.modo === 'ENVIAR' ? '📤 Enviar solo' : '✍️ Dejar escrito'}</td>
                  <td style={{ maxWidth: 320 }}><b>{p.ids.length}</b>: <span style={{ color: '#94a3b8' }}>{p.agentes.join(' · ')}</span></td>
                  <td style={{ color: COLOR_PROG[p.estado], fontWeight: 700, whiteSpace: 'nowrap' }}>{p.estado.replace('_', ' ')}</td>
                  <td style={{ color: '#94a3b8', maxWidth: 260, overflowWrap: 'anywhere' }}>{p.resultado}{p.terminado_at ? <div style={{ fontSize: '0.7rem' }}>{fh(p.terminado_at)}</div> : null}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.creado_por ? p.creado_por.split('@')[0] : ''}<div style={{ color: '#64748b', fontSize: '0.7rem' }}>{fh(p.creado_at)}</div></td>
                  <td style={{ padding: '4px 8px' }}>{p.estado === 'PROGRAMADO' && <button type="button" className="btn" style={BTN} onClick={() => cancelarProgramado(p)}>✖ Cancelar</button>}</td>
                </tr>
              ))}
              {!programados.length && <tr><td colSpan={9} style={{ padding: 12, color: '#94a3b8' }}>No hay envíos programados. Tildá agentes en "Para avisar", elegí día, hora y PC, y tocá ⏰ Programar.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : tab === 'historial' ? <HistorialTab /> : tab === 'reseteos' ? <ReseteosTab /> : tab === 'robot' ? (
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
                <th style={{ padding: '8px 4px 8px 8px', width: 24 }}>
                  {(() => {
                    const marcables = filas.filter(a => a.estado === 'PENDIENTE' || a.estado === 'ESCRITO');
                    if (!marcables.length) return null;
                    const todas = marcables.every(a => sel.has(a.id));
                    return <input type="checkbox" checked={todas} title="Elegir todos los de esta pestaña"
                      onChange={() => setSel(s => { const n = new Set(s); marcables.forEach(a => (todas ? n.delete(a.id) : n.add(a.id))); return n; })} />;
                  })()}
                </th>
                <th style={{ padding: 8 }}>Agente</th><th>DNI</th><th>Confirmado</th><th>Celular</th><th>Estado</th><th>Detalle</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(a => {
                const { apellido, nombre } = nombreDe(a);
                const editable = a.estado === 'PENDIENTE' || a.estado === 'ESCRITO';
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid #1e293b', background: sel.has(a.id) ? 'rgba(124,58,237,0.12)' : undefined }}>
                    <td style={{ padding: '8px 4px 8px 8px' }}>
                      {editable && <input type="checkbox" checked={sel.has(a.id)}
                        onChange={() => setSel(s => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })} />}
                    </td>
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
              {!filas.length && <tr><td colSpan={8}style={{ padding: 12, color: '#94a3b8' }}>Nada en esta pestaña.</td></tr>}
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

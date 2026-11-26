// src/pages/AgendaTurnosPage/index.tsx
// Agenda de turnos (mig 122, /agenda-turnos). La oficina habilita a un agente → enlace único →
// se manda por WhatsApp → el agente elige día y horario desde el celular → el enlace queda usado.
// Pestañas: Turnos · Habilitar y enviar · Bloqueos · Configurar.
import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { MotivoTurnoSelect, MotivoValor, MOTIVO_VACIO, motivoBody, motivoCompleto } from '../../components/MotivoTurno';
import { ColaEnvios } from './ColaEnvios';

interface Franja { dia_semana: number; hora_desde: string; hora_hasta: string; duracion_min: number; cupo: number }
interface Agenda {
  id: number; nombre: string; descripcion: string | null; lugar: string | null;
  anticipacion_dias: number; ventana_dias: number; vence_dias: number; cancelar_horas: number;
  carga_jubilacion: number; mensaje_whatsapp: string | null; activa: number;
  turnos_desde?: string | null; turnos_desde_activo?: number;
  habilitados?: number; proximos?: number; para_reenviar?: number; retenidos?: number; franjas: Franja[];
}
interface Turno {
  id: number; dni: number; apellido: string; nombre: string; telefono: string | null; fecha: string; hora: string;
  estado: 'RESERVADO' | 'ATENDIDO' | 'AUSENTE' | 'CANCELADO'; origen: 'ENLACE' | 'INTERNO';
  telefono_contacto: string | null; observaciones: string | null; cancelado_por: string | null; jubilacion_cita_id: number | null;
  motivo: string | null;
}
interface Habilitacion {
  id: number; dni: number; apellido: string; nombre: string; telefono: string | null; celular: string | null; dudoso: boolean;
  token: string | null; estado: 'HABILITADO' | 'USADO' | 'VENCIDO' | 'ANULADO'; observacion: string | null; vence_el: string;
  created_at: string; turno_fecha: string | null; turno_hora: string | null; turno_estado: string | null; motivo: string | null;
  reenviar?: boolean; envios?: number; enviado_at?: string | null;
  turno_vigente?: string | null;   // 'dd/mm hh:mm' si ya tiene un turno reservado (cualquier enlace)
  enlace_nuevo_vence?: string | null;   // 'aaaa-mm-dd' si tiene OTRO enlace habilitado sin usar
}
interface EstadoTunel {
  estado: 'OK' | 'CAIDO' | 'SERVIDOR_CAIDO' | 'SIN_URL'; url: string; temporal: boolean; url_desde: string | null;
  local_ok: boolean; publico_ok: boolean | null; detalle: string; chequeado_at: string; caido_desde: string | null;
}
interface Bloqueo { id: number; agenda_id: number | null; agenda_nombre: string | null; fecha_desde: string; fecha_hasta: string; hora_desde: string | null; hora_hasta: string | null; motivo: string | null }
interface Horario { hora: string; cupo: number; ocupados: number; libres: number; bloqueado: boolean; google: string | null }
interface EventoG {
  id: number; origen: 'SISTEMA' | 'MANUAL'; turno_id: number | null; dni: number | null; titulo: string | null; descripcion: string | null;
  ubicacion: string | null; todo_el_dia: number; estado: string; creador: string | null; inicio: string; fin: string;
  apellido: string | null; nombre: string | null; choca: number;
}
interface Dia { fecha: string; dia: string; feriado: string | null; bloqueado: string | null; horarios: Horario[] }

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const sel: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b', color: 'inherit', fontSize: '0.82rem' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)' };
const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem', verticalAlign: 'top' };
const fmtHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fmt = (f?: string | null) => (f ? f.slice(0, 10).split('-').reverse().join('/') : '');
const hoy = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const masDias = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const COLOR_ESTADO: Record<string, string> = {
  RESERVADO: '#60a5fa', ATENDIDO: '#4ade80', AUSENTE: '#f87171', CANCELADO: '#94a3b8',
  HABILITADO: '#fbbf24', USADO: '#4ade80', VENCIDO: '#94a3b8', ANULADO: '#94a3b8',
};
const Badge = ({ e }: { e: string }) => (
  <span className="badge" style={{ background: 'rgba(255,255,255,0.06)', color: COLOR_ESTADO[e] || '#e2e8f0', border: `1px solid ${COLOR_ESTADO[e] || '#475569'}55` }}>{e}</span>
);

const json = (method: string, body?: any) => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

const AGENDA_VACIA: Agenda = {
  id: 0, nombre: '', descripcion: '', lugar: '', anticipacion_dias: 1, ventana_dias: 30, vence_dias: 15, cancelar_horas: 24,
  carga_jubilacion: 0, mensaje_whatsapp: '', activa: 1, franjas: [{ dia_semana: 1, hora_desde: '08:00', hora_hasta: '12:00', duracion_min: 20, cupo: 1 }],
};

type Tab = 'turnos' | 'habilitar' | 'bloqueos' | 'google' | 'config';
type Cfg = { url_publica: string; plantilla: string; plantillaDefault: string; motivos: string[] };

export function AgendaTurnosPage() {
  const toast = useToast();
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [agendaId, setAgendaId] = useState<number>(0);
  const [tab, setTab] = useState<Tab>('turnos');
  const [cfg, setCfg] = useState<Cfg>({ url_publica: '', plantilla: '', plantillaDefault: '', motivos: [] });
  const [tunel, setTunel] = useState<EstadoTunel | null>(null);
  const [probando, setProbando] = useState(false);
  const [filtroInicial, setFiltroInicial] = useState('HABILITADO');

  const agenda = agendas.find(a => a.id === agendaId) || null;

  const cargarAgendas = async (elegir?: number) => {
    try {
      const [r, c] = await Promise.all([apiFetch<any>('/agenda-turnos/agendas'), apiFetch<any>('/agenda-turnos/config')]);
      const lista: Agenda[] = r.data || [];
      setAgendas(lista);
      setCfg(c.data);
      const id = elegir ?? agendaId;
      if (lista.length && !lista.some(a => a.id === id)) setAgendaId(lista[0].id);
      else if (elegir) setAgendaId(elegir);
      if (!lista.length) setTab('config');
    } catch (e: any) { toast.error('Agenda de turnos', e?.message || 'No se pudo leer'); }
  };
  useEffect(() => { void cargarAgendas(); }, []);

  // ¿la página pública se ve desde internet? (el túnel rápido de Cloudflare se cae cada tanto)
  const probarTunel = async (forzar: boolean) => {
    if (forzar) setProbando(true);
    try {
      const r = await apiFetch<any>(`/agenda-turnos/tunel${forzar ? '?forzar=1' : ''}`);
      setTunel(prev => {
        // cambió la dirección (el túnel se reinició): se recarga para el conteo de reenvíos
        if (prev && r.data && prev.url !== r.data.url) void cargarAgendas();
        return r.data;
      });
    } catch { /* noop */ } finally { setProbando(false); }
  };
  useEffect(() => { void probarTunel(false); const t = setInterval(() => void probarTunel(false), 120_000); return () => clearInterval(t); }, []);

  // reinicia el túnel (pm2) y espera la dirección nueva
  const [relanzando, setRelanzando] = useState(false);
  const relanzarTunel = async () => {
    if (!window.confirm('Se va a relanzar el túnel: sale una DIRECCIÓN NUEVA y los enlaces sin usar mandados con la anterior hay que reenviarlos. ¿Seguir?')) return;
    setRelanzando(true);
    try {
      const r = await apiFetch<any>('/agenda-turnos/tunel/relanzar', json('POST'));
      setTunel(r.data);
      void cargarAgendas();
      if (r.data?.estado === 'OK') toast.ok('Túnel relanzado', `En línea con la dirección nueva. Reenviá los enlaces pendientes.`);
      else toast.error('Túnel relanzado', r.url_nueva ? 'Ya tiene dirección nueva pero todavía no se ve: probá de nuevo en un minuto.' : 'Todavía no dio dirección nueva: probá de nuevo en un minuto.');
    } catch (e: any) { toast.error('Relanzar túnel', e?.message || 'No se pudo relanzar'); }
    finally { setRelanzando(false); }
  };
  const irAReenviar = () => { setFiltroInicial('REENVIAR'); setTab('habilitar'); };
  const [verRetenidos, setVerRetenidos] = useState(0);
  const irARetenidos = () => { setTab('habilitar'); setVerRetenidos(v => v + 1); };
  // el contador del banner se actualiza solo (la PC que manda puede retener mientras la página está abierta)
  useEffect(() => { const t = setInterval(() => void cargarAgendas(), 60_000); return () => clearInterval(t); }, [agendaId]);

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" className="btn" onClick={() => { setTab(t); if (t !== 'habilitar') setFiltroInicial('HABILITADO'); }}
      style={{ background: tab === t ? '#2563eb' : undefined, color: tab === t ? '#fff' : undefined, fontWeight: tab === t ? 700 : 400 }}>{label}</button>
  );

  return (
    <Layout title="Agenda de turnos" showBack>
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem' }}>Agenda</label>
          <select value={agendaId} onChange={(e) => setAgendaId(Number(e.target.value))} style={{ ...sel, minWidth: 220 }}>
            {!agendas.length && <option value={0}>— sin agendas —</option>}
            {agendas.map(a => <option key={a.id} value={a.id}>{a.nombre}{a.activa ? '' : ' (desactivada)'}</option>)}
          </select>
          <button type="button" className="btn" onClick={() => { setAgendaId(0); setTab('config'); }}>➕ Nueva agenda</button>
          {agenda && <span className="muted" style={{ fontSize: '0.8rem' }}>{agenda.proximos ?? 0} turnos próximos · {agenda.habilitados ?? 0} enlaces sin usar</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {tabBtn('turnos', '📅 Turnos')}
          {tabBtn('habilitar', '🔗 Habilitar y enviar')}
          {tabBtn('bloqueos', '⛔ Bloqueos')}
          {tabBtn('google', '📅 Calendario Google')}
          {tabBtn('config', '⚙️ Configurar')}
        </div>
        <AvisoTunel tunel={tunel} probando={probando} onProbar={() => void probarTunel(true)} relanzando={relanzando} onRelanzar={() => void relanzarTunel()} />
        {agenda && !!agenda.para_reenviar && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.4)', fontSize: '0.85rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>🔁 <b>{agenda.para_reenviar}</b> enlace{agenda.para_reenviar === 1 ? '' : 's'} sin usar se mandaron con una dirección que ya no anda. Hay que reenviarlos con la dirección nueva (mismo enlace personal).</span>
            <button type="button" className="btn" onClick={irAReenviar}>Reenviar pendientes</button>
          </div>
        )}
        {agenda && !!agenda.retenidos && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(244,114,182,0.12)', border: '1px solid rgba(244,114,182,0.5)', fontSize: '0.85rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>📩 <b>{agenda.retenidos}</b> agente{agenda.retenidos === 1 ? '' : 's'} tenía{agenda.retenidos === 1 ? '' : 'n'} mensajes <b>sin leer</b> en WhatsApp: <b>no se le{agenda.retenidos === 1 ? '' : 's'} mandó</b> el enlace. Leé qué escribieron y decidí.</span>
            <button type="button" className="btn" onClick={irARetenidos} style={{ background: '#db2777', color: '#fff', fontWeight: 700 }}>Ver mensajes</button>
          </div>
        )}
        {!cfg.url_publica && (
          <div style={{ marginTop: 10, fontSize: '0.82rem', color: '#fbbf24' }}>
            Falta la dirección pública de la página de turnos (Configurar → Dirección pública). Sin eso los enlaces no se pueden armar.
          </div>
        )}
      </div>

      {tab === 'config' && <ConfigTab agenda={agendaId ? agenda : null} cfg={cfg} onGuardado={(id) => { void cargarAgendas(id); setTab('turnos'); }} onCfg={() => cargarAgendas()} />}
      {agenda && tab === 'turnos' && <TurnosTab agenda={agenda} motivos={cfg.motivos} onCambio={() => cargarAgendas()} />}
      {agenda && tab === 'habilitar' && <HabilitarTab key={`${agenda.id}-${filtroInicial}`} agenda={agenda} cfg={cfg} tunel={tunel} filtroInicial={filtroInicial} verRetenidos={verRetenidos} onCambio={() => cargarAgendas()} />}
      {agenda && tab === 'bloqueos' && <BloqueosTab agenda={agenda} />}
      {agenda && tab === 'google' && <GoogleTab agenda={agenda} />}
    </Layout>
  );
}

// ── Estado del túnel ────────────────────────────────────────────────────────
function AvisoTunel({ tunel, probando, onProbar, relanzando, onRelanzar }: { tunel: EstadoTunel | null; probando: boolean; onProbar: () => void; relanzando: boolean; onRelanzar: () => void }) {
  if (!tunel || tunel.estado === 'SIN_URL') return null;
  const ok = tunel.estado === 'OK';
  const color = ok ? '#4ade80' : '#f87171';
  return (
    <div style={{ marginTop: 10, padding: ok ? '4px 0' : '8px 12px', borderRadius: 8, fontSize: ok ? '0.78rem' : '0.85rem',
      background: ok ? undefined : 'rgba(248,113,113,0.1)', border: ok ? undefined : '1px solid rgba(248,113,113,0.45)',
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ color }}>{ok ? '🟢' : '🔴'} <b>{ok ? 'Página de turnos en línea' : tunel.estado === 'SERVIDOR_CAIDO' ? 'Servidor de turnos caído' : 'Túnel caído: los enlaces no abren'}</b></span>
      <span className="muted">{tunel.detalle}{!ok && tunel.caido_desde ? ` · desde ${fmtHora(tunel.caido_desde)}` : ''} · probado {fmtHora(tunel.chequeado_at)}</span>
      {!ok && tunel.estado === 'CAIDO' && tunel.temporal && (
        <span style={{ flexBasis: '100%', fontSize: '0.8rem' }}>
          El túnel rápido se reinicia solo en unos minutos y sale una <b>dirección nueva</b>. Cuando vuelva a estar en verde, reenviá los enlaces pendientes.
          Si sigue en rojo más de 15 minutos, avisá a sistemas.
        </span>
      )}
      {!ok && tunel.estado === 'SERVIDOR_CAIDO' && <span style={{ flexBasis: '100%', fontSize: '0.8rem' }}>El programa que atiende la página de turnos no está corriendo: avisá a sistemas.</span>}
      <button type="button" className="btn" disabled={probando} onClick={onProbar} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>{probando ? 'Probando…' : 'Probar ahora'}</button>
      {!ok && tunel.estado === 'CAIDO' && (
        <button type="button" className="btn" disabled={relanzando || probando} onClick={onRelanzar}
          style={{ fontSize: '0.75rem', padding: '2px 8px', background: '#dc2626', color: '#fff', fontWeight: 700 }}>
          {relanzando ? 'Relanzando… (hasta 1 min)' : '🚀 Relanzar túnel'}
        </button>
      )}
    </div>
  );
}

// ── Turnos ──────────────────────────────────────────────────────────────────

function TurnosTab({ agenda, motivos, onCambio }: { agenda: Agenda; motivos: string[]; onCambio: () => void }) {
  const toast = useToast();
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(masDias(hoy(), 13));
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [grilla, setGrilla] = useState<Dia[]>([]);
  const [verCancelados, setVerCancelados] = useState(false);
  const [manual, setManual] = useState<{ fecha: string; hora: string } | null>(null);
  const [dniManual, setDniManual] = useState('');
  const [motManual, setMotManual] = useState<MotivoValor>(MOTIVO_VACIO);

  const cargar = async () => {
    try {
      const [t, g] = await Promise.all([
        apiFetch<any>(`/agenda-turnos/turnos?agenda_id=${agenda.id}&desde=${desde}&hasta=${hasta}`),
        apiFetch<any>(`/agenda-turnos/agendas/${agenda.id}/grilla?desde=${desde}&hasta=${hasta}`),
      ]);
      setTurnos(t.data || []); setGrilla(g.data || []);
    } catch (e: any) { toast.error('Turnos', e?.message); }
  };
  useEffect(() => { void cargar(); }, [agenda.id, desde, hasta]);

  const estado = async (t: Turno, e: Turno['estado']) => {
    if (e === 'CANCELADO' && !window.confirm(`¿Cancelar el turno de ${t.apellido} ${t.nombre} (${fmt(t.fecha)} ${t.hora})? El horario queda libre.`)) return;
    try { await apiFetch(`/agenda-turnos/turnos/${t.id}`, json('PATCH', { estado: e })); await cargar(); onCambio(); }
    catch (err: any) { toast.error('Turno', err?.message); }
  };
  const cargarManual = async () => {
    if (!manual) return;
    try {
      await apiFetch('/agenda-turnos/turnos', json('POST', { agenda_id: agenda.id, dni: Number(dniManual.replace(/\D/g, '')), fecha: manual.fecha, hora: manual.hora, ...motivoBody(motManual) }));
      toast.ok('Turno cargado', `${fmt(manual.fecha)} ${manual.hora}`);
      setManual(null); setDniManual(''); setMotManual(MOTIVO_VACIO); await cargar(); onCambio();
    } catch (err: any) { toast.error('Turno', err?.message); }
  };

  const porDia = useMemo(() => {
    const m = new Map<string, Turno[]>();
    for (const t of turnos) { if (!verCancelados && t.estado === 'CANCELADO') continue; m.set(t.fecha, [...(m.get(t.fecha) || []), t]); }
    return m;
  }, [turnos, verCancelados]);

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.85rem' }}>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={sel} />
        <label style={{ fontSize: '0.85rem' }}>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={sel} />
        <label style={{ fontSize: '0.82rem', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={verCancelados} onChange={(e) => setVerCancelados(e.target.checked)} /> Ver cancelados
        </label>
        <button type="button" className="btn" onClick={() => void cargar()}>↻</button>
      </div>
      {!agenda.franjas.length && <div style={{ marginTop: 10, color: '#fbbf24', fontSize: '0.85rem' }}>Esta agenda no tiene horarios: cargalos en Configurar.</div>}

      {grilla.map(d => {
        const lista = porDia.get(d.fecha) || [];
        const libres = d.horarios.reduce((s, h) => s + h.libres, 0);
        return (
          <div key={d.fecha} style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b style={{ textTransform: 'capitalize' }}>{d.dia}</b>
              {d.feriado && <span className="badge" style={{ color: '#f87171' }}>Feriado: {d.feriado}</span>}
              {d.bloqueado && <span className="badge" style={{ color: '#f87171' }}>Bloqueado: {d.bloqueado}</span>}
              {!d.feriado && !d.bloqueado && <span className="muted" style={{ fontSize: '0.78rem' }}>{lista.filter(t => t.estado !== 'CANCELADO').length} turnos · {libres} libres</span>}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              {d.horarios.map(h => (
                <button key={h.hora} type="button"
                  title={h.bloqueado ? 'Bloqueado' : h.google ? `Ocupado en Google: ${h.google}` : h.libres ? 'Cargar turno a mano' : 'Completo'}
                  disabled={!h.libres || !!d.feriado} onClick={() => setManual({ fecha: d.fecha, hora: h.hora })}
                  style={{ ...sel, padding: '3px 7px', cursor: h.libres ? 'pointer' : 'default', opacity: h.bloqueado || d.feriado ? 0.35 : 1,
                    background: h.google && !h.ocupados ? 'rgba(234,179,8,0.25)' : h.libres ? '#1e293b' : 'rgba(37,99,235,0.35)',
                    borderColor: manual?.fecha === d.fecha && manual?.hora === h.hora ? '#fbbf24' : undefined }}>
                  {h.google && !h.ocupados ? '📅 ' : ''}{h.hora}{h.cupo > 1 ? ` (${h.ocupados}/${h.cupo})` : ''}
                </button>
              ))}
            </div>
            {manual?.fecha === d.fecha && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem' }}>Cargar a mano el {fmt(manual.fecha)} {manual.hora} · DNI</span>
                <input value={dniManual} onChange={(e) => setDniManual(e.target.value)} style={sel} placeholder="DNI" autoFocus />
                <MotivoTurnoSelect value={motManual} onChange={setMotManual} motivos={motivos} style={sel} />
                <button type="button" className="btn" onClick={() => void cargarManual()} disabled={!dniManual.trim() || !motivoCompleto(motManual, true)}>Guardar</button>
                <button type="button" className="btn" onClick={() => setManual(null)}>Cancelar</button>
              </div>
            )}
            {!!lista.length && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                <tbody>
                  {lista.map(t => (
                    <tr key={t.id} style={{ opacity: t.estado === 'CANCELADO' ? 0.5 : 1 }}>
                      <td style={{ ...td, width: 60 }}><b>{t.hora}</b></td>
                      <td style={td}>{t.apellido} {t.nombre}{t.motivo && <span className="badge" style={{ marginLeft: 6, color: '#c4b5fd' }}>{t.motivo}</span>}<div className="muted" style={{ fontSize: '0.75rem' }}>DNI {t.dni}{t.telefono_contacto ? ` · tel. ${t.telefono_contacto}` : t.telefono ? ` · ${t.telefono}` : ''}</div></td>
                      <td style={td}><Badge e={t.estado} />{' '}<span className="muted" style={{ fontSize: '0.72rem' }}>{t.origen === 'ENLACE' ? 'por enlace' : 'cargado a mano'}{t.cancelado_por ? ` · canceló ${t.cancelado_por.toLowerCase()}` : ''}{t.jubilacion_cita_id ? ' · en citas de jubilación' : ''}</span></td>
                      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {t.estado === 'RESERVADO' && <>
                          <button type="button" className="btn" onClick={() => void estado(t, 'ATENDIDO')}>✔ Atendido</button>{' '}
                          <button type="button" className="btn" onClick={() => void estado(t, 'AUSENTE')}>✖ Ausente</button>{' '}
                          <button type="button" className="btn" onClick={() => void estado(t, 'CANCELADO')}>Cancelar</button>
                        </>}
                        {(t.estado === 'ATENDIDO' || t.estado === 'AUSENTE') && <button type="button" className="btn" onClick={() => void estado(t, 'RESERVADO')}>Deshacer</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {!grilla.length && agenda.franjas.length > 0 && <div className="muted" style={{ marginTop: 12 }}>No hay días de atención en ese rango.</div>}
    </div>
  );
}

// ── Habilitar y enviar ──────────────────────────────────────────────────────

function HabilitarTab({ agenda, cfg, tunel, filtroInicial, verRetenidos, onCambio }: { agenda: Agenda; cfg: Cfg; tunel: EstadoTunel | null; filtroInicial: string; verRetenidos: number; onCambio: () => void }) {
  const toast = useToast();
  const [lista, setLista] = useState<Habilitacion[]>([]);
  const [filtro, setFiltro] = useState<string>(filtroInicial || 'HABILITADO');
  const [busca, setBusca] = useState('');
  const [encontrados, setEncontrados] = useState<any[]>([]);
  const [pegados, setPegados] = useState('');
  const [resultado, setResultado] = useState<any[] | null>(null);
  const [mot, setMot] = useState<MotivoValor>(MOTIVO_VACIO);
  const [colaVer, setColaVer] = useState(0);   // sube al encolar → el panel de la cola se recarga
  const [tildados, setTildados] = useState<Set<number>>(new Set());   // a quién mandarle (hay que tildarlos primero)
  useEffect(() => { setTildados(new Set()); }, [agenda.id, filtro]);

  const cargar = async () => {
    try { const r = await apiFetch<any>(`/agenda-turnos/habilitaciones?agenda_id=${agenda.id}&estado=${filtro}`); setLista(r.data || []); }
    catch (e: any) { toast.error('Habilitaciones', e?.message); }
  };
  useEffect(() => { void cargar(); }, [agenda.id, filtro]);

  useEffect(() => {
    const s = busca.trim();
    if (s.length < 3) { setEncontrados([]); return; }
    const t = setTimeout(async () => {
      try { const r = await apiFetch<any>(`/agenda-turnos/buscar-agente?q=${encodeURIComponent(s)}`); setEncontrados(r.data || []); } catch { /* noop */ }
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const link = (token: string | null) => (token && cfg.url_publica ? `${cfg.url_publica.replace(/\/+$/, '')}/t/${token}` : '');
  const REENVIO = 'Le reenviamos el enlace para sacar su turno porque el anterior dejó de funcionar.\n\n';
  const mensaje = (h: Pick<Habilitacion, 'nombre' | 'apellido' | 'token' | 'vence_el' | 'motivo' | 'reenviar'>) =>
    (h.reenviar ? REENVIO : '') + (agenda.mensaje_whatsapp || cfg.plantilla)
      .replace(/\{NOMBRE\}/g, `${h.nombre}`.trim())
      .replace(/\{APELLIDO\}/g, `${h.apellido}`.trim())
      .replace(/\{AGENDA\}/g, h.motivo || agenda.nombre)   // con motivo: "su turno de *Nacimiento*"
      .replace(/\{MOTIVO\}/g, h.motivo || '')
      .replace(/\{VENCE\}/g, fmt(h.vence_el))
      .replace(/\{LINK\}/g, link(h.token));

  const habilitar = async (dnis: number[]) => {
    if (!dnis.length) return;
    if (!motivoCompleto(mot, false)) { toast.warning('Motivo', 'Escribí el motivo o elegí otro de la lista.'); return; }
    try {
      const r = await apiFetch<any>('/agenda-turnos/habilitaciones', json('POST', { agenda_id: agenda.id, dnis, ...motivoBody(mot) }));
      setResultado(r.data || []);
      const ok = (r.data || []).filter((x: any) => x.ok).length;
      toast.ok('Habilitados', `${ok} de ${dnis.length}`);
      setBusca(''); setEncontrados([]); setPegados('');
      setFiltro('HABILITADO'); await cargar(); onCambio();
    } catch (e: any) { toast.error('Habilitar', e?.message); }
  };
  const anular = async (h: Habilitacion) => {
    if (!window.confirm(`¿Anular el enlace de ${h.apellido} ${h.nombre}? Ya no va a poder pedir turno con ese enlace.`)) return;
    try { await apiFetch(`/agenda-turnos/habilitaciones/${h.id}/anular`, json('POST', {})); await cargar(); onCambio(); }
    catch (e: any) { toast.error('Anular', e?.message); }
  };
  const copiar = async (texto: string, que: string) => {
    try { await navigator.clipboard.writeText(texto); toast.ok('Copiado', que); } catch { window.prompt('Copiá el texto:', texto); }
  };
  // se anota con qué dirección salió el mensaje: si después cambia, el enlace aparece en "Para reenviar"
  const marcarEnviado = async (h: Habilitacion) => {
    try { await apiFetch(`/agenda-turnos/habilitaciones/${h.id}/enviado`, json('POST', { url: cfg.url_publica })); } catch { /* noop */ }
    if (h.reenviar) { await cargar(); onCambio(); }
  };
  const tunelCaido = !!tunel && tunel.estado !== 'OK' && tunel.estado !== 'SIN_URL';
  const avisarSiCaido = () => {
    if (!tunelCaido) return true;
    return window.confirm('La página de turnos NO se ve desde internet en este momento (túnel caído). Si lo mandás ahora el agente no va a poder abrirlo y vas a tener que reenviarlo. ¿Mandar igual?');
  };
  const whatsapp = (h: Habilitacion) => {
    if (!cfg.url_publica) { toast.warning('Falta la dirección pública', 'Cargala en Configurar.'); return; }
    if (!h.celular) { toast.warning('Sin celular', 'El agente no tiene celular en la base: copiá el mensaje y mandalo a mano.'); return; }
    if (!avisarSiCaido()) return;
    window.open(`https://web.whatsapp.com/send?phone=${h.celular}&text=${encodeURIComponent(mensaje(h))}`, 'whatsapp');
    void marcarEnviado(h);
  };
  const copiarMensaje = async (h: Habilitacion) => {
    if (!avisarSiCaido()) return;
    await copiar(mensaje(h), 'Mensaje con el enlace');
    void marcarEnviado(h);
  };
  // "Reenviar siguiente": abre WhatsApp con el primero que tenga celular; al marcarlo sale de la lista
  const conCelular = filtro === 'REENVIAR' ? lista.filter(h => h.celular) : [];
  const sinCelular = filtro === 'REENVIAR' ? lista.filter(h => !h.celular) : [];

  // Cola: los manda la PC que tiene WhatsApp abierto (el servidor no). Solo los TILDADOS; los que ya tienen turno no se pueden tildar.
  const tildable = (h: Habilitacion) => h.estado === 'HABILITADO' && !!h.celular && !h.turno_vigente;
  const tildables = lista.filter(tildable);
  const paraCola = tildables.filter(h => tildados.has(h.id));
  const tildar = (id: number, v: boolean) => setTildados(prev => { const n = new Set(prev); if (v) n.add(id); else n.delete(id); return n; });
  const todosTildados = tildables.length > 0 && tildables.every(h => tildados.has(h.id));
  const encolar = async () => {
    if (!cfg.url_publica) { toast.warning('Falta la dirección pública', 'Cargala en Configurar.'); return; }
    if (!paraCola.length) { toast.warning('Tildá primero', 'Marcá en la lista a quién le querés mandar el enlace.'); return; }
    let prueba: string | null = null;
    const modo = window.prompt(
      `Se van a poner ${paraCola.length} mensaje(s) en la cola. Los manda la PC marcada con WhatsApp abierto, de a uno, con pausa de 20-40 s.\n`
      + 'Antes de cada uno se revisa que la persona NO tenga ya un turno (si lo tiene, se saltea).\n\n'
      + 'Dejá vacío y Aceptar para mandarlos DE VERDAD.\nO escribí un número de celular para una PRUEBA (todos llegan a ese número y no se marcan como enviados).', '');
    if (modo === null) return;
    if (modo.trim()) prueba = modo.trim();
    else if (!avisarSiCaido()) return;
    try {
      const r = await apiFetch<any>('/agenda-turnos/cola', json('POST', { agenda_id: agenda.id, ids: paraCola.map(h => h.id), prueba_destino: prueba }));
      const d = r.data || {};
      toast.ok(prueba ? 'En cola (PRUEBA)' : 'En cola', `${d.encolados} para mandar${d.salteados?.length ? ` · ${d.salteados.length} salteados` : ''}`);
      if (d.salteados?.length) {
        window.alert('No se pusieron en la cola:\n\n' + d.salteados.map((x: any) => `${x.apellido} ${x.nombre} (DNI ${x.dni}): ${x.motivo}`).join('\n'));
      }
      setColaVer(v => v + 1);
      setTildados(new Set());
    } catch (e: any) { toast.error('Cola de envío', e?.message); }
  };

  const dnisPegados = [...new Set((pegados.match(/\d{6,9}/g) || []).map(Number))];

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <b>Motivo del turno</b>
        <MotivoTurnoSelect value={mot} onChange={setMot} motivos={cfg.motivos} sinMotivoTexto="Que lo elija el agente" style={{ ...sel, minWidth: 200 }} />
        <span className="muted" style={{ fontSize: '0.78rem' }}>Se aplica a los que habilites ahora.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div>
          <b>Habilitar un agente</b>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="DNI o apellido…" style={{ ...sel, width: '100%', marginTop: 6 }} />
          {encontrados.map(a => (
            <div key={a.dni} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ flex: 1, fontSize: '0.85rem' }}>{a.apellido} {a.nombre} <span className="muted">· {a.dni}{a.celular ? '' : ' · sin celular'}</span></span>
              <button type="button" className="btn" onClick={() => void habilitar([a.dni])}>Habilitar</button>
            </div>
          ))}
        </div>
        <div>
          <b>Habilitar varios</b> <span className="muted" style={{ fontSize: '0.78rem' }}>(pegá DNIs, uno por línea o separados)</span>
          <textarea value={pegados} onChange={(e) => setPegados(e.target.value)} rows={3} style={{ ...sel, width: '100%', marginTop: 6, fontFamily: 'inherit' }} />
          <button type="button" className="btn" disabled={!dnisPegados.length} onClick={() => void habilitar(dnisPegados)} style={{ marginTop: 6 }}>
            Habilitar {dnisPegados.length || ''} DNI
          </button>
        </div>
      </div>

      {resultado && resultado.some(r => !r.ok) && (
        <div style={{ marginTop: 10, fontSize: '0.82rem', color: '#fbbf24' }}>
          No se habilitaron: {resultado.filter(r => !r.ok).map(r => `${r.apellido ? `${r.apellido} ${r.nombre}` : r.dni} (${r.motivo})`).join(' · ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <b>Enlaces</b>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={sel}>
          <option value="REENVIAR">🔁 Para reenviar (dirección vieja)</option>
          <option value="HABILITADO">Sin usar</option>
          <option value="USADO">Usados (ya pidieron turno)</option>
          <option value="VENCIDO">Vencidos</option>
          <option value="ANULADO">Anulados</option>
          <option value="">Todos</option>
        </select>
        <span className="muted" style={{ fontSize: '0.8rem' }}>{lista.length}</span>
        {filtro === 'REENVIAR' && conCelular.length > 0 && (
          <button type="button" className="btn" style={{ background: '#16a34a', color: '#fff', fontWeight: 700 }} onClick={() => whatsapp(conCelular[0])}
            title="Abre WhatsApp Web con el mensaje del primero de la lista; al mandarlo sale de la lista y queda el siguiente">
            📲 Reenviar siguiente: {conCelular[0].apellido} {conCelular[0].nombre} ({conCelular.length} con celular)
          </button>
        )}
        {(filtro === 'REENVIAR' || filtro === 'HABILITADO') && tildables.length > 0 && (
          <button type="button" className="btn" disabled={!paraCola.length}
            style={{ background: paraCola.length ? '#2563eb' : undefined, color: paraCola.length ? '#fff' : undefined, fontWeight: 700 }} onClick={() => void encolar()}
            title={paraCola.length ? "Los pone en la cola: los manda la PC que tiene WhatsApp abierto y la app con 'Esta PC manda los mensajes de la agenda'" : 'Tildá primero en la lista a quién mandarle'}>
            {paraCola.length ? `📤 Mandar a los tildados desde la PC de WhatsApp (${paraCola.length})` : '📤 Tildá a quién mandarle ↓'}
          </button>
        )}
      </div>
      {filtro === 'REENVIAR' && (
        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>
          Enlaces sin usar que se mandaron con una dirección anterior. El enlace personal es el mismo: solo cambia la dirección.
          El mensaje sale con una línea que explica que es un reenvío.{sinCelular.length ? ` ${sinCelular.length} sin celular: usá "Copiar mensaje" y mandalo a mano.` : ''}
          {!lista.length && ' No hay nada para reenviar.'}
        </div>
      )}
      <ColaEnvios agendaId={agenda.id} recargar={colaVer + verRetenidos} soloRetenidos={verRetenidos > 0} onCambio={() => { void cargar(); onCambio(); }} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead><tr>
          <th style={{ ...th, width: 28 }}>
            {tildables.length > 0 && (
              <input type="checkbox" checked={todosTildados} title="Tildar / destildar todos"
                onChange={(e) => setTildados(e.target.checked ? new Set(tildables.map(h => h.id)) : new Set())} />
            )}
          </th>
          <th style={th}>Agente</th><th style={th}>Estado</th><th style={th}>Vence / turno</th><th style={th} />
        </tr></thead>
        <tbody>
          {lista.map(h => (
            <tr key={h.id} style={{ background: tildados.has(h.id) ? 'rgba(37,99,235,0.12)' : undefined }}>
              <td style={{ ...td, width: 28 }}>
                {tildable(h) && <input type="checkbox" checked={tildados.has(h.id)} onChange={(e) => tildar(h.id, e.target.checked)} />}
              </td>
              <td style={td}>{h.apellido} {h.nombre}<span className="badge" style={{ marginLeft: 6, color: h.motivo ? '#c4b5fd' : '#94a3b8' }}>{h.motivo || 'motivo: lo elige el agente'}</span><div className="muted" style={{ fontSize: '0.75rem' }}>DNI {h.dni} · {h.celular ? `cel. ${h.celular}${h.dudoso ? ' (dudoso)' : ''}` : 'sin celular'}</div></td>
              <td style={td}><Badge e={h.estado} />{h.reenviar && <span className="badge" style={{ marginLeft: 4, color: '#fbbf24' }} title="Se mandó con una dirección que ya no anda">🔁 reenviar</span>}
                {h.estado === 'HABILITADO' && h.turno_vigente && <div style={{ fontSize: '0.72rem', color: '#f87171' }} title="No se puede tildar: ya tiene un turno reservado">⚠ ya tiene turno el {h.turno_vigente}</div>}
                {(h.estado === 'VENCIDO' || h.estado === 'ANULADO') && (h.turno_vigente
                  ? <div style={{ fontSize: '0.72rem', color: '#4ade80' }} title="Sacó turno con otro enlace o se lo cargó la oficina">✔ ya tiene turno el {h.turno_vigente}</div>
                  : h.enlace_nuevo_vence
                    ? <div style={{ fontSize: '0.72rem', color: '#60a5fa' }} title="Tiene otro enlace habilitado que todavía no usó">🔗 tiene enlace nuevo sin usar (vence {fmt(h.enlace_nuevo_vence)})</div>
                    : <div style={{ fontSize: '0.72rem', color: '#fbbf24' }}>sin turno ni enlace vigente</div>)}
                {!!h.envios && <div className="muted" style={{ fontSize: '0.72rem' }}>enviado {fmtHora(h.enviado_at)}{h.envios > 1 ? ` (${h.envios} veces)` : ''}</div>}</td>
              <td style={td}>
                {h.estado === 'USADO' && h.turno_fecha ? <>{fmt(h.turno_fecha)} {h.turno_hora} {h.turno_estado && <Badge e={h.turno_estado} />}</> : <>vence {fmt(h.vence_el)}</>}
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                {h.token && <>
                  {h.estado === 'HABILITADO' && <><button type="button" className="btn" onClick={() => whatsapp(h)} title="Abre WhatsApp Web con el mensaje escrito">📲 WhatsApp</button>{' '}</>}
                  <button type="button" className="btn" disabled={!cfg.url_publica} onClick={() => void copiarMensaje(h)}>Copiar mensaje</button>{' '}
                  <button type="button" className="btn" disabled={!cfg.url_publica} onClick={() => void copiar(link(h.token), 'Enlace')}>🔗</button>{' '}
                </>}
                {h.estado === 'HABILITADO' && <button type="button" className="btn" onClick={() => void anular(h)}>Anular</button>}
                {(h.estado === 'VENCIDO' || h.estado === 'ANULADO' || (h.estado === 'USADO' && h.turno_estado === 'CANCELADO')) &&
                  <button type="button" className="btn" onClick={() => void habilitar([h.dni])}>Habilitar de nuevo</button>}
              </td>
            </tr>
          ))}
          {!lista.length && <tr><td style={td} colSpan={5}><span className="muted">Nada para mostrar.</span></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Bloqueos ────────────────────────────────────────────────────────────────

function BloqueosTab({ agenda }: { agenda: Agenda }) {
  const toast = useToast();
  const [lista, setLista] = useState<Bloqueo[]>([]);
  const [n, setN] = useState({ todas: false, fecha_desde: hoy(), fecha_hasta: hoy(), diaEntero: true, hora_desde: '08:00', hora_hasta: '12:00', motivo: '' });

  const cargar = async () => {
    try { const r = await apiFetch<any>(`/agenda-turnos/bloqueos?agenda_id=${agenda.id}`); setLista(r.data || []); }
    catch (e: any) { toast.error('Bloqueos', e?.message); }
  };
  useEffect(() => { void cargar(); }, [agenda.id]);

  const agregar = async () => {
    try {
      const r = await apiFetch<any>('/agenda-turnos/bloqueos', json('POST', {
        agenda_id: n.todas ? null : agenda.id, fecha_desde: n.fecha_desde, fecha_hasta: n.fecha_hasta || n.fecha_desde,
        hora_desde: n.diaEntero ? null : n.hora_desde, hora_hasta: n.diaEntero ? null : n.hora_hasta, motivo: n.motivo,
      }));
      if (r.afectados?.length) {
        window.alert(`Bloqueado. OJO: ya hay ${r.afectados.length} turno(s) reservado(s) en ese rango que NO se cancelaron solos:\n\n`
          + r.afectados.map((a: any) => `${fmt(a.fecha)} ${a.hora} · ${a.apellido} ${a.nombre} (DNI ${a.dni})`).join('\n')
          + '\n\nAvisales y cancelalos desde la pestaña Turnos si hace falta.');
      } else toast.ok('Bloqueado', '');
      setN({ ...n, motivo: '' }); await cargar();
    } catch (e: any) { toast.error('Bloqueo', e?.message); }
  };
  const quitar = async (b: Bloqueo) => {
    if (!window.confirm('¿Quitar este bloqueo? Esos horarios vuelven a ofrecerse.')) return;
    try { await apiFetch(`/agenda-turnos/bloqueos/${b.id}`, { method: 'DELETE' }); await cargar(); }
    catch (e: any) { toast.error('Bloqueo', e?.message); }
  };

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <b>Nuevo bloqueo</b>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <label style={{ fontSize: '0.82rem' }}>Desde</label><input type="date" value={n.fecha_desde} onChange={(e) => setN({ ...n, fecha_desde: e.target.value, fecha_hasta: n.fecha_hasta < e.target.value ? e.target.value : n.fecha_hasta })} style={sel} />
        <label style={{ fontSize: '0.82rem' }}>Hasta</label><input type="date" value={n.fecha_hasta} onChange={(e) => setN({ ...n, fecha_hasta: e.target.value })} style={sel} />
        <label style={{ fontSize: '0.82rem', display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={n.diaEntero} onChange={(e) => setN({ ...n, diaEntero: e.target.checked })} /> Día entero</label>
        {!n.diaEntero && <>
          <input type="time" value={n.hora_desde} onChange={(e) => setN({ ...n, hora_desde: e.target.value })} style={sel} />
          <span>a</span>
          <input type="time" value={n.hora_hasta} onChange={(e) => setN({ ...n, hora_hasta: e.target.value })} style={sel} />
        </>}
        <input value={n.motivo} onChange={(e) => setN({ ...n, motivo: e.target.value })} placeholder="Motivo (licencia, reunión…)" style={{ ...sel, minWidth: 200 }} />
        <label style={{ fontSize: '0.82rem', display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={n.todas} onChange={(e) => setN({ ...n, todas: e.target.checked })} /> Todas las agendas</label>
        <button type="button" className="btn" onClick={() => void agregar()}>Bloquear</button>
      </div>
      <div className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>Los feriados cargados en 📅 Feriados se bloquean solos.</div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
        <thead><tr><th style={th}>Fechas</th><th style={th}>Horario</th><th style={th}>Motivo</th><th style={th}>Agenda</th><th style={th} /></tr></thead>
        <tbody>
          {lista.map(b => (
            <tr key={b.id}>
              <td style={td}>{fmt(b.fecha_desde)}{b.fecha_hasta !== b.fecha_desde ? ` al ${fmt(b.fecha_hasta)}` : ''}</td>
              <td style={td}>{b.hora_desde ? `${b.hora_desde} a ${b.hora_hasta}` : 'Día entero'}</td>
              <td style={td}>{b.motivo || '—'}</td>
              <td style={td}>{b.agenda_id ? b.agenda_nombre : 'Todas'}</td>
              <td style={{ ...td, textAlign: 'right' }}><button type="button" className="btn" onClick={() => void quitar(b)}>Quitar</button></td>
            </tr>
          ))}
          {!lista.length && <tr><td style={td} colSpan={5}><span className="muted">Sin bloqueos de hoy en adelante.</span></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Calendario Google ───────────────────────────────────────────────────────

function GoogleTab({ agenda }: { agenda: Agenda }) {
  const toast = useToast();
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(masDias(hoy(), 30));
  const [soloManuales, setSoloManuales] = useState(false);
  const [data, setData] = useState<{ estado: any; eventos: EventoG[] } | null>(null);

  const cargar = async () => {
    try { const r = await apiFetch<any>(`/agenda-turnos/gcal?agenda_id=${agenda.id}&desde=${desde}&hasta=${hasta}`); setData(r.data); }
    catch (e: any) { toast.error('Calendario Google', e?.message); }
  };
  useEffect(() => { void cargar(); }, [agenda.id, desde, hasta]);

  const st = data?.estado;
  const eventos = (data?.eventos || []).filter(e => !soloManuales || e.origen === 'MANUAL');
  const hora = (s: string) => s.slice(11, 16);
  const porDia = new Map<string, EventoG[]>();
  for (const e of eventos) porDia.set(e.inicio.slice(0, 10), [...(porDia.get(e.inicio.slice(0, 10)) || []), e]);

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <div style={{ fontSize: '0.84rem', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {!st?.gcal_calendar_id
          ? <span style={{ color: '#fbbf24' }}>Todavía no hay calendario de Google para esta agenda: lo crea el robot "google_calendar_turnos" en su próxima corrida (página Robots).</span>
          : <>
              <span>✔ Calendario "Turnos - {agenda.nombre}" en la cuenta de antecedentes</span>
              <span className="muted">Última sincronización: {st.ultimo_ok ? new Date(st.ultimo_ok).toLocaleString('es-AR') : 'nunca'}</span>
              {Number(st.pendientes) > 0 && <span style={{ color: '#fbbf24' }}>{st.pendientes} turno(s) esperando subirse</span>}
              {Number(st.con_error) > 0 && <span style={{ color: '#f87171' }}>{st.con_error} con error al subir</span>}
              {st.ultimo_error && <span style={{ color: '#f87171' }}>Error: {st.ultimo_error}</span>}
            </>}
      </div>
      <div className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>
        Los eventos que se cargan a mano en ese calendario de Google ocupan el horario: la agenda deja de ofrecerlo a los agentes.
        Si el título tiene un DNI (ej. "Turno 30123456") se vincula al agente. Se sincroniza cada 5 minutos.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <label style={{ fontSize: '0.85rem' }}>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={sel} />
        <label style={{ fontSize: '0.85rem' }}>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={sel} />
        <label style={{ fontSize: '0.82rem', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={soloManuales} onChange={(e) => setSoloManuales(e.target.checked)} /> Solo los cargados a mano
        </label>
        <button type="button" className="btn" onClick={() => void cargar()}>↻</button>
      </div>
      {[...porDia.entries()].map(([f, evs]) => (
        <div key={f} style={{ marginTop: 12 }}>
          <b>{fmt(f)}</b>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
            <tbody>
              {evs.map(e => (
                <tr key={e.id}>
                  <td style={{ ...td, width: 110 }}>{e.todo_el_dia ? 'Todo el día' : `${hora(e.inicio)} – ${hora(e.fin)}`}</td>
                  <td style={td}>
                    {e.titulo || '(sin título)'}
                    {e.dni && <div className="muted" style={{ fontSize: '0.75rem' }}>Agente: {e.apellido} {e.nombre} · DNI {e.dni}</div>}
                    {e.origen === 'MANUAL' && e.descripcion && <div className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>{e.descripcion.slice(0, 300)}</div>}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {e.origen === 'SISTEMA'
                      ? <span className="badge" style={{ color: '#60a5fa' }}>del sistema</span>
                      : <span className="badge" style={{ color: '#fbbf24' }}>a mano en Google{e.creador ? ` · ${e.creador}` : ''}</span>}
                    {Number(e.choca) > 0 && <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: 2 }}>⚠ se superpone con {e.choca} turno(s) ya reservado(s)</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {data && !eventos.length && <div className="muted" style={{ marginTop: 12 }}>Sin eventos en ese rango.</div>}
    </div>
  );
}

// ── Configurar ──────────────────────────────────────────────────────────────

function ConfigTab({ agenda, cfg, onGuardado, onCfg }: {
  agenda: Agenda | null; cfg: { url_publica: string; plantilla: string; plantillaDefault: string };
  onGuardado: (id: number) => void; onCfg: () => void;
}) {
  const toast = useToast();
  const [a, setA] = useState<Agenda>(agenda ? { ...agenda, franjas: agenda.franjas.map(f => ({ ...f })) } : { ...AGENDA_VACIA });
  const [url, setUrl] = useState(cfg.url_publica);
  const [plantilla, setPlantilla] = useState(cfg.plantilla);
  useEffect(() => { setA(agenda ? { ...agenda, franjas: agenda.franjas.map(f => ({ ...f })) } : { ...AGENDA_VACIA, franjas: AGENDA_VACIA.franjas.map(f => ({ ...f })) }); }, [agenda?.id]);
  useEffect(() => { setUrl(cfg.url_publica); setPlantilla(cfg.plantilla); }, [cfg.url_publica, cfg.plantilla]);

  const setF = (i: number, k: keyof Franja, v: any) => setA({ ...a, franjas: a.franjas.map((f, j) => (j === i ? { ...f, [k]: v } : f)) });
  const num = (k: keyof Agenda, label: string, ayuda: string) => (
    <label style={{ fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {label}
      <input type="number" min={0} value={Number(a[k] ?? 0)} onChange={(e) => setA({ ...a, [k]: Number(e.target.value) })} style={{ ...sel, width: 110 }} />
      <span className="muted" style={{ fontSize: '0.72rem' }}>{ayuda}</span>
    </label>
  );

  const guardar = async () => {
    // El input date deja tipear años de 5+ cifras (p.ej. 20226): avisar claro antes de mandar.
    if (a.turnos_desde_activo) {
      const f = String(a.turnos_desde || '');
      if (!f) { toast.error('Agenda', 'Elegí la fecha de "Dar turnos a partir del" (o destildalo).'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        toast.error('Agenda', `La fecha de "Dar turnos a partir del" está mal escrita (año ${f.split('-')[0]}). Corregí el año.`);
        return;
      }
    }
    try {
      const r = await apiFetch<any>(agenda ? `/agenda-turnos/agendas/${agenda.id}` : '/agenda-turnos/agendas', json(agenda ? 'PUT' : 'POST', a));
      toast.ok('Agenda guardada', a.nombre);
      onGuardado(Number(r.id));
    } catch (e: any) { toast.error('Agenda', e?.message); }
  };
  const guardarCfg = async () => {
    try { await apiFetch('/agenda-turnos/config', json('PUT', { url_publica: url, plantilla })); toast.ok('Guardado', ''); onCfg(); }
    catch (e: any) { toast.error('Configuración', e?.message); }
  };

  const turnosPorSemana = a.franjas.reduce((s, f) => {
    const [h1, m1] = f.hora_desde.split(':').map(Number), [h2, m2] = f.hora_hasta.split(':').map(Number);
    return s + Math.max(0, Math.floor(((h2 * 60 + m2) - (h1 * 60 + m1)) / Math.max(5, f.duracion_min || 20))) * Math.max(1, f.cupo || 1);
  }, 0);

  return (
    <>
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <b>{agenda ? `Editar "${agenda.nombre}"` : 'Nueva agenda'}</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginTop: 10 }}>
          <label style={{ fontSize: '0.82rem' }}>Nombre (lo ve el agente)<input value={a.nombre} onChange={(e) => setA({ ...a, nombre: e.target.value })} style={{ ...sel, width: '100%' }} placeholder="Turnos de Personal" /></label>
          <label style={{ fontSize: '0.82rem' }}>Lugar<input value={a.lugar || ''} onChange={(e) => setA({ ...a, lugar: e.target.value })} style={{ ...sel, width: '100%' }} placeholder="Oficina de Personal, planta baja" /></label>
          <label style={{ fontSize: '0.82rem' }}>Indicaciones para el agente<input value={a.descripcion || ''} onChange={(e) => setA({ ...a, descripcion: e.target.value })} style={{ ...sel, width: '100%' }} placeholder="Traer DNI y último recibo" /></label>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
          {num('anticipacion_dias', 'Desde (días)', '0 = puede pedir para hoy')}
          {num('ventana_dias', 'Hasta (días)', 'cuántos días adelante se ofrecen')}
          {num('vence_dias', 'Vence el enlace (días)', 'si no lo usa, deja de servir')}
          {num('cancelar_horas', 'Cancelar hasta (horas antes)', 'después, solo la oficina')}
          <div style={{ fontSize: '0.82rem' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={!!a.turnos_desde_activo}
                onChange={(e) => setA({ ...a, turnos_desde_activo: e.target.checked ? 1 : 0 })} />
              Dar turnos a partir del
            </label>
            <input type="date" value={a.turnos_desde || ''} disabled={!a.turnos_desde_activo} min="2000-01-01" max="2099-12-31"
              onChange={(e) => setA({ ...a, turnos_desde: e.target.value || null })} style={{ ...sel, marginTop: 2 }} />
            <div className="muted" style={{ fontSize: '0.7rem' }}>
              {a.turnos_desde_activo ? 'el agente no ve días antes; "Hasta" se cuenta desde esa fecha' : 'apagado: cuenta desde hoy'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
          <label style={{ fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!a.carga_jubilacion} onChange={(e) => setA({ ...a, carga_jubilacion: e.target.checked ? 1 : 0 })} />
            Cargar en la Agenda de citas de Jubilación los turnos con motivo Jubilación
          </label>
          <label style={{ fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!a.activa} onChange={(e) => setA({ ...a, activa: e.target.checked ? 1 : 0 })} /> Activa
          </label>
        </div>

        <div style={{ marginTop: 14 }}><b>Horarios de atención</b> <span className="muted" style={{ fontSize: '0.78rem' }}>· {turnosPorSemana} turnos por semana</span></div>
        <table style={{ borderCollapse: 'collapse', marginTop: 6 }}>
          <thead><tr><th style={th}>Día</th><th style={th}>Desde</th><th style={th}>Hasta</th><th style={th}>Cada (min)</th><th style={th}>Personas por horario</th><th style={th} /></tr></thead>
          <tbody>
            {a.franjas.map((f, i) => (
              <tr key={i}>
                <td style={td}><select value={f.dia_semana} onChange={(e) => setF(i, 'dia_semana', Number(e.target.value))} style={sel}>{DIAS.map((d, j) => <option key={j} value={j}>{d}</option>)}</select></td>
                <td style={td}><input type="time" value={f.hora_desde} onChange={(e) => setF(i, 'hora_desde', e.target.value)} style={sel} /></td>
                <td style={td}><input type="time" value={f.hora_hasta} onChange={(e) => setF(i, 'hora_hasta', e.target.value)} style={sel} /></td>
                <td style={td}><input type="number" min={5} step={5} value={f.duracion_min} onChange={(e) => setF(i, 'duracion_min', Number(e.target.value))} style={{ ...sel, width: 70 }} /></td>
                <td style={td}><input type="number" min={1} value={f.cupo} onChange={(e) => setF(i, 'cupo', Number(e.target.value))} style={{ ...sel, width: 70 }} /></td>
                <td style={td}><button type="button" className="btn" onClick={() => setA({ ...a, franjas: a.franjas.filter((_, j) => j !== i) })}>✖</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn" style={{ marginTop: 6 }}
          onClick={() => setA({ ...a, franjas: [...a.franjas, { ...(a.franjas[a.franjas.length - 1] || AGENDA_VACIA.franjas[0]), dia_semana: Math.min(6, (a.franjas[a.franjas.length - 1]?.dia_semana ?? 0) + 1) }] })}>
          ➕ Agregar horario
        </button>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: '0.82rem' }}>Mensaje de WhatsApp propio de esta agenda (vacío = el general). Variables: {'{NOMBRE} {APELLIDO} {AGENDA} {MOTIVO} {LINK} {VENCE}'} ({'{AGENDA}'} pone el motivo si lo tiene)</label>
          <textarea value={a.mensaje_whatsapp || ''} onChange={(e) => setA({ ...a, mensaje_whatsapp: e.target.value })} rows={4} style={{ ...sel, width: '100%', fontFamily: 'inherit' }} />
        </div>
        <button type="button" className="btn" onClick={() => void guardar()} disabled={!a.nombre.trim()} style={{ marginTop: 10, background: '#16a34a', color: '#fff', fontWeight: 700 }}>
          Guardar agenda
        </button>
      </div>

      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <b>General (todas las agendas)</b>
        <label style={{ fontSize: '0.82rem', display: 'block', marginTop: 8 }}>Dirección pública de la página de turnos (la que publica el túnel)
          <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ ...sel, width: '100%' }} placeholder="https://turnos.ejemplo.com.ar" />
        </label>
        <label style={{ fontSize: '0.82rem', display: 'block', marginTop: 8 }}>Mensaje de WhatsApp general
          <textarea value={plantilla} onChange={(e) => setPlantilla(e.target.value)} rows={6} style={{ ...sel, width: '100%', fontFamily: 'inherit' }} />
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn" onClick={() => void guardarCfg()}>Guardar</button>
          <button type="button" className="btn" onClick={() => setPlantilla(cfg.plantillaDefault)}>Mensaje por defecto</button>
        </div>
      </div>
    </>
  );
}

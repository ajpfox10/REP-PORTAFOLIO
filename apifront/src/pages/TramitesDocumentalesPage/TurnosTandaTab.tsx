// src/pages/TramitesDocumentalesPage/TurnosTandaTab.tsx
// Turnos × tanda: se tildan agentes de una tanda → se los habilita en la Agenda de turnos (enlace personal)
// y se les manda el enlace por WhatsApp con la extensión, de a uno con pausa (igual que las felicitaciones
// de cumpleaños). El agente entra al enlace y elige día y horario. Usa los endpoints de /agenda-turnos.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { DocuBrowser } from './DocuBrowser';
import { MotivoTurnoSelect, MotivoValor, motivoBody, motivoCompleto } from '../../components/MotivoTurno';

type TandaRow = { tanda: string; dni: number; apellidoNombre: string; ocupacionNombre: string | null };
const SIN_OCUPACION = '(sin ocupación)';
const ocupDe = (r: TandaRow) => (r.ocupacionNombre || '').trim() || SIN_OCUPACION;
type Agenda = { id: number; nombre: string; activa: number; mensaje_whatsapp: string | null; vence_dias: number };
type Hab = {
  id: number; dni: number; apellido: string; nombre: string; celular: string | null; dudoso: boolean; token: string | null;
  estado: 'HABILITADO' | 'USADO' | 'VENCIDO' | 'ANULADO'; motivo: string | null; vence_el: string; reenviar?: boolean;
  envios?: number; enviado_at?: string | null; turno_fecha: string | null; turno_hora: string | null; turno_estado: string | null;
};
type Cfg = { url_publica: string; plantilla: string; motivos: string[] };
type Resultado = { estado: 'ENVIANDO' | 'ENVIADO' | 'ERROR' | 'SIN_CELULAR' | 'NO_HABILITADO' | 'PENDIENTE'; detalle?: string };

// ── extensión de WhatsApp (copia chica, igual que felicitar.ts) ─────────────
let seq = 0;
function aExtension(type: string, payload?: any, ms = 5000): Promise<{ ok: boolean; estado: string; detalle?: string | null; version?: string }> {
  const id = `turnos-${Date.now()}-${++seq}`;
  return new Promise((resolve) => {
    const fin = setTimeout(() => { window.removeEventListener('message', oir); resolve({ ok: false, estado: 'ERROR', detalle: 'La extensión no respondió' }); }, ms);
    function oir(ev: MessageEvent) {
      if (ev.source !== window || ev.data?.hpw !== 'ext' || ev.data.id !== id) return;
      clearTimeout(fin); window.removeEventListener('message', oir);
      const { hpw: _h, id: _i, ...r } = ev.data;
      resolve(r);
    }
    window.addEventListener('message', oir);
    window.postMessage({ hpw: 'app', id, type, payload }, window.location.origin);
  });
}
/** Número escrito a mano → 549 + área + número. */
function celularPrueba(s: string) {
  const d = s.replace(/\D/g, '');
  if (d.startsWith('549') && d.length === 13) return d;
  let nac = d.startsWith('54') && d.length === 12 ? d.slice(2) : d.replace(/^0+/, '');
  if (nac.length === 12) {
    for (const a of nac.startsWith('11') ? [2] : [3, 4, 2]) {
      if (nac.substr(a, 2) === '15') { nac = nac.slice(0, a) + nac.slice(a + 2); break; }
    }
  } else if (nac.length === 10 && nac.startsWith('15')) nac = '11' + nac.slice(2);
  return nac.length === 10 ? `549${nac}` : d;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const json = (method: string, body?: any) => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const fmt = (f?: string | null) => (f ? f.slice(0, 10).split('-').reverse().join('/') : '');
const fmtHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const sel: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b', color: 'inherit', fontSize: '0.82rem' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)' };
const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem', verticalAlign: 'top' };
const LS_PRUEBA = 'turnosTanda.destinoPrueba';
const COLOR_RES: Record<Resultado['estado'], string> = {
  ENVIANDO: '#60a5fa', ENVIADO: '#4ade80', ERROR: '#f87171', SIN_CELULAR: '#fbbf24', NO_HABILITADO: '#f87171', PENDIENTE: '#94a3b8',
};
const TXT_RES: Record<Resultado['estado'], string> = {
  ENVIANDO: 'Enviando…', ENVIADO: 'Enviado', ERROR: 'Error', SIN_CELULAR: 'Sin celular', NO_HABILITADO: 'No habilitado', PENDIENTE: 'En espera',
};

export function TurnosTandaTab() {
  const toast = useToast();
  const [tandaRows, setTandaRows] = useState<TandaRow[]>([]);
  const [tandas, setTandas] = useState<string[]>([]);
  const [tanda, setTanda] = useState('');
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [agendaId, setAgendaId] = useState(0);
  const [cfg, setCfg] = useState<Cfg>({ url_publica: '', plantilla: '', motivos: [] });
  const [mot, setMot] = useState<MotivoValor>({ motivo: 'Entrega de papeles', otro: '' });
  const [habs, setHabs] = useState<Map<number, Hab>>(new Map());
  const [tildados, setTildados] = useState<Set<number>>(new Set());
  const [resultados, setResultados] = useState<Map<number, Resultado>>(new Map());
  const [tunelOk, setTunelOk] = useState<boolean | null>(null);
  const [extVersion, setExtVersion] = useState<string | null | undefined>(undefined);
  const [prueba, setPrueba] = useState(false);
  const [destinoPrueba, setDestinoPrueba] = useState(() => { try { return localStorage.getItem(LS_PRUEBA) || ''; } catch { return ''; } });
  const [enviando, setEnviando] = useState(false);
  const detenerRef = useRef(false);
  useEffect(() => () => { detenerRef.current = true; }, []);
  useEffect(() => { try { localStorage.setItem(LS_PRUEBA, destinoPrueba); } catch { /* sin storage */ } }, [destinoPrueba]);

  const agenda = agendas.find(a => a.id === agendaId) || null;

  // carga inicial: tandas, agendas, config, túnel y extensión
  useEffect(() => {
    (async () => {
      try {
        const [t, a, c] = await Promise.all([
          apiFetch<any>('/tramites-documentales/tandas'),
          apiFetch<any>('/agenda-turnos/agendas'),
          apiFetch<any>('/agenda-turnos/config'),
        ]);
        setTandaRows(t.data?.rows || []);
        setTandas(t.data?.tandas || []);
        const ags: Agenda[] = (a.data || []).filter((x: Agenda) => x.activa);
        setAgendas(ags);
        if (ags.length) setAgendaId(ags[0].id);
        setCfg(c.data);
      } catch (e: any) { toast.error('Turnos × tanda', e?.message || 'No se pudo cargar'); }
    })();
    void probarTunel();
    void aExtension('PING', undefined, 1500).then(r => setExtVersion(r.ok ? String(r.version || '?') : null));
  }, []);

  const probarTunel = async () => {
    try { const r = await apiFetch<any>('/agenda-turnos/tunel'); setTunelOk(r.data?.estado === 'OK'); } catch { setTunelOk(null); }
  };

  // enlaces de la agenda: el más reciente de cada DNI
  const cargarHabs = async (): Promise<Map<number, Hab>> => {
    if (!agendaId) return new Map();
    try {
      const r = await apiFetch<any>(`/agenda-turnos/habilitaciones?agenda_id=${agendaId}&estado=`);
      const m = new Map<number, Hab>();
      for (const h of (r.data || []) as Hab[]) if (!m.has(h.dni)) m.set(h.dni, h);   // viene ordenado por created_at DESC
      setHabs(m);
      return m;
    } catch (e: any) { toast.error('Enlaces', e?.message); return habs; }
  };
  useEffect(() => { void cargarHabs(); }, [agendaId]);

  const tieneTurno = (dni: number) => { const h = habs.get(dni); return !!h && h.estado === 'USADO' && h.turno_estado === 'RESERVADO'; };
  const [ocupacion, setOcupacion] = useState('');   // '' = todas
  const deTanda = useMemo(() => tandaRows.filter(r => r.tanda === tanda).sort((a, b) => a.apellidoNombre.localeCompare(b.apellidoNombre)), [tandaRows, tanda]);
  const ocupaciones = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of deTanda) m.set(ocupDe(r), (m.get(ocupDe(r)) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [deTanda]);
  // vista por turno: todos / con turno pedido / sin turno / enlace mandado sin usar
  const [vista, setVista] = useState<'TODOS' | 'CON_TURNO' | 'SIN_TURNO' | 'SIN_USAR'>('TODOS');
  const [abierto, setAbierto] = useState<number | null>(null);   // DNI con la carpeta de documentos desplegada
  const pasaVista = (dni: number) => {
    if (vista === 'TODOS') return true;
    if (vista === 'CON_TURNO') return tieneTurno(dni);
    if (vista === 'SIN_TURNO') return !tieneTurno(dni);
    return habs.get(dni)?.estado === 'HABILITADO';
  };
  // solo se ven (y se mandan) los de la ocupación y la vista elegidas
  const agentes = useMemo(
    () => deTanda.filter(r => (!ocupacion || ocupDe(r) === ocupacion) && pasaVista(r.dni)),
    [deTanda, ocupacion, vista, habs]);
  useEffect(() => { setOcupacion(''); setVista('TODOS'); setAbierto(null); }, [tanda]);
  const conteo = useMemo(() => { const m = new Map<string, number>(); for (const r of tandaRows) m.set(r.tanda, (m.get(r.tanda) || 0) + 1); return m; }, [tandaRows]);

  // al cambiar de tanda / filtros: se tildan los que todavía no tienen turno pedido
  useEffect(() => {
    setTildados(new Set(agentes.filter(a => !tieneTurno(a.dni)).map(a => a.dni)));
    setResultados(new Map());
  }, [tanda, ocupacion, vista]);

  const tildar = (dni: number, v: boolean) => setTildados(prev => { const s = new Set(prev); if (v) s.add(dni); else s.delete(dni); return s; });
  const setRes = (dni: number, r: Resultado) => setResultados(prev => new Map(prev).set(dni, r));

  const link = (token: string | null) => (token && cfg.url_publica ? `${cfg.url_publica.replace(/\/+$/, '')}/t/${token}` : '');
  const mensaje = (h: Hab) =>
    (agenda?.mensaje_whatsapp || cfg.plantilla)
      .replace(/\{NOMBRE\}/g, `${h.nombre}`.trim())
      .replace(/\{APELLIDO\}/g, `${h.apellido}`.trim())
      .replace(/\{AGENDA\}/g, h.motivo || agenda?.nombre || '')
      .replace(/\{MOTIVO\}/g, h.motivo || '')
      .replace(/\{VENCE\}/g, fmt(h.vence_el))
      .replace(/\{LINK\}/g, link(h.token));

  const habilitarYMandar = async () => {
    const dnis = agentes.filter(a => tildados.has(a.dni)).map(a => a.dni);
    if (!agenda || !dnis.length) return;
    if (!cfg.url_publica) { toast.warning('Falta la dirección pública', 'Cargala en Agenda de turnos → Configurar.'); return; }
    if (!motivoCompleto(mot, false)) { toast.warning('Motivo', 'Escribí el motivo o elegí otro de la lista.'); return; }
    if (!extVersion) { toast.warning('Extensión de WhatsApp', 'No está instalada o no responde en esta PC. Abrí WhatsApp Web y recargá la página.'); return; }
    if (prueba && !destinoPrueba.trim()) { toast.warning('Prueba', 'Escribí el número de prueba.'); return; }
    if (tunelOk === false && !window.confirm('La página de turnos NO se ve desde internet ahora (túnel caído). Si mandás los enlaces no van a abrir y vas a tener que reenviarlos. ¿Mandar igual?')) return;
    if (!window.confirm(`${prueba ? '[PRUEBA] ' : ''}Se van a habilitar ${dnis.length} agente${dnis.length === 1 ? '' : 's'} en "${agenda.nombre}" y mandarles el enlace por WhatsApp${prueba ? ` (todos los mensajes van a ${destinoPrueba})` : ''}, de a uno con una pausa de 20 a 40 segundos. ¿Seguir?`)) return;

    setEnviando(true); detenerRef.current = false;
    setResultados(new Map(dnis.map(d => [d, { estado: 'PENDIENTE' } as Resultado])));
    try {
      const r = await apiFetch<any>('/agenda-turnos/habilitaciones', json('POST', { agenda_id: agenda.id, dnis, observacion: `Tanda ${tanda}`, ...motivoBody(mot) }));
      const res: any[] = r.data || [];
      for (const x of res) if (!x.ok) setRes(x.dni, { estado: 'NO_HABILITADO', detalle: x.motivo });
      const m = await cargarHabs();
      const aMandar = res.filter(x => x.ok).map(x => x.dni as number);
      for (let i = 0; i < aMandar.length; i++) {
        if (detenerRef.current) break;
        const dni = aMandar[i];
        const h = m.get(dni);
        if (!h || h.estado !== 'HABILITADO' || !h.token) { setRes(dni, { estado: 'ERROR', detalle: 'No se encontró el enlace' }); continue; }
        const telefono = prueba ? celularPrueba(destinoPrueba) : h.celular;
        if (!telefono) { setRes(dni, { estado: 'SIN_CELULAR', detalle: 'Sin celular en la base: copiá el mensaje y mandalo a mano' }); continue; }
        setRes(dni, { estado: 'ENVIANDO' });
        const e = await aExtension('ENVIAR', { modo: 'TELEFONO', buscar: '', palabras: [], telefono, texto: mensaje(h) }, 180000);
        if (e.ok) {
          setRes(dni, { estado: 'ENVIADO', detalle: prueba ? `prueba → ${telefono}` : undefined });
          // anota con qué dirección salió (si cambia, aparece en "Para reenviar" de la agenda); en prueba no
          if (!prueba) { try { await apiFetch(`/agenda-turnos/habilitaciones/${h.id}/enviado`, json('POST', { url: cfg.url_publica })); } catch { /* noop */ } }
        } else setRes(dni, { estado: 'ERROR', detalle: e.detalle || e.estado });
        const quedan = aMandar.slice(i + 1).some(d => m.get(d)?.token);
        if (quedan && !detenerRef.current) await sleep(20000 + Math.random() * 20000);
      }
      await cargarHabs();
      toast.ok('Turnos × tanda', detenerRef.current ? 'Detenido' : 'Terminado');
    } catch (err: any) { toast.error('Habilitar y mandar', err?.message); }
    finally { setEnviando(false); }
  };

  const copiarMensaje = async (h: Hab) => {
    const t = mensaje(h);
    try { await navigator.clipboard.writeText(t); toast.ok('Copiado', 'Mensaje con el enlace'); } catch { window.prompt('Copiá el texto:', t); }
  };

  const nTild = agentes.filter(a => tildados.has(a.dni)).length;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: '0.82rem', marginBottom: 12 }}>
        Tildá los agentes de una tanda y tocá <b>Habilitar y mandar</b>: a cada uno se le genera su enlace personal en la Agenda de turnos y
        le llega por WhatsApp para que elija día y horario. Se manda de a uno con una pausa de 20 a 40 segundos (WhatsApp Web abierto en esta PC,
        con la extensión). Si ya tenía un enlace sin usar, se le manda ese mismo. Los turnos que piden se ven en Agenda de turnos.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.85rem' }}>Tanda</label>
        <select value={tanda} onChange={(e) => setTanda(e.target.value)} style={{ ...sel, minWidth: 220 }} disabled={enviando}>
          <option value="">— elegí una tanda —</option>
          {tandas.map(t => <option key={t} value={t}>{t} ({conteo.get(t) || 0})</option>)}
        </select>
        {tanda && <>
          <label style={{ fontSize: '0.85rem' }}>Ocupación</label>
          <select value={ocupacion} onChange={(e) => setOcupacion(e.target.value)} style={{ ...sel, minWidth: 200 }} disabled={enviando}>
            <option value="">Todas ({deTanda.length})</option>
            {ocupaciones.map(([o, n]) => <option key={o} value={o}>{o} ({n})</option>)}
          </select>
          <label style={{ fontSize: '0.85rem' }}>Ver</label>
          <select value={vista} onChange={(e) => setVista(e.target.value as typeof vista)} style={sel} disabled={enviando}>
            <option value="TODOS">Todos</option>
            <option value="CON_TURNO">Solo con turno</option>
            <option value="SIN_TURNO">Solo sin turno</option>
            <option value="SIN_USAR">Enlace mandado sin usar</option>
          </select>
        </>}
        <label style={{ fontSize: '0.85rem' }}>Agenda</label>
        <select value={agendaId} onChange={(e) => setAgendaId(Number(e.target.value))} style={sel} disabled={enviando}>
          {!agendas.length && <option value={0}>— sin agendas activas —</option>}
          {agendas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <label style={{ fontSize: '0.85rem' }}>Motivo</label>
        <MotivoTurnoSelect value={mot} onChange={setMot} motivos={cfg.motivos} sinMotivoTexto="Que lo elija el agente" style={{ ...sel, minWidth: 200 }} />
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, fontSize: '0.8rem' }}>
        <span style={{ color: tunelOk ? '#4ade80' : tunelOk === false ? '#f87171' : '#94a3b8' }}>
          {tunelOk ? '🟢 Página de turnos en línea' : tunelOk === false ? '🔴 Túnel caído: los enlaces no abren (relanzalo desde Agenda de turnos)' : '⚪ Túnel sin probar'}
          {' '}<button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '1px 6px' }} onClick={() => void probarTunel()}>Probar</button>
        </span>
        <span style={{ color: extVersion ? '#4ade80' : '#fbbf24' }}>
          {extVersion === undefined ? 'Buscando extensión…' : extVersion ? `🧩 Extensión WhatsApp v${extVersion}` : '⚠️ Extensión de WhatsApp no detectada en esta PC'}
        </span>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={prueba} onChange={(e) => setPrueba(e.target.checked)} disabled={enviando} />
          Prueba: mandar todo a
          <input value={destinoPrueba} onChange={(e) => setDestinoPrueba(e.target.value)} placeholder="celular de prueba" style={{ ...sel, width: 150 }} disabled={!prueba || enviando} />
        </label>
      </div>

      {tanda && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <button type="button" className="btn" disabled={enviando} onClick={() => setTildados(new Set(agentes.map(a => a.dni)))}>Tildar todos</button>
            <button type="button" className="btn" disabled={enviando} onClick={() => setTildados(new Set())}>Ninguno</button>
            <button type="button" className="btn" disabled={enviando} onClick={() => setTildados(new Set(agentes.filter(a => !tieneTurno(a.dni)).map(a => a.dni)))}>Solo sin turno</button>
            <span style={{ flex: 1 }} />
            {!enviando
              ? <button type="button" className="btn" disabled={!nTild || !agenda} onClick={() => void habilitarYMandar()}
                  style={{ background: '#16a34a', color: '#fff', fontWeight: 700 }}>📲 Habilitar y mandar ({nTild})</button>
              : <button type="button" className="btn danger" onClick={() => { detenerRef.current = true; }}>⏹ Detener</button>}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
            <thead><tr><th style={{ ...th, width: 30 }} /><th style={th}>Agente</th><th style={th}>Enlace en la agenda</th><th style={th}>Este envío</th><th style={th} /></tr></thead>
            <tbody>
              {agentes.map(a => {
                const h = habs.get(a.dni);
                const res = resultados.get(a.dni);
                return (
                  <React.Fragment key={a.dni}>
                  <tr>
                    <td style={td}><input type="checkbox" checked={tildados.has(a.dni)} disabled={enviando} onChange={(e) => tildar(a.dni, e.target.checked)} /></td>
                    <td style={td}>{a.apellidoNombre}<div className="muted" style={{ fontSize: '0.75rem' }}>DNI {a.dni} · {ocupDe(a)}{h ? ` · ${h.celular ? `cel. ${h.celular}${h.dudoso ? ' (dudoso)' : ''}` : 'sin celular'}` : ''}</div></td>
                    <td style={td}>
                      {!h ? <span className="muted">— sin enlace —</span>
                        : h.estado === 'USADO' ? <span style={{ color: h.turno_estado === 'RESERVADO' ? '#4ade80' : '#94a3b8' }}>Turno {fmt(h.turno_fecha)} {h.turno_hora}{h.turno_estado && h.turno_estado !== 'RESERVADO' ? ` (${h.turno_estado.toLowerCase()})` : ''}</span>
                        : h.estado === 'HABILITADO' ? <span style={{ color: '#fbbf24' }}>Sin usar · vence {fmt(h.vence_el)}{h.reenviar ? ' · 🔁 reenviar' : ''}{h.envios ? <span className="muted"> · enviado {fmtHora(h.enviado_at)}</span> : ''}</span>
                        : <span className="muted">{h.estado.toLowerCase()}</span>}
                      {h?.motivo && <span className="badge" style={{ marginLeft: 6, color: '#c4b5fd' }}>{h.motivo}</span>}
                    </td>
                    <td style={td}>{res && <span style={{ color: COLOR_RES[res.estado] }}>{TXT_RES[res.estado]}{res.detalle ? <span className="muted"> · {res.detalle}</span> : ''}</span>}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn" onClick={() => setAbierto(abierto === a.dni ? null : a.dni)}
                        title="Ver los documentos cargados en DOCU y abrirlos"
                        style={{ background: abierto === a.dni ? '#7c3aed' : undefined, color: abierto === a.dni ? '#fff' : undefined }}>
                        📂 Documentos
                      </button>{' '}
                      {h?.estado === 'HABILITADO' && h.token && <button type="button" className="btn" disabled={!cfg.url_publica} onClick={() => void copiarMensaje(h)} title="Para mandarlo a mano">Copiar mensaje</button>}
                    </td>
                  </tr>
                  {abierto === a.dni && (
                    <tr><td colSpan={5} style={{ padding: '0 8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <DocuBrowser dni={a.dni} />
                    </td></tr>
                  )}
                  </React.Fragment>
                );
              })}
              {!agentes.length && <tr><td style={td} colSpan={5}><span className="muted">{ocupacion ? 'No hay agentes con esa ocupación en la tanda.' : vista !== 'TODOS' ? 'Nadie de la tanda entra en ese filtro.' : 'La tanda no tiene agentes.'}</span></td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

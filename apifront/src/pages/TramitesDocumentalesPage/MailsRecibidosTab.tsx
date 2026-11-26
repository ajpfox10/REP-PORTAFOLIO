import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Pestaña 📧 Mails recibidos (25/11/2026): los mails de la casilla de antecedentes que procesó el
// robot gmail_antecedentes, uno por fila (remitente, fecha, asunto, adjuntos), atados al agente y a
// su tanda. Filtros por tanda, fecha, documento, formato y texto. Los que el robot no pudo atar a
// nadie van arriba ("Sin atar"): se elige el agente y qué es cada adjunto; el adjunto pasa a DOCU
// y el mail del remitente queda cargado en el agente (los próximos mails de esa casilla se atan solos).
// Back: GET /tramites-documentales/mails-recibidos, POST .../asignar, POST .../descartar, PUT .../email, GET .../persona.
// 🚫 No es documentación pedida (26/11): descarta el adjunto (pasa a SIN IDENTIFICAR\descartados) y sale de Sin atar.
// ─────────────────────────────────────────────────────────────────────────────

type Adjunto = {
  id: number; dni: number | null; nombre: string | null; estado: string; tipo: string | null; formato: string | null;
  ruta: string | null; adjunto: string; remitente: string; email: string; asunto: string | null; msgId: string | null;
  fechaMail: string | null; procesado: string; yaEstaba: boolean; pendiente: boolean; existe: boolean;
  motivo: string | null; manual: boolean; carpeta: string | null; descartado?: boolean;
};
type Mail = {
  key: string; msgId: string | null; fechaMail: string | null; procesado: string; remitente: string; email: string;
  asunto: string | null; adjuntos: Adjunto[]; dni: number | null; nombre: string | null; pendientes: number;
  tandas: string[]; emailAgente: string | null; sugerido: number | null;
};
type Tipo = { carpeta: string; archivo: string; tbl: string; etiqueta: string };
type Datos = { mails: Mail[]; tandas: string[]; tipos: Record<string, Tipo> };
type CarpetaDocu = { carpeta: string; documento: string; existe: boolean };
type Tramite = { proceso: string; nombre: string; tanda: string | null; ley: string | null; sinConfigurar: boolean; agrupamiento: string | null };
type Persona = { dni: number; nombre: string; email: string | null; tandas: string[]; carpetas: CarpetaDocu[]; tramite: Tramite | null };

const BORDER = '1px solid rgba(255,255,255,0.1)';
const sel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', border: BORDER, borderRadius: 6, padding: '5px 8px', fontSize: '0.8rem',
};
const btn: React.CSSProperties = { ...sel, cursor: 'pointer' };
const TIPO_COLOR: Record<string, string> = {
  nacional: '#60a5fa', provincial: '#a78bfa', etico: '#f59e0b', matricula: '#22c55e', buena_salud: '#f472b6',
};

function fechaHora(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
function fechaDia(ymd: string | null) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function MailsRecibidosTab() {
  const toast = useToast();
  const [data, setData] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [tanda, setTanda] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState('');
  const [formato, setFormato] = useState('');
  const [estado, setEstado] = useState<'' | 'atados' | 'sin_atar'>('');
  const [texto, setTexto] = useState('');
  const [visor, setVisor] = useState<{ url: string; name: string; type: string } | null>(null);
  const [editEmail, setEditEmail] = useState<{ dni: number; nombre: string | null; email: string } | null>(null);

  async function cargar() {
    setCargando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: Datos }>('/tramites-documentales/mails-recibidos');
      setData(r.data);
    } catch (e: any) {
      toast.error('No se pudieron leer los mails', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (visor) URL.revokeObjectURL(visor.url); }, [visor]);

  async function ver(a: Adjunto) {
    try {
      const { blob, contentType } = await apiFetchBlobWithMeta(`/tramites-documentales/mails-recibidos/archivo?id=${a.id}`);
      setVisor({ url: URL.createObjectURL(blob), name: a.adjunto || a.ruta || '', type: contentType || blob.type });
    } catch (e: any) {
      toast.error('No se pudo abrir el adjunto', e?.message || 'Error');
    }
  }

  const mails = data?.mails || [];
  const tipos = data?.tipos || {};
  const formatos = useMemo(() => [...new Set(mails.flatMap((m) => m.adjuntos.map((a) => a.formato).filter(Boolean) as string[]))].sort(), [mails]);

  const filtrados = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return mails.filter((m) => {
      if (tanda && !m.tandas.includes(tanda)) return false;
      const dia = m.fechaMail || String(m.procesado || '').slice(0, 10);
      if (desde && dia < desde) return false;
      if (hasta && dia > hasta) return false;
      if (tipo === '?' ? !m.adjuntos.some((a) => !a.tipo) : tipo && !m.adjuntos.some((a) => a.tipo === tipo)) return false;
      if (formato && !m.adjuntos.some((a) => a.formato === formato)) return false;
      if (estado === 'sin_atar' && !m.pendientes) return false;
      if (estado === 'atados' && (m.pendientes || !m.dni)) return false;
      if (t && ![m.remitente, m.email, m.asunto, m.nombre, m.dni, ...m.adjuntos.map((a) => a.adjunto)]
        .some((v) => String(v ?? '').toLowerCase().includes(t))) return false;
      return true;
    });
  }, [mails, tanda, desde, hasta, tipo, formato, estado, texto]);

  const sinAtar = filtrados.filter((m) => m.pendientes > 0);
  const atados = filtrados.filter((m) => !m.pendientes);
  const hayFiltro = !!(tanda || desde || hasta || tipo || formato || estado || texto.trim());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
        Mails que llegaron a la casilla de antecedentes y procesó el robot: quién lo mandó, cuándo, el asunto y qué
        adjuntos traía, atados al agente y a su tanda. Los que el robot no pudo atar a nadie aparecen arriba en
        <b style={{ color: '#ef4444' }}> Sin atar</b>: elegí el agente y qué es cada adjunto. El adjunto pasa a su carpeta
        DOCU y el mail del remitente queda cargado en el agente, así los próximos mails de esa dirección se atan solos.
        El asunto se guarda desde el 25/11/2026.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tanda} onChange={(e) => setTanda(e.target.value)} style={sel}>
          <option value="">Todas las tandas</option>
          {(data?.tandas || []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Fecha del mail</span>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ ...sel, colorScheme: 'dark' }} title="Desde" />
        <span style={{ color: '#94a3b8', fontSize: '0.76rem' }}>a</span>
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ ...sel, colorScheme: 'dark' }} title="Hasta" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={sel}>
          <option value="">Todos los documentos</option>
          {Object.entries(tipos).map(([k, t]) => <option key={k} value={k}>{t.archivo}</option>)}
          <option value="?">Sin identificar</option>
        </select>
        <select value={formato} onChange={(e) => setFormato(e.target.value)} style={sel}>
          <option value="">Todos los formatos</option>
          {formatos.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} style={sel}>
          <option value="">Atados y sin atar</option>
          <option value="atados">Solo atados</option>
          <option value="sin_atar">Solo sin atar</option>
        </select>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar remitente, mail, asunto, agente, DNI…" style={{ ...sel, minWidth: 240 }} />
        {hayFiltro ? (
          <button type="button" style={btn} onClick={() => { setTanda(''); setDesde(''); setHasta(''); setTipo(''); setFormato(''); setEstado(''); setTexto(''); }}>✕ Limpiar</button>
        ) : null}
        <button type="button" style={btn} onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Cargando…' : '↻ Actualizar'}</button>
        <span style={{ color: '#cbd5e1', fontSize: '0.76rem' }}>{filtrados.length} mail(s)</span>
      </div>

      {sinAtar.length ? (
        <div style={{ border: '1px solid rgba(239,68,68,0.45)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#fca5a5', fontWeight: 700, fontSize: '0.85rem' }}>⚠️ Sin atar a un agente ({sinAtar.length})</div>
          {sinAtar.map((m) => <MailSinAtar key={m.key} mail={m} tipos={tipos} onVer={ver} onListo={cargar} />)}
        </div>
      ) : null}

      <div style={{ overflowX: 'auto', border: BORDER, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
              {['Fecha del mail', 'Procesado', 'Remitente', 'Asunto', 'Adjuntos', 'Agente', 'Tanda', 'Mail del agente'].map((h) => (
                <th key={h} style={{ padding: '7px 8px', borderBottom: BORDER, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!atados.length ? (
              <tr><td colSpan={8} style={{ padding: 12, color: '#94a3b8' }}>{cargando ? 'Cargando…' : 'No hay mails que coincidan.'}</td></tr>
            ) : atados.map((m) => (
              <tr key={m.key} style={{ borderTop: BORDER, verticalAlign: 'top' }}>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{fechaDia(m.fechaMail)}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: '#94a3b8' }}>{fechaHora(m.procesado)}</td>
                <td style={{ padding: '6px 8px' }}>
                  <div>{m.remitente}</div>
                  {m.email && m.email !== m.remitente ? <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{m.email}</div> : null}
                </td>
                <td style={{ padding: '6px 8px', color: m.asunto ? '#e2e8f0' : '#64748b' }}>{m.asunto ?? '—'}</td>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {m.adjuntos.map((a) => <ChipAdjunto key={a.id} a={a} tipos={tipos} onVer={ver} />)}
                  </div>
                </td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  {m.dni ? <>{m.nombre}<div style={{ color: '#64748b', fontSize: '0.72rem' }}>DNI {m.dni}</div></> : <span style={{ color: '#64748b' }}>—</span>}
                </td>
                <td style={{ padding: '6px 8px' }}>{m.tandas.length ? m.tandas.join(', ') : <span style={{ color: '#64748b' }}>—</span>}</td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  {m.dni ? (
                    <button type="button" onClick={() => setEditEmail({ dni: m.dni!, nombre: m.nombre, email: m.emailAgente || m.email || '' })}
                      style={{ ...btn, padding: '2px 8px', color: m.emailAgente ? '#e2e8f0' : '#f59e0b' }}
                      title="Cargar o modificar el mail del agente">
                      ✏️ {m.emailAgente || 'cargar mail'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editEmail ? <EditarEmail {...editEmail} onClose={() => setEditEmail(null)} onListo={() => { setEditEmail(null); void cargar(); }} /> : null}

      {visor ? (
        <div onClick={() => setVisor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '85vw', height: '90vh', background: '#0f172a', borderRadius: 8, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', color: '#e2e8f0', fontSize: '0.8rem' }}>
              <span>{visor.name}</span>
              <button type="button" style={btn} onClick={() => setVisor(null)}>Cerrar</button>
            </div>
            {visor.type.startsWith('image/')
              ? <div style={{ flex: 1, overflow: 'auto', textAlign: 'center' }}><img src={visor.url} alt={visor.name} style={{ maxWidth: '100%' }} /></div>
              : <iframe src={visor.url} title={visor.name} style={{ flex: 1, border: 'none', background: '#fff' }} />}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChipAdjunto({ a, tipos, onVer }: { a: Adjunto; tipos: Record<string, Tipo>; onVer: (a: Adjunto) => void }) {
  const color = a.descartado ? '#64748b' : a.tipo ? TIPO_COLOR[a.tipo] || '#94a3b8' : '#ef4444';
  const label = a.descartado ? '🚫 No es doc. pedida' : a.tipo ? tipos[a.tipo]?.archivo || a.carpeta || a.tipo : 'Sin identificar';
  return (
    <button type="button" onClick={() => onVer(a)} disabled={!a.existe}
      title={`${a.adjunto}${a.ruta ? `\n→ ${a.ruta}` : ''}${a.yaEstaba ? '\n(ya estaba en DOCU)' : ''}${a.manual ? '\n(atado a mano)' : ''}${a.existe ? '' : '\n(el archivo ya no está ahí)'}`}
      style={{
        border: `1px solid ${color}`, background: `${color}1f`, color: '#e2e8f0', borderRadius: 999, padding: '2px 8px',
        fontSize: '0.72rem', cursor: a.existe ? 'pointer' : 'default', opacity: a.existe ? 1 : 0.5, whiteSpace: 'nowrap',
      }}>
      {label} · {a.formato || '?'}{a.manual ? ' ✋' : ''}
    </button>
  );
}

function MailSinAtar({ mail, tipos, onVer, onListo }: { mail: Mail; tipos: Record<string, Tipo>; onVer: (a: Adjunto) => void; onListo: () => void }) {
  const toast = useToast();
  const pendientes = mail.adjuntos.filter((a) => a.pendiente);
  const inicial = mail.dni || mail.sugerido;
  const [dni, setDni] = useState(inicial ? String(inicial) : '');
  const [persona, setPersona] = useState<Persona | null>(null);
  const [email, setEmail] = useState(mail.email || '');
  const [tipoDe, setTipoDe] = useState<Record<number, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [descartando, setDescartando] = useState<number | 'todos' | null>(null);

  async function descartar(ids: number[], cual: number | 'todos') {
    const txt = ids.length === 1 ? 'este adjunto' : `los ${ids.length} adjuntos de este mail`;
    if (!window.confirm(`¿Descartar ${txt}? No es documentación pedida: no pasa a DOCU y sale de "Sin atar" (el archivo se guarda en SIN IDENTIFICAR\\descartados).`)) return;
    setDescartando(cual);
    try {
      const r = await apiFetch<{ ok: boolean; data: { hechos: { ok: boolean; error?: string }[] } }>(
        '/tramites-documentales/mails-recibidos/descartar', { method: 'POST', body: JSON.stringify({ ids }) });
      const malos = r.data.hechos.filter((h) => !h.ok);
      if (malos.length) toast.error('Algunos adjuntos no se pudieron descartar', malos.map((h) => h.error).join(' · '));
      else toast.ok('Descartado', `${r.data.hechos.length} adjunto(s): no es documentación pedida`);
      onListo();
    } catch (e: any) {
      toast.error('No se pudo descartar', e?.message || 'Error');
    } finally {
      setDescartando(null);
    }
  }

  async function buscar(d = dni) {
    setPersona(null);
    if (!/^\d{6,9}$/.test(d.trim())) return;
    try {
      const r = await apiFetch<{ ok: boolean; data: Persona }>(`/tramites-documentales/mails-recibidos/persona?dni=${d.trim()}`);
      setPersona(r.data);
      // las carpetas dependen del agente: lo elegido para otro agente no vale
      setTipoDe((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => (r.data.carpetas || []).some((x) => x.carpeta === v))));
    } catch (e: any) {
      toast.error('No encontré el agente', e?.message || 'Error');
    }
  }
  useEffect(() => { if (inicial) void buscar(String(inicial)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const listo = !!persona && pendientes.every((a) => tipoDe[a.id]);

  async function atar() {
    if (!persona) return;
    setGuardando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: { hechos: { ok: boolean; error?: string }[]; otros: { dni: number; nombre: string }[] } }>(
        '/tramites-documentales/mails-recibidos/asignar', {
          method: 'POST',
          body: JSON.stringify({ dni: persona.dni, email: email.trim(), adjuntos: pendientes.map((a) => ({ id: a.id, carpeta: tipoDe[a.id] })) }),
        });
      const malos = r.data.hechos.filter((h) => !h.ok);
      if (malos.length) toast.error('Algunos adjuntos no se pudieron atar', malos.map((h) => h.error).join(' · '));
      else toast.ok('Mail atado', `${persona.nombre}: ${r.data.hechos.length} adjunto(s) a DOCU`);
      if (r.data.otros?.length) toast.error('Ojo: ese mail también lo tiene otro agente', r.data.otros.map((o) => `${o.nombre} (${o.dni})`).join(', '));
      onListo();
    } catch (e: any) {
      toast.error('No se pudo atar el mail', e?.message || 'Error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ border: BORDER, borderRadius: 8, padding: 10, background: 'rgba(239,68,68,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.8rem', color: '#e2e8f0' }}>
        <span>📅 {fechaDia(mail.fechaMail)} <span style={{ color: '#64748b' }}>(procesado {fechaHora(mail.procesado)})</span></span>
        <span>✉️ {mail.remitente}{mail.email && mail.email !== mail.remitente ? <span style={{ color: '#94a3b8' }}> &lt;{mail.email}&gt;</span> : null}</span>
        <span style={{ color: mail.asunto ? '#e2e8f0' : '#64748b' }}>Asunto: {mail.asunto ?? '—'}</span>
      </div>
      {pendientes.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.78rem' }}>
          <button type="button" style={{ ...btn, padding: '2px 8px' }} onClick={() => onVer(a)} disabled={!a.existe}>👁️ Ver</button>
          <span style={{ minWidth: 220 }}>{a.adjunto} <span style={{ color: '#64748b' }}>· {a.formato}</span></span>
          {a.motivo ? <span style={{ color: '#fca5a5', fontSize: '0.72rem' }}>{a.motivo}</span> : null}
          <select value={tipoDe[a.id] || ''} onChange={(e) => setTipoDe((c) => ({ ...c, [a.id]: e.target.value }))} style={sel} disabled={!persona}
            title={persona ? 'Carpetas DOCU que le corresponden al agente según su nombramiento y su trámite' : 'Elegí el agente primero'}>
            <option value="">{persona ? '— ¿Qué documento es? —' : '— Elegí el agente primero —'}</option>
            {(persona?.carpetas || []).map((c) => <option key={c.carpeta} value={c.carpeta}>{c.carpeta}{c.existe ? '' : ' (se crea)'}</option>)}
          </select>
          <button type="button" onClick={() => void descartar([a.id], a.id)} disabled={descartando !== null || guardando}
            style={{ ...btn, padding: '2px 8px', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.45)' }}
            title="No es documentación pedida: se descarta, no pasa a DOCU y sale de Sin atar">
            {descartando === a.id ? 'Descartando…' : '🚫 No es documentación pedida'}
          </button>
          {!a.existe ? <span style={{ color: '#f59e0b', fontSize: '0.72rem' }}>el archivo ya no está en SIN IDENTIFICAR</span> : null}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Agente</span>
        <input value={dni} onChange={(e) => { setDni(e.target.value.replace(/\D/g, '')); setPersona(null); }} onBlur={() => void buscar()}
          onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} placeholder="DNI" inputMode="numeric" style={{ ...sel, width: 110 }} />
        {persona && !mail.dni && mail.sugerido === persona.dni ? (
          <span style={{ color: '#22c55e', fontSize: '0.72rem' }} title="Ya llegó otro mail de esta misma dirección que quedó atado a este agente">💡 sugerido por otro mail del mismo remitente</span>
        ) : null}
        {persona ? (
          <span style={{ fontSize: '0.78rem', color: '#e2e8f0' }}>
            {persona.nombre} <span style={{ color: '#64748b' }}>· {persona.tandas.length ? persona.tandas.join(', ') : 'sin tanda'}{persona.email ? ` · mail cargado: ${persona.email}` : ''}</span>
          </span>
        ) : null}
        {persona?.tramite ? (
          <span style={{ fontSize: '0.72rem', color: persona.tramite.sinConfigurar ? '#f59e0b' : '#94a3b8' }}
            title="Las opciones de ¿Qué documento es? salen de lo que lleva este trámite (pestaña Documentos por trámite) y del nombramiento del agente">
            📋 {persona.tramite.nombre}
            {persona.tramite.ley ? ` · ley ${persona.tramite.ley}` : ''}
            {persona.tramite.agrupamiento ? ` · ${persona.tramite.agrupamiento.toLowerCase()}` : ''}
            {persona.tramite.sinConfigurar ? ' · el trámite no tiene documentos cargados: uso la lista de designación' : ''}
          </span>
        ) : null}
        <span style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Mail a guardar en el agente</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mail@ejemplo.com" style={{ ...sel, minWidth: 220 }} />
        <button type="button" onClick={() => void atar()} disabled={!listo || guardando}
          style={{ ...btn, background: listo ? '#7c3aed' : undefined, color: listo ? '#fff' : undefined, border: listo ? 'none' : BORDER }}>
          {guardando ? 'Guardando…' : '🔗 Atar y pasar a DOCU'}
        </button>
        {pendientes.length > 1 ? (
          <button type="button" onClick={() => void descartar(pendientes.map((a) => a.id), 'todos')} disabled={descartando !== null || guardando}
            style={{ ...btn, color: '#fca5a5', border: '1px solid rgba(239,68,68,0.45)' }} title="Descartar todos los adjuntos de este mail">
            {descartando === 'todos' ? 'Descartando…' : '🚫 Descartar todo el mail'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EditarEmail({ dni, nombre, email: inicial, onClose, onListo }: { dni: number; nombre: string | null; email: string; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    setGuardando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: { otros: { dni: number; nombre: string }[] } }>('/tramites-documentales/mails-recibidos/email', {
        method: 'PUT', body: JSON.stringify({ dni, email: email.trim() }),
      });
      toast.ok('Mail guardado', `${nombre || dni}: ${email.trim() || '(sin mail)'}`);
      if (r.data.otros?.length) toast.error('Ojo: ese mail también lo tiene otro agente', r.data.otros.map((o) => `${o.nombre} (${o.dni})`).join(', '));
      onListo();
    } catch (e: any) {
      toast.error('No se pudo guardar el mail', e?.message || 'Error');
    } finally {
      setGuardando(false);
    }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#1e1b4b', border: BORDER, borderRadius: 10, padding: 16, minWidth: 380, display: 'flex', flexDirection: 'column', gap: 10, color: '#e2e8f0' }}>
        <div style={{ fontWeight: 700 }}>Mail de {nombre || ''} <span style={{ color: '#64748b', fontWeight: 400 }}>· DNI {dni}</span></div>
        <input autoFocus value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void guardar(); }}
          placeholder="mail@ejemplo.com (vacío = borrar)" style={sel} />
        <div style={{ color: '#94a3b8', fontSize: '0.74rem' }}>Los mails que lleguen desde esta dirección se atan solos a este agente.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={btn} onClick={onClose}>Cancelar</button>
          <button type="button" style={{ ...btn, background: '#7c3aed', color: '#fff', border: 'none' }} onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

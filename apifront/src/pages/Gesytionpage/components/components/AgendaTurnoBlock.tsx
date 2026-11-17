import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../../api/http';
import { useToast } from '../../../../ui/toast';
import { aExtension } from '../../../LicenciasMedicasControlPage/WhatsappTab';
import { MotivoTurnoSelect, MotivoValor, MOTIVO_VACIO, motivoBody, motivoCompleto } from '../../../../components/MotivoTurno';

// La extensión deja el mensaje escrito sin enviar desde la 1.8.0. Con una más vieja NO se usa
// (mandaría el mensaje sola): se abre el chat por teléfono y el Enviar lo toca la persona.
const EXT_MIN = '1.8.0';
const verMayorIgual = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return true;
};
const palabrasDe = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z]+/).filter(w => w.length > 1);

// Ficha de Gestión → Info, abajo de la última anual/complementaria: dar turno al agente.
// "Dar turno" lo habilita en la agenda → enlace único (sirve para UN solo turno) → WhatsApp o copiar.
// Backend: GET /agenda-turnos/agente/:dni, POST /agenda-turnos/habilitaciones, POST .../:id/anular (mig 122).

interface Hab { id: number; token: string | null; estado: 'HABILITADO' | 'USADO' | 'VENCIDO' | 'ANULADO'; vence_el: string; turno_fecha: string | null; turno_hora: string | null; turno_estado: string | null; motivo: string | null }
interface AgendaAg { id: number; nombre: string; lugar: string | null; mensaje_whatsapp: string | null; habilitacion: Hab | null; turno: { fecha: string; hora: string; origen: string; motivo: string | null } | null }
interface Resp {
  agente: { dni: number; apellido: string; nombre: string; activo: boolean; celular: string | null; dudoso: boolean };
  agendas: AgendaAg[]; url_publica: string; plantilla: string; motivos?: string[];
  url_publica_temporal?: boolean; url_publica_desde?: string | null;
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const fmt = (f?: string | null) => (f ? f.split('-').reverse().join('/') : '');
const dia = (f: string) => `${DIAS[new Date(`${f}T12:00:00`).getDay()]} ${fmt(f).slice(0, 5)}`;
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaLargo = (f: string) => `${DIAS_LARGOS[new Date(`${f}T12:00:00`).getDay()]} ${fmt(f)}`;
const tc = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const btn: React.CSSProperties = {
  padding: '4px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b',
  color: '#e2e8f0', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
};

export function AgendaTurnoBlock({ dni }: { dni: string }) {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState(false);
  const [abriendo, setAbriendo] = useState(false);   // la extensión está buscando el chat
  const [url, setUrl] = useState('');
  const [mot, setMot] = useState<MotivoValor>(MOTIVO_VACIO);   // motivo del próximo "Dar turno"

  const cargar = async () => {
    try { const r = await apiFetch<any>(`/agenda-turnos/agente/${dni}`); setData(r.data); setError(null); }
    catch (e: any) { setError(e?.message || 'No se pudo leer la agenda'); }
  };
  useEffect(() => { setData(null); if (dni) void cargar(); }, [dni]);

  if (error) return null;           // sin permiso o sin tablas: no ensucia la ficha
  if (!data) return null;

  const link = (h: Hab) => (h.token && data.url_publica ? `${data.url_publica.replace(/\/+$/, '')}/t/${h.token}` : '');
  const mensaje = (a: AgendaAg, h: Hab) => (a.mensaje_whatsapp || data.plantilla)
    .replace(/\{NOMBRE\}/g, tc(data.agente.nombre || ''))
    .replace(/\{APELLIDO\}/g, tc(data.agente.apellido || ''))
    .replace(/\{AGENDA\}/g, h.motivo || a.nombre)
    .replace(/\{MOTIVO\}/g, h.motivo || '')
    .replace(/\{VENCE\}/g, fmt(h.vence_el))
    .replace(/\{LINK\}/g, link(h));

  // Confirmación del turno ya tomado: día, hora, lugar y el enlace para verlo o cancelarlo
  const confirmacion = (a: AgendaAg) => {
    const t = a.turno!;
    const l = a.habilitacion?.token && a.habilitacion.turno_fecha === t.fecha ? link(a.habilitacion) : '';
    return [
      `Hola ${tc(data.agente.nombre || '')}, le escribimos de la Oficina de Personal del Hospital.`,
      '',
      `Le confirmamos su turno de *${t.motivo || a.nombre}*: ${diaLargo(t.fecha)} a las ${t.hora} h${a.lugar ? `, en ${a.lugar}` : ''}.`,
      ...(l ? ['', 'Para ver o cancelar el turno entre a este enlace:', l] : []),
    ].join('\n');
  };
  // Abre WhatsApp Web, busca al agente (por nombre y, si no está agendado, por el celular de la base)
  // y deja el mensaje ESCRITO. El Enviar lo toca la persona.
  const whatsappTexto = async (texto: string) => {
    const porLinkManual = () => {
      if (!data.agente.celular) { toast.warning('Sin celular', 'No tiene celular en la base: copiá el mensaje y mandalo a mano.'); return; }
      window.open(`https://web.whatsapp.com/send?phone=${data.agente.celular}&text=${encodeURIComponent(texto)}`, 'whatsapp');
    };
    const ping = await aExtension('PING', undefined, 1500).catch(() => ({ ok: false } as any));
    if (!ping.ok || !ping.version || !verMayorIgual(ping.version, EXT_MIN)) {
      if (ping.ok) toast.warning('Extensión vieja', `Tenés la ${ping.version}: se abre por teléfono. Se actualiza sola en unas horas (o bajala de nuevo).`);
      porLinkManual();
      return;
    }
    const ape = palabrasDe(data.agente.apellido), nom = palabrasDe(data.agente.nombre);
    setAbriendo(true);
    try {
      const r = await aExtension('ENVIAR', {
        modo: 'NOMBRE_TELEFONO', buscar: ape[0] || '', palabras: [ape[0], nom[0]].filter(Boolean),
        telefono: data.agente.celular, texto, sinEnviar: true,
      }, 150000);
      if (r.ok) toast.ok('Mensaje escrito en WhatsApp', `Chat de ${r.destino || 'el agente'}: revisalo y tocá Enviar.`);
      else {
        toast.warning('No se pudo abrir el chat', r.detalle || r.estado);
        if (r.estado === 'NO_ENCONTRADO' || r.estado === 'SIN_WHATSAPP') void copiar(texto, 'Mensaje (mandalo a mano)');
      }
    } finally { setAbriendo(false); }
  };

  const habilitar = async (a: AgendaAg) => {
    if (!motivoCompleto(mot, false)) { toast.warning('Motivo', 'Escribí el motivo o elegí otro de la lista.'); return; }
    setOcupado(a.id);
    try {
      const r = await apiFetch<any>('/agenda-turnos/habilitaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agenda_id: a.id, dnis: [Number(dni)], ...motivoBody(mot) }),
      });
      const x = r.data?.[0];
      if (x && !x.ok) toast.warning('No se habilitó', x.motivo || '');
      else toast.ok('Turno habilitado', `${a.nombre}: ya se le puede mandar el enlace`);
      setMot(MOTIVO_VACIO); await cargar();
    } catch (e: any) { toast.error('Agenda de turnos', e?.message); }
    finally { setOcupado(null); }
  };
  const anular = async (a: AgendaAg, h: Hab) => {
    if (!window.confirm(`¿Anular el enlace de ${a.nombre}? Ya no va a poder pedir turno con ese enlace.`)) return;
    try {
      await apiFetch(`/agenda-turnos/habilitaciones/${h.id}/anular`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await cargar();
    } catch (e: any) { toast.error('Anular', e?.message); }
  };
  const guardarUrl = async () => {
    const u = url.trim().replace(/\/+$/, '');
    if (u && !/^https:\/\/[^\s/]+$/i.test(u)) { toast.warning('Dirección', 'Tiene que ser https://dominio (la que da Cloudflare), sin nada después'); return; }
    try {
      await apiFetch('/agenda-turnos/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url_publica: u, plantilla: data.plantilla }),
      });
      toast.ok('Guardado', u ? `Los enlaces salen con ${u}` : 'Dirección borrada');
      setEditUrl(false); await cargar();
    } catch (e: any) { toast.error('Dirección pública', e?.message); }
  };
  const copiar = async (texto: string, que: string) => {
    try { await navigator.clipboard.writeText(texto); toast.ok('Copiado', que); } catch { window.prompt('Copiá el texto:', texto); }
  };
  const whatsapp = (a: AgendaAg, h: Hab) => void whatsappTexto(mensaje(a, h));

  return (
    <div className="agente-servicio-block">
      <span className="agente-servicio-title">Agenda de turnos</span>
      {/* Dirección pública de la página de turnos (la publica el túnel de Cloudflare). Es una sola para todas las agendas. */}
      <div style={{ fontSize: '0.72rem', marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {editUrl || !data.url_publica ? (
          <>
            <span style={{ color: data.url_publica ? '#94a3b8' : '#fbbf24' }}>🌐 Dirección pública (Cloudflare):</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://turnos.tudominio.com.ar"
              style={{ ...btn, cursor: 'text', minWidth: 210, flex: 1 }} />
            <button type="button" style={btn} onClick={() => void guardarUrl()} disabled={!url.trim() && !data.url_publica}>Guardar</button>
            {data.url_publica && <button type="button" style={btn} onClick={() => setEditUrl(false)}>Cancelar</button>}
            {!data.url_publica && <span style={{ color: '#64748b', width: '100%' }}>Sin esto los enlaces no se pueden armar. Va el dominio que se conecte al túnel de Cloudflare.</span>}
          </>
        ) : (
          <>
            <span style={{ color: '#64748b' }}>🌐 Enlaces por Cloudflare: <span style={{ color: '#94a3b8' }}>{data.url_publica}</span></span>
            <button type="button" style={{ ...btn, padding: '1px 6px', fontSize: '0.68rem' }} onClick={() => { setUrl(data.url_publica); setEditUrl(true); }}>cambiar</button>
            {data.url_publica_temporal && (
              <span style={{ color: '#fbbf24', width: '100%' }}>
                ⚠ Dirección temporal (sin dominio), vigente desde {data.url_publica_desde ? new Date(data.url_publica_desde).toLocaleString('es-AR', { hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}.
                Si el servidor se reinicia cambia sola: los enlaces mandados antes dejan de abrir → reenviá con 📲 WhatsApp (el turno elegido no se pierde).
              </span>
            )}
          </>
        )}
      </div>
      {!data.agendas.length && (
        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>No hay agendas activas (se crean en Herramientas → 📆 Agenda de turnos).</div>
      )}
      {!data.agente.activo && !!data.agendas.length && (
        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Solo se puede dar turno a agentes activos.</div>
      )}
      {data.agente.activo && data.agendas.map(a => {
        const h = a.habilitacion;
        const sinUsar = h?.estado === 'HABILITADO';
        return (
          <div key={a.id} className="agente-mini-card" style={{ marginBottom: 6 }}>
            <span className="agente-mini-label" style={{ color: '#22d3ee' }}>{a.nombre}</span>
            {a.turno ? (
              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', marginTop: 3 }}>
                ✅ Turno el <b style={{ textTransform: 'capitalize' }}>{dia(a.turno.fecha)}</b> a las <b>{a.turno.hora}</b>
                {a.turno.motivo && <> · <b style={{ color: '#c4b5fd' }}>{a.turno.motivo}</b></>}
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}> · {a.turno.origen === 'ENLACE' ? 'lo pidió por el enlace' : 'cargado en la oficina'}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <button type="button" style={btn} disabled={abriendo} onClick={() => void whatsappTexto(confirmacion(a))}
                    title={data.agente.celular ? `Confirmación por WhatsApp a ${data.agente.celular}${data.agente.dudoso ? ' (celular dudoso)' : ''}` : 'Sin celular en la base'}>{abriendo ? '⏳ Abriendo WhatsApp…' : '📲 Enviar turno por WhatsApp'}</button>
                  <button type="button" style={btn} onClick={() => void copiar(confirmacion(a), 'Mensaje con el turno')}>Copiar mensaje</button>
                  {a.habilitacion?.token && a.habilitacion.turno_fecha === a.turno.fecha && data.url_publica && (
                    <button type="button" style={btn} onClick={() => void copiar(link(a.habilitacion!), 'Enlace del turno')}>🔗 Copiar enlace</button>
                  )}
                </div>
              </div>
            ) : sinUsar && h ? (
              <>
                <div style={{ fontSize: '0.78rem', color: '#fbbf24', marginTop: 3 }}>
                  🔗 Enlace listo, todavía no eligió turno · vence {fmt(h.vence_el)} · {h.motivo ? <b style={{ color: '#c4b5fd' }}>{h.motivo}</b> : 'el motivo lo elige el agente'}
                </div>
                {!data.url_publica && <div style={{ fontSize: '0.7rem', color: '#f87171', marginTop: 2 }}>Falta la dirección pública (Agenda de turnos → Configurar).</div>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <button type="button" style={btn} disabled={!data.url_publica || abriendo} onClick={() => whatsapp(a, h)}
                    title={data.agente.celular ? `WhatsApp a ${data.agente.celular}${data.agente.dudoso ? ' (celular dudoso)' : ''}` : 'Sin celular en la base'}>{abriendo ? '⏳ Abriendo WhatsApp…' : '📲 WhatsApp'}</button>
                  <button type="button" style={btn} disabled={!data.url_publica} onClick={() => void copiar(mensaje(a, h), 'Mensaje con el enlace')}>Copiar mensaje</button>
                  <button type="button" style={btn} disabled={!data.url_publica} onClick={() => void copiar(link(h), 'Enlace')}>🔗 Copiar enlace</button>
                  <button type="button" style={{ ...btn, color: '#f87171' }} onClick={() => void anular(a, h)}>Anular</button>
                </div>
              </>
            ) : (
              <>
                {h && (
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 3 }}>
                    {h.estado === 'USADO' && h.turno_fecha
                      ? `Último turno: ${fmt(h.turno_fecha)} ${h.turno_hora} (${(h.turno_estado || '').toLowerCase()})`
                      : h.estado === 'VENCIDO' ? `El último enlace venció el ${fmt(h.vence_el)} sin usarse`
                      : h.estado === 'ANULADO' ? 'El último enlace fue anulado' : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <MotivoTurnoSelect value={mot} onChange={setMot} motivos={data.motivos} sinMotivoTexto="Motivo: que lo elija el agente" style={{ ...btn, cursor: 'pointer' }} />
                </div>
                <button type="button" style={{ ...btn, marginTop: 6, background: '#0e7490', borderColor: '#0e7490', fontWeight: 600 }}
                  disabled={ocupado === a.id} onClick={() => void habilitar(a)}>
                  {ocupado === a.id ? 'Habilitando…' : '📆 Dar turno (enlace para elegir UN turno)'}
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

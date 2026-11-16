// src/pages/WhatsappBotPage/index.tsx
// Bot de WhatsApp (API oficial de Meta) — configuración completa. Solo admin.
// Pestañas: Estado · Menú · Textos y horario · Pedidos · Conversaciones · Probar · Conexión.
// Backend: /whatsapp-bot (routes/whatsappBot.routes.ts). El bot corre en el servidor público (/wa/webhook)
// y relee la configuración cada 20 s: lo que se guarda acá se aplica solo.
import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type Accion = 'TEXTO' | 'CERT_IOMA' | 'CERT_TRABAJO' | 'HUMANO' | 'RESET_GP';
const esCert = (a: Accion) => a === 'CERT_IOMA' || a === 'CERT_TRABAJO';
interface Opcion {
  id: number; orden: number; numero: number; titulo: string; palabras: string | null; accion: Accion;
  respuesta: string | null; requiere_agente: number; registrar_pedido: number; activa: number;
}
interface Estado {
  config: Record<string, string>;
  opciones: Opcion[];
  vista_menu: string;
  credenciales: { token: boolean; phone_number_id: string; app_secret: boolean; verify_token: boolean; token_origen: string };
  modo: 'SIMULADO' | 'REAL';
  activo: boolean;
  en_horario: boolean;
  webhook: string;
  hoy: { recibidos: number; enviados: number; errores: number };
  pedidos_pendientes: number;
  chats_con_persona: number;
  tunel_turnos: { url: string; temporal: boolean } | null;
}
interface Pedido {
  id: number; telefono: string; dni: number | null; tipo: string; estado: string; created_at: string;
  atendido_at: string | null; atendido_por: string | null; apellido: string | null; nombre: string | null; nombre_wa: string | null;
}
interface Chat {
  telefono: string; nombre_wa: string | null; dni: number | null; ultimo_in: string; estado: 'HUMANO' | 'MENU';
  humano_hasta: string | null; apellido: string | null; nombre: string | null; ultimo_texto: string | null; mensajes: number;
}
interface Mensaje { id: number; direccion: 'IN' | 'OUT'; tipo: string; texto: string | null; opcion: string | null; estado: string; error: string | null; created_at: string }
interface RespSim { tipo: 'text' | 'document'; texto: string; archivo?: string; pdf_base64?: string }

const ACCIONES: Record<Accion, { label: string; ayuda: string }> = {
  TEXTO: { label: '💬 Responder un texto', ayuda: 'Contesta con el texto de la respuesta.' },
  CERT_IOMA: { label: '📄 Enviar certificado IOMA (PDF)', ayuda: 'Genera el certificado IOMA del agente y se lo manda en PDF. La respuesta es el texto que acompaña al archivo. Solo agentes activos: el bot les pide el DNI y lo valida contra el celular registrado.' },
  CERT_TRABAJO: { label: '📄 Enviar certificado de trabajo (PDF)', ayuda: 'Genera el Certificado de Trabajo (con historial y fin de residencia, el mismo de Certificados) y se lo manda en PDF. La respuesta es el texto que acompaña al archivo. Solo agentes activos validados con DNI + celular registrado.' },
  HUMANO: { label: '🙋 Pasar a una persona', ayuda: 'El bot deja de contestar en ese chat durante las horas configuradas, para que lo atiendan ustedes desde el celular o WhatsApp Web.' },
  RESET_GP: { label: '🔑 Resetear clave de Gestiones Personales (Intranet)', ayuda: 'La respuesta es la PREGUNTA de confirmación. Si contesta SI, el robot de la Intranet le resetea la clave (queda su número de documento) y el bot le avisa el resultado. Solo agentes activos validados con DNI + celular registrado; una vez por día.' },
};

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const input: React.CSSProperties = { padding: '6px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b', color: 'inherit', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' };
const area: React.CSSProperties = { ...input, minHeight: 80, fontFamily: 'inherit', resize: 'vertical' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)' };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem', verticalAlign: 'top' };
const label: React.CSSProperties = { display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: 4, marginTop: 10 };
const json = (method: string, body?: any) => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const fechaHora = (f?: string | null) => {
  if (!f) return '';
  const d = new Date(f);
  return Number.isNaN(d.getTime()) ? String(f) : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const telLindo = (t: string) => (/^549\d{10}$/.test(t) ? `+54 9 ${t.slice(3, 5)} ${t.slice(5, 9)}-${t.slice(9)}` : t);

/** Vista tipo WhatsApp: *negrita* y saltos de línea. */
function Burbuja({ texto, propio, pie }: { texto: string; propio?: boolean; pie?: React.ReactNode }) {
  const partes = texto.split(/(\*[^*\n]+\*)/g);
  return (
    <div style={{ display: 'flex', justifyContent: propio ? 'flex-end' : 'flex-start', margin: '6px 0' }}>
      <div style={{
        maxWidth: '80%', padding: '8px 11px', borderRadius: 10, whiteSpace: 'pre-wrap', fontSize: '0.88rem', lineHeight: 1.4,
        background: propio ? '#065f46' : '#1f2937', border: '1px solid rgba(255,255,255,0.08)',
      }}>
        {partes.map((p, i) => (/^\*[^*\n]+\*$/.test(p) ? <strong key={i}>{p.slice(1, -1)}</strong> : <React.Fragment key={i}>{p}</React.Fragment>))}
        {pie && <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 4, textAlign: 'right' }}>{pie}</div>}
      </div>
    </div>
  );
}

type Tab = 'estado' | 'menu' | 'textos' | 'pedidos' | 'resets' | 'chats' | 'probar' | 'conexion';

export function WhatsappBotPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('estado');
  const [estado, setEstado] = useState<Estado | null>(null);

  const cargar = async () => {
    try { setEstado((await apiFetch<any>('/whatsapp-bot/estado')).data); }
    catch (e: any) { toast.error('Bot de WhatsApp', e?.message || 'No se pudo leer'); }
  };
  useEffect(() => { void cargar(); }, []);

  const guardarConfig = async (valores: Record<string, string | null>, ok = 'Guardado') => {
    try {
      await apiFetch('/whatsapp-bot/config', json('PUT', { valores }));
      toast.ok('Bot de WhatsApp', ok);
      await cargar();
      return true;
    } catch (e: any) { toast.error('Bot de WhatsApp', e?.message || 'No se pudo guardar'); return false; }
  };

  const Pestaña = ({ t, children }: { t: Tab; children: React.ReactNode }) => (
    <button type="button" className="btn" onClick={() => setTab(t)}
      style={{ background: tab === t ? '#16a34a' : undefined, color: tab === t ? '#fff' : undefined, fontWeight: tab === t ? 700 : 400 }}>{children}</button>
  );

  return (
    <Layout title="Bot de WhatsApp" showBack>
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pestaña t="estado">📊 Estado</Pestaña>
          <Pestaña t="menu">📋 Menú</Pestaña>
          <Pestaña t="textos">✏️ Textos y horario</Pestaña>
          <Pestaña t="pedidos">📥 Pedidos{estado?.pedidos_pendientes ? ` (${estado.pedidos_pendientes})` : ''}</Pestaña>
          <Pestaña t="resets">🔑 Reseteos de clave</Pestaña>
          <Pestaña t="chats">💬 Conversaciones</Pestaña>
          <Pestaña t="probar">🧪 Probar</Pestaña>
          <Pestaña t="conexion">🔌 Conexión con Meta</Pestaña>
          <span style={{ flex: 1 }} />
          {estado && (
            <>
              <span className="badge" style={{ color: estado.activo ? '#4ade80' : '#f87171' }}>{estado.activo ? '● Encendido' : '● Apagado'}</span>
              <span className="badge" style={{ color: estado.modo === 'REAL' ? '#4ade80' : '#fbbf24' }}>{estado.modo === 'REAL' ? 'Conectado a Meta' : 'Modo simulación'}</span>
            </>
          )}
        </div>
      </div>

      {!estado && <div className="card" style={{ marginTop: 12, padding: 16 }}>Cargando…</div>}
      {estado && tab === 'estado' && <EstadoTab e={estado} guardar={guardarConfig} ir={setTab} />}
      {estado && tab === 'menu' && <MenuTab e={estado} recargar={cargar} />}
      {estado && tab === 'textos' && <TextosTab e={estado} guardar={guardarConfig} />}
      {estado && tab === 'pedidos' && <PedidosTab onCambio={cargar} />}
      {estado && tab === 'resets' && <ResetsTab />}
      {estado && tab === 'chats' && <ChatsTab onCambio={cargar} />}
      {estado && tab === 'probar' && <ProbarTab e={estado} />}
      {estado && tab === 'conexion' && <ConexionTab e={estado} guardar={guardarConfig} />}
    </Layout>
  );
}

// ─── Estado ──────────────────────────────────────────────────────────────────

function EstadoTab({ e, guardar, ir }: { e: Estado; guardar: (v: Record<string, string | null>, ok?: string) => Promise<boolean>; ir: (t: Tab) => void }) {
  const Dato = ({ titulo, valor, color, onClick }: { titulo: string; valor: React.ReactNode; color?: string; onClick?: () => void }) => (
    <div className="card" onClick={onClick} style={{ padding: 14, cursor: onClick ? 'pointer' : undefined, minWidth: 150, flex: 1 }}>
      <div className="muted" style={{ fontSize: '0.75rem' }}>{titulo}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{valor}</div>
    </div>
  );
  const pasos = [
    { ok: e.credenciales.token && !!e.credenciales.phone_number_id, txt: 'Token y Phone Number ID cargados' },
    { ok: e.credenciales.app_secret, txt: 'App Secret cargado (valida que los mensajes vengan de Meta)' },
    { ok: e.credenciales.verify_token, txt: 'Token de verificación del webhook' },
    { ok: !!e.webhook, txt: 'URL pública (ngrok) cargada' },
  ];
  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <Dato titulo="Mensajes recibidos hoy" valor={e.hoy.recibidos} />
        <Dato titulo="Respuestas enviadas hoy" valor={e.hoy.enviados} color="#4ade80" />
        <Dato titulo="Errores hoy" valor={e.hoy.errores} color={e.hoy.errores ? '#f87171' : undefined} onClick={() => ir('chats')} />
        <Dato titulo="Pedidos pendientes" valor={e.pedidos_pendientes} color={e.pedidos_pendientes ? '#fbbf24' : undefined} onClick={() => ir('pedidos')} />
        <Dato titulo="Chats con una persona" valor={e.chats_con_persona} onClick={() => ir('chats')} />
      </div>

      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Encendido</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Apagado, el bot sigue registrando los mensajes que llegan pero no contesta nada (los atienden ustedes como siempre).
        </p>
        <button type="button" className="btn" style={{ background: e.activo ? '#b91c1c' : '#16a34a', color: '#fff' }}
          onClick={() => { if (!e.activo || window.confirm('¿Apagar el bot? Deja de contestar automáticamente.')) void guardar({ activo: e.activo ? '0' : '1' }, e.activo ? 'Bot apagado' : 'Bot encendido'); }}>
          {e.activo ? '⏻ Apagar bot' : '⏻ Encender bot'}
        </button>
        {e.config.horario_activo === '1' && (
          <span className="muted" style={{ marginLeft: 12, fontSize: '0.85rem' }}>
            {e.en_horario ? '🟢 Ahora es horario de atención' : '🌙 Ahora está fuera del horario de atención'}
          </span>
        )}
      </div>

      <div className="card" style={{ marginTop: 12, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>Conexión con Meta</h3>
          {pasos.map(p => <div key={p.txt} style={{ fontSize: '0.88rem', margin: '4px 0' }}>{p.ok ? '✅' : '⬜'} {p.txt}</div>)}
          {e.modo === 'SIMULADO' && (
            <p style={{ fontSize: '0.85rem', color: '#fbbf24' }}>
              Mientras falten el token o el Phone Number ID, el bot está en <b>simulación</b>: registra lo que contestaría pero no envía nada.
            </p>
          )}
          <button type="button" className="btn" onClick={() => ir('conexion')}>🔌 Configurar conexión</button>
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>Así ve el menú la persona</h3>
          <div style={{ background: '#0b141a', padding: 10, borderRadius: 10 }}><Burbuja texto={e.vista_menu} /></div>
        </div>
      </div>
    </>
  );
}

// ─── Menú ────────────────────────────────────────────────────────────────────

const OPCION_VACIA = { id: 0, titulo: '', palabras: '', accion: 'TEXTO' as Accion, respuesta: '', requiere_agente: 0, registrar_pedido: 0, activa: 1 };

function MenuTab({ e, recargar }: { e: Estado; recargar: () => Promise<void> }) {
  const toast = useToast();
  const [edit, setEdit] = useState<typeof OPCION_VACIA | null>(null);
  const activas = e.opciones.filter(o => Number(o.activa));
  const inactivas = e.opciones.filter(o => !Number(o.activa));

  const mover = async (o: Opcion, delta: number) => {
    const ids = e.opciones.map(x => x.id);
    const i = ids.indexOf(o.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await apiFetch('/whatsapp-bot/opciones-orden', json('PUT', { ids })); await recargar(); }
    catch (err: any) { toast.error('Menú', err?.message); }
  };
  const alternar = async (o: Opcion) => {
    try { await apiFetch(`/whatsapp-bot/opciones/${o.id}`, json('PUT', { ...o, activa: Number(o.activa) ? 0 : 1 })); await recargar(); }
    catch (err: any) { toast.error('Menú', err?.message); }
  };
  const borrar = async (o: Opcion) => {
    if (!window.confirm(`¿Borrar la opción "${o.titulo}"? Si solo querés sacarla un tiempo, mejor desactivala.`)) return;
    try { await apiFetch(`/whatsapp-bot/opciones/${o.id}`, json('DELETE')); toast.ok('Menú', 'Opción borrada'); await recargar(); }
    catch (err: any) { toast.error('Menú', err?.message); }
  };
  const guardar = async () => {
    if (!edit) return;
    try {
      if (edit.id) await apiFetch(`/whatsapp-bot/opciones/${edit.id}`, json('PUT', edit));
      else await apiFetch('/whatsapp-bot/opciones', json('POST', edit));
      toast.ok('Menú', edit.id ? 'Opción guardada' : 'Opción agregada');
      setEdit(null);
      await recargar();
    } catch (err: any) { toast.error('Menú', err?.message); }
  };

  const Fila = ({ o }: { o: Opcion }) => (
    <tr style={{ opacity: Number(o.activa) ? 1 : 0.5 }}>
      <td style={{ ...td, fontWeight: 700, fontSize: '1rem' }}>{Number(o.activa) ? o.numero : '—'}</td>
      <td style={td}>
        <div style={{ fontWeight: 600 }}>{o.titulo}</div>
        {o.palabras && <div className="muted" style={{ fontSize: '0.75rem' }}>También entiende: {o.palabras}</div>}
      </td>
      <td style={td}>
        {ACCIONES[o.accion]?.label ?? o.accion}
        <div className="muted" style={{ fontSize: '0.75rem' }}>
          {[o.requiere_agente || esCert(o.accion) || o.accion === 'RESET_GP' ? 'solo agentes' : '', o.accion === 'RESET_GP' ? 'pide confirmación' : '', o.registrar_pedido ? 'registra pedido' : ''].filter(Boolean).join(' · ')}
        </div>
      </td>
      <td style={{ ...td, maxWidth: 360 }}><div style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', maxHeight: 70, overflow: 'hidden' }}>{o.respuesta}</div></td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <button type="button" className="btn" title="Subir" onClick={() => void mover(o, -1)}>▲</button>{' '}
        <button type="button" className="btn" title="Bajar" onClick={() => void mover(o, 1)}>▼</button>{' '}
        <button type="button" className="btn" onClick={() => setEdit({ ...o, palabras: o.palabras ?? '', respuesta: o.respuesta ?? '' })}>✏️ Editar</button>{' '}
        <button type="button" className="btn" onClick={() => void alternar(o)}>{Number(o.activa) ? '⏸ Desactivar' : '▶ Activar'}</button>{' '}
        <button type="button" className="btn" style={{ color: '#f87171' }} onClick={() => void borrar(o)}>🗑</button>
      </td>
    </tr>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 12, marginTop: 12 }}>
      <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>Opciones del menú</h3>
          <button type="button" className="btn" style={{ background: '#16a34a', color: '#fff' }} onClick={() => setEdit({ ...OPCION_VACIA })}>➕ Agregar opción</button>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          El número que escribe la persona es la posición de la opción entre las activas. Con ▲▼ cambiás el orden.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>N°</th><th style={th}>Opción</th><th style={th}>Qué hace</th><th style={th}>Respuesta</th><th style={th} /></tr></thead>
          <tbody>
            {activas.map(o => <Fila key={o.id} o={o} />)}
            {inactivas.map(o => <Fila key={o.id} o={o} />)}
            {!e.opciones.length && <tr><td style={td} colSpan={5}>No hay opciones. Agregá la primera.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Vista previa</h3>
        <div style={{ background: '#0b141a', padding: 10, borderRadius: 10 }}><Burbuja texto={e.vista_menu} /></div>
      </div>

      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
          onClick={() => setEdit(null)}>
          <div className="card" style={{ padding: 20, width: 'min(640px, 100%)', maxHeight: '90vh', overflowY: 'auto' }} onClick={ev => ev.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{edit.id ? 'Editar opción' : 'Nueva opción'}</h3>
            <label style={label}>Título (lo que se ve en el menú)</label>
            <input style={input} value={edit.titulo} maxLength={80} onChange={ev => setEdit({ ...edit, titulo: ev.target.value })} placeholder="Ej: Recibo de sueldo" />

            <label style={label}>Qué hace</label>
            <select style={input} value={edit.accion} onChange={ev => setEdit({ ...edit, accion: ev.target.value as Accion })}>
              {(Object.keys(ACCIONES) as Accion[]).map(a => <option key={a} value={a}>{ACCIONES[a].label}</option>)}
            </select>
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>{ACCIONES[edit.accion].ayuda}</div>

            <label style={label}>
              {esCert(edit.accion) ? 'Texto que acompaña al PDF' : edit.accion === 'RESET_GP' ? 'Pregunta de confirmación (que pida responder SI)' : 'Respuesta'}
              <span className="muted"> — podés usar {'{nombre}'} (nombre del agente), {'{menu}'}, {'{humano}'} y *negrita*</span>
            </label>
            <textarea style={{ ...area, minHeight: 130 }} value={edit.respuesta} maxLength={3500} onChange={ev => setEdit({ ...edit, respuesta: ev.target.value })} />

            <label style={label}>Palabras que también la eligen (separadas por coma)</label>
            <input style={input} value={edit.palabras} onChange={ev => setEdit({ ...edit, palabras: ev.target.value })} placeholder="Ej: recibo, sueldo, haberes" />

            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: '0.88rem' }}>
              {edit.accion === 'TEXTO' && (
                <label><input type="checkbox" checked={!!edit.requiere_agente} onChange={ev => setEdit({ ...edit, requiere_agente: ev.target.checked ? 1 : 0 })} /> Solo para agentes activos (pide DNI y lo valida con el celular registrado)</label>
              )}
              <label><input type="checkbox" checked={!!edit.registrar_pedido} onChange={ev => setEdit({ ...edit, registrar_pedido: ev.target.checked ? 1 : 0 })} /> Registrar como pedido (aparece en 📥 Pedidos)</label>
              <label><input type="checkbox" checked={!!edit.activa} onChange={ev => setEdit({ ...edit, activa: ev.target.checked ? 1 : 0 })} /> Activa</label>
            </div>

            <h4 style={{ marginBottom: 4 }}>Vista previa de la respuesta</h4>
            <div style={{ background: '#0b141a', padding: 10, borderRadius: 10 }}>
              <Burbuja texto={(edit.accion === 'CERT_IOMA' ? '📄 Certificado_IOMA.pdf\n' : edit.accion === 'CERT_TRABAJO' ? '📄 Certificado_de_trabajo.pdf\n' : '') + (edit.respuesta || '(vacío)').replace(/\{nombre\}/g, 'Juan')} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancelar</button>
              <button type="button" className="btn" style={{ background: '#16a34a', color: '#fff' }} onClick={() => void guardar()}>💾 Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Textos y horario ────────────────────────────────────────────────────────

const TEXTOS: Array<{ k: string; titulo: string; ayuda: string; corto?: boolean }> = [
  { k: 'saludo', titulo: 'Encabezado del menú', ayuda: 'Va arriba de la lista de opciones.' },
  { k: 'pie', titulo: 'Pie del menú (opcional)', ayuda: 'Va abajo de la lista de opciones.' },
  { k: 'texto_preparando', titulo: 'Mientras prepara un documento', ayuda: 'Se manda antes del PDF (tarda unos segundos).' },
  { k: 'texto_pedir_dni', titulo: '🔒 Pedido de DNI', ayuda: 'Se manda SIEMPRE que elige una opción solo para agentes.' },
  { k: 'texto_dni_invalido', titulo: '🔒 DNI mal escrito', ayuda: 'No son 7 u 8 números (no cuenta como intento).' },
  { k: 'texto_dni_no_coincide', titulo: '🔒 DNI que no coincide', ayuda: 'El DNI no es de un agente activo o el celular desde el que escribe no es el registrado para ese DNI (no se dice cuál de las dos).' },
  { k: 'texto_dni_bloqueado', titulo: '🔒 Demasiados intentos', ayuda: 'Al llegar al máximo de intentos el chat queda bloqueado para las opciones de agentes.' },
  { k: 'texto_error', titulo: 'Si algo falla', ayuda: 'Por ejemplo, si no se pudo generar el PDF.' },
  { k: 'texto_derivar', titulo: 'Cómo hablar con una persona', ayuda: 'Se agrega a los avisos anteriores. {humano} = número de la opción "pasar a una persona".' },
  { k: 'texto_volver_menu', titulo: 'Cómo volver al menú', ayuda: 'Se agrega cuando pasa a una persona. {menu} = palabra para volver.' },
  { k: 'texto_solo_texto', titulo: 'Mandó audio, foto, etc.', ayuda: 'Va antes del menú.' },
  { k: 'texto_fuera_horario', titulo: 'Fuera del horario de atención', ayuda: 'Se agrega cuando pide hablar con una persona fuera de horario.' },
  { k: 'palabras_si', titulo: '🔑 Reseteo: palabras que cuentan como SI', ayuda: 'Separadas por coma. Cualquier otra respuesta cancela.' },
  { k: 'reset_encolado', titulo: '🔑 Reseteo: cuando confirma', ayuda: 'Se manda apenas dice SI (el robot tarda unos minutos).' },
  { k: 'reset_ok', titulo: '🔑 Reseteo: salió bien', ayuda: 'Cuando el robot terminó y la clave quedó en el DNI.' },
  { k: 'reset_ya_provisoria', titulo: '🔑 Reseteo: ya tenía clave provisoria', ayuda: 'La cuenta ya estaba con la clave = DNI.' },
  { k: 'reset_sin_cuenta', titulo: '🔑 Reseteo: no tiene cuenta', ayuda: 'No hay cuenta de Gestiones Personales con ese DNI (se agrega cómo hablar con una persona).' },
  { k: 'reset_en_curso', titulo: '🔑 Reseteo: ya está en proceso', ayuda: 'Lo vuelve a pedir mientras el robot no terminó.' },
  { k: 'reset_ya_hecho', titulo: '🔑 Reseteo: ya se hizo hoy', ayuda: 'Una vez por día por agente.' },
  { k: 'reset_cancelado', titulo: '🔑 Reseteo: no confirmó', ayuda: 'Va antes del menú.' },
];

function TextosTab({ e, guardar }: { e: Estado; guardar: (v: Record<string, string | null>, ok?: string) => Promise<boolean> }) {
  const [v, setV] = useState<Record<string, string>>({ ...e.config });
  useEffect(() => setV({ ...e.config }), [e.config]);
  const dias = useMemo(() => String(v.horario_dias || '').split(',').map(x => Number(x)).filter(x => !Number.isNaN(x)), [v.horario_dias]);
  const cambiados = useMemo(() => {
    const ks = ['palabra_menu', 'humano_horas', 'dni_max_intentos', 'dni_bloqueo_min', 'horario_activo', 'horario_desde', 'horario_hasta', 'horario_dias', ...TEXTOS.map(t => t.k)];
    return Object.fromEntries(ks.filter(k => (v[k] ?? '') !== (e.config[k] ?? '')).map(k => [k, v[k] ?? '']));
  }, [v, e.config]);
  const n = Object.keys(cambiados).length;

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, flex: 1 }}>Textos y horario</h3>
        <button type="button" className="btn" disabled={!n} onClick={() => setV({ ...e.config })}>Descartar</button>
        <button type="button" className="btn" disabled={!n} style={{ background: n ? '#16a34a' : undefined, color: n ? '#fff' : undefined }}
          onClick={() => void guardar(cambiados, `${n} cambio(s) guardado(s)`)}>💾 Guardar{n ? ` (${n})` : ''}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 8 }}>
        <div>
          <label style={label}>Palabra para volver al menú</label>
          <input style={input} value={v.palabra_menu ?? ''} onChange={ev => setV({ ...v, palabra_menu: ev.target.value })} />
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>"menu" y "0" también funcionan siempre.</div>
        </div>
        <div>
          <label style={label}>Horas que el bot se calla al pasar a una persona</label>
          <input style={input} type="number" min={1} max={168} value={v.humano_horas ?? ''} onChange={ev => setV({ ...v, humano_horas: ev.target.value })} />
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>Se puede liberar antes desde 💬 Conversaciones.</div>
        </div>
        <div>
          <label style={label}>🔒 Intentos de DNI antes de bloquear · minutos de bloqueo</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={input} type="number" min={1} max={10} value={v.dni_max_intentos ?? ''} onChange={ev => setV({ ...v, dni_max_intentos: ev.target.value })} />
            <input style={input} type="number" min={1} max={1440} value={v.dni_bloqueo_min ?? ''} onChange={ev => setV({ ...v, dni_bloqueo_min: ev.target.value })} />
          </div>
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>Las opciones de agentes siempre piden DNI y lo comparan con el celular registrado en la base.</div>
        </div>
        <div>
          <label style={label}>
            <input type="checkbox" checked={v.horario_activo === '1'} onChange={ev => setV({ ...v, horario_activo: ev.target.checked ? '1' : '0' })} />{' '}
            Usar horario de atención
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: v.horario_activo === '1' ? 1 : 0.5 }}>
            <input style={{ ...input, width: 110 }} type="time" value={v.horario_desde ?? ''} onChange={ev => setV({ ...v, horario_desde: ev.target.value })} />
            a
            <input style={{ ...input, width: 110 }} type="time" value={v.horario_hasta ?? ''} onChange={ev => setV({ ...v, horario_hasta: ev.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6, opacity: v.horario_activo === '1' ? 1 : 0.5 }}>
            {DIAS.map((d, i) => {
              const on = dias.includes(i);
              return (
                <button key={d} type="button" className="btn" style={{ padding: '3px 8px', background: on ? '#2563eb' : undefined, color: on ? '#fff' : undefined }}
                  onClick={() => setV({ ...v, horario_dias: (on ? dias.filter(x => x !== i) : [...dias, i]).sort().join(',') })}>{d}</button>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>El bot contesta igual las 24 h; el horario solo agrega el aviso al pedir una persona.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginTop: 8 }}>
        {TEXTOS.map(t => (
          <div key={t.k}>
            <label style={label}>{t.titulo} {(v[t.k] ?? '') !== (e.config[t.k] ?? '') && <span style={{ color: '#fbbf24' }}>● sin guardar</span>}</label>
            <textarea style={area} value={v[t.k] ?? ''} onChange={ev => setV({ ...v, [t.k]: ev.target.value })} />
            <div className="muted" style={{ fontSize: '0.75rem' }}>{t.ayuda}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────

function PedidosTab({ onCambio }: { onCambio: () => Promise<void> }) {
  const toast = useToast();
  const [filtro, setFiltro] = useState('PENDIENTE');
  const [rows, setRows] = useState<Pedido[]>([]);
  const cargar = async () => {
    try { setRows((await apiFetch<any>(`/whatsapp-bot/pedidos?estado=${filtro}`)).data || []); }
    catch (e: any) { toast.error('Pedidos', e?.message); }
  };
  useEffect(() => { void cargar(); }, [filtro]);
  const marcar = async (p: Pedido, estado: string) => {
    try { await apiFetch(`/whatsapp-bot/pedidos/${p.id}`, json('PUT', { estado })); await cargar(); await onCambio(); }
    catch (e: any) { toast.error('Pedidos', e?.message); }
  };
  return (
    <div className="card" style={{ marginTop: 12, padding: 16, overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Pedidos</h3>
        <select style={{ ...input, width: 'auto' }} value={filtro} onChange={ev => setFiltro(ev.target.value)}>
          <option value="PENDIENTE">Pendientes</option><option value="ATENDIDO">Atendidos</option><option value="TODOS">Todos</option>
        </select>
        <button type="button" className="btn" onClick={() => void cargar()}>↻</button>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem' }}>Lo que pidió la gente en opciones que "registran pedido" (por ejemplo la clave o hablar con una persona). Atendelo por WhatsApp y marcalo.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Fecha</th><th style={th}>Pedido</th><th style={th}>Quién</th><th style={th}>Celular</th><th style={th}>Estado</th><th style={th} /></tr></thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id}>
              <td style={td}>{fechaHora(p.created_at)}</td>
              <td style={td}>{p.tipo}</td>
              <td style={td}>
                {p.dni ? <>{p.apellido} {p.nombre} <span className="muted">({p.dni})</span></> : <span className="muted">No identificado</span>}
                {p.nombre_wa && <div className="muted" style={{ fontSize: '0.75rem' }}>WhatsApp: {p.nombre_wa}</div>}
              </td>
              <td style={td}><a href={`https://wa.me/${p.telefono}`} target="_blank" rel="noreferrer">{telLindo(p.telefono)}</a></td>
              <td style={td}>
                {p.estado}
                {p.atendido_at && <div className="muted" style={{ fontSize: '0.75rem' }}>{fechaHora(p.atendido_at)} {p.atendido_por}</div>}
              </td>
              <td style={td}>
                {p.estado === 'PENDIENTE'
                  ? <button type="button" className="btn" style={{ background: '#16a34a', color: '#fff' }} onClick={() => void marcar(p, 'ATENDIDO')}>✓ Atendido</button>
                  : <button type="button" className="btn" onClick={() => void marcar(p, 'PENDIENTE')}>↩ Pendiente</button>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td style={td} colSpan={6}>No hay pedidos {filtro === 'PENDIENTE' ? 'pendientes' : ''}.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─── Reseteos de clave de Gestiones Personales ───────────────────────────────

interface Reset {
  id: number; dni: number; telefono: string; estado: string; detalle: string | null; created_at: string;
  lanzado_at: string | null; procesado_at: string | null; avisado: number; avisado_at: string | null;
  apellido: string | null; nombre: string | null;
}
const COLOR_RESET: Record<string, string> = {
  PENDIENTE: '#fbbf24', PROCESANDO: '#60a5fa', OK: '#4ade80', YA_PROVISORIA: '#4ade80', SIN_CUENTA: '#f59e0b', ERROR: '#f87171', SIMULADO: '#94a3b8',
};
const AVISO = ['Falta avisar', 'Avisado por WhatsApp', 'No se avisó (pasaron 24 h) → pedido', 'Falló el aviso'];

function ResetsTab() {
  const toast = useToast();
  const [rows, setRows] = useState<Reset[]>([]);
  const [ult, setUlt] = useState<{ estado: string; motivo: string | null; actualizado_at: string } | null>(null);
  const cargar = async () => {
    try { const r = await apiFetch<any>('/whatsapp-bot/resets'); setRows(r.data || []); setUlt(r.ultima_corrida); }
    catch (e: any) { toast.error('Reseteos', e?.message); }
  };
  useEffect(() => { void cargar(); const t = setInterval(() => void cargar(), 30_000); return () => clearInterval(t); }, []);
  const reintentar = async (r: Reset) => {
    try { await apiFetch(`/whatsapp-bot/resets/${r.id}/reintentar`, json('POST')); toast.ok('Reseteos', 'Vuelve a la cola: el robot se lanza en unos segundos'); await cargar(); }
    catch (e: any) { toast.error('Reseteos', e?.message); }
  };
  return (
    <div className="card" style={{ marginTop: 12, padding: 16, overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Reseteos de clave de Gestiones Personales</h3>
        <button type="button" className="btn" onClick={() => void cargar()}>↻</button>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Pedidos que confirmaron por WhatsApp. El robot <code>intranet_gp_resetear</code> (página Robots) los procesa esperando su turno de la Intranet y el bot les avisa el resultado.
        {ult && <> Última corrida: <b style={{ color: ult.estado === 'ok' ? '#4ade80' : '#f87171' }}>{ult.estado}</b> {fechaHora(ult.actualizado_at)} — {ult.motivo}</>}
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Pedido</th><th style={th}>Agente</th><th style={th}>Estado</th><th style={th}>Detalle del robot</th><th style={th}>Aviso</th><th style={th} /></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={td}>{fechaHora(r.created_at)}{r.lanzado_at && <div className="muted" style={{ fontSize: '0.72rem' }}>robot lanzado {fechaHora(r.lanzado_at)}</div>}</td>
              <td style={td}>{r.apellido} {r.nombre} <span className="muted">({r.dni})</span><div className="muted" style={{ fontSize: '0.75rem' }}>{telLindo(r.telefono)}</div></td>
              <td style={td}><span className="badge" style={{ color: COLOR_RESET[r.estado] || '#e2e8f0' }}>{r.estado}</span>{r.procesado_at && <div className="muted" style={{ fontSize: '0.72rem' }}>{fechaHora(r.procesado_at)}</div>}</td>
              <td style={{ ...td, fontSize: '0.8rem', maxWidth: 380 }}>{r.detalle}</td>
              <td style={{ ...td, fontSize: '0.8rem' }}>{['PENDIENTE', 'PROCESANDO'].includes(r.estado) ? '—' : AVISO[r.avisado] ?? r.avisado}{r.avisado_at && <div className="muted" style={{ fontSize: '0.72rem' }}>{fechaHora(r.avisado_at)}</div>}</td>
              <td style={td}>{['ERROR', 'PROCESANDO'].includes(r.estado) && <button type="button" className="btn" onClick={() => void reintentar(r)}>↻ Reintentar</button>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td style={td} colSpan={6}>Todavía no hay pedidos de reseteo.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─── Conversaciones ──────────────────────────────────────────────────────────

function ChatsTab({ onCambio }: { onCambio: () => Promise<void> }) {
  const toast = useToast();
  const [chats, setChats] = useState<Chat[]>([]);
  const [sel, setSel] = useState<Chat | null>(null);
  const [msgs, setMsgs] = useState<Mensaje[]>([]);
  const [buscar, setBuscar] = useState('');
  const cargar = async () => {
    try { setChats((await apiFetch<any>('/whatsapp-bot/chats')).data || []); }
    catch (e: any) { toast.error('Conversaciones', e?.message); }
  };
  useEffect(() => { void cargar(); }, []);
  useEffect(() => {
    if (!sel) return;
    apiFetch<any>(`/whatsapp-bot/chats/${sel.telefono}/mensajes`).then(r => setMsgs(r.data || [])).catch((e: any) => toast.error('Mensajes', e?.message));
  }, [sel?.telefono]);
  const liberar = async (c: Chat) => {
    try {
      await apiFetch(`/whatsapp-bot/chats/${c.telefono}/liberar`, json('POST'));
      toast.ok('Conversaciones', 'El bot vuelve a contestar en ese chat');
      await cargar(); await onCambio();
      if (sel?.telefono === c.telefono) setSel({ ...c, estado: 'MENU' });
    } catch (e: any) { toast.error('Conversaciones', e?.message); }
  };
  const b = buscar.toLowerCase();
  const lista = chats.filter(c => !b || `${c.telefono} ${c.nombre_wa ?? ''} ${c.apellido ?? ''} ${c.nombre ?? ''} ${c.dni ?? ''}`.toLowerCase().includes(b));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', gap: 12, marginTop: 12 }}>
      <div className="card" style={{ padding: 12, maxHeight: '70vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={input} placeholder="Buscar nombre, DNI o número…" value={buscar} onChange={ev => setBuscar(ev.target.value)} />
          <button type="button" className="btn" onClick={() => void cargar()}>↻</button>
        </div>
        {lista.map(c => (
          <div key={c.telefono} onClick={() => setSel(c)}
            style={{ padding: '8px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', background: sel?.telefono === c.telefono ? 'rgba(22,163,74,0.15)' : undefined }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <b style={{ flex: 1 }}>{c.dni ? `${c.apellido} ${c.nombre}` : (c.nombre_wa || telLindo(c.telefono))}</b>
              {c.estado === 'HUMANO' && <span className="badge" style={{ color: '#fbbf24' }}>🙋 persona</span>}
            </div>
            <div className="muted" style={{ fontSize: '0.75rem' }}>{telLindo(c.telefono)} · {fechaHora(c.ultimo_in)}</div>
            {c.ultimo_texto && <div className="muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.ultimo_texto}</div>}
          </div>
        ))}
        {!lista.length && <div className="muted" style={{ padding: 8 }}>Todavía no hay conversaciones.</div>}
      </div>

      <div className="card" style={{ padding: 12 }}>
        {!sel && <div className="muted">Elegí una conversación.</div>}
        {sel && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, flex: 1 }}>{sel.dni ? `${sel.apellido} ${sel.nombre} (${sel.dni})` : (sel.nombre_wa || telLindo(sel.telefono))}</h3>
              <a className="btn" href={`https://wa.me/${sel.telefono}`} target="_blank" rel="noreferrer">Abrir en WhatsApp</a>
              {sel.estado === 'HUMANO' && <button type="button" className="btn" onClick={() => void liberar(sel)}>🤖 Devolver al bot</button>}
            </div>
            {sel.estado === 'HUMANO' && <div style={{ color: '#fbbf24', fontSize: '0.82rem', marginTop: 4 }}>Con una persona: el bot no contesta hasta {fechaHora(sel.humano_hasta)}.</div>}
            <div style={{ background: '#0b141a', padding: 10, borderRadius: 10, marginTop: 10, maxHeight: '60vh', overflowY: 'auto' }}>
              {msgs.map(m => (
                <Burbuja key={m.id} texto={m.texto || `(${m.tipo})`} propio={m.direccion === 'OUT'}
                  pie={<>{fechaHora(m.created_at)}{m.estado !== 'OK' && <> · <span style={{ color: m.estado === 'ERROR' ? '#f87171' : '#fbbf24' }}>{m.estado}</span></>}{m.error && <div style={{ color: '#f87171' }}>{m.error}</div>}</>} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Probar ──────────────────────────────────────────────────────────────────

function ProbarTab({ e }: { e: Estado }) {
  const toast = useToast();
  const [dni, setDni] = useState('');
  const [texto, setTexto] = useState('');
  const [log, setLog] = useState<Array<{ propio: boolean; r: RespSim }>>([]);
  const [info, setInfo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (t = texto) => {
    if (!t.trim() || enviando) return;
    setEnviando(true);
    setLog(l => [...l, { propio: true, r: { tipo: 'text', texto: t } }]);
    setTexto('');
    try {
      const r = (await apiFetch<any>('/whatsapp-bot/simular', json('POST', { texto: t, dni: Number(dni) || null }))).data;
      const ESTADOS: Record<string, string> = {
        HUMANO: ' · chat con una persona: el bot no contesta', PIDE_DNI: ' · esperando el DNI',
        CONFIRMA: ' · esperando SI/NO', BLOQUEADO: ' · BLOQUEADO por intentos de DNI',
      };
      setInfo(`${r.desde
        ? `Escribiendo desde el celular registrado de ${r.desde.nombre} (${r.desde.dni})${r.desde.celular ? `: ${telLindo(r.desde.celular)}` : ' — NO TIENE CELULAR CARGADO'}${r.desde.activo ? '' : ' — DADO DE BAJA'}`
        : 'Escribiendo desde un número que no está registrado'}${ESTADOS[r.estado_chat] ?? ''}${r.bot_activo ? '' : ' · BOT APAGADO'}`);
      if (!r.respuestas.length) setLog(l => [...l, { propio: false, r: { tipo: 'text', texto: '(el bot no contesta)' } }]);
      else setLog(l => [...l, ...r.respuestas.map((x: RespSim) => ({ propio: false, r: x }))]);
    } catch (err: any) { toast.error('Probar', err?.message); }
    finally { setEnviando(false); }
  };
  const limpiar = async () => {
    try { await apiFetch('/whatsapp-bot/simular/limpiar', json('POST')); setLog([]); setInfo(''); toast.ok('Probar', 'Pruebas borradas'); }
    catch (err: any) { toast.error('Probar', err?.message); }
  };
  const abrirPdf = (r: RespSim) => {
    const bytes = Uint8Array.from(atob(r.pdf_base64 || ''), ch => ch.charCodeAt(0));
    window.open(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), '_blank');
  };

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Probar el bot</h3>
      <p className="muted" style={{ fontSize: '0.82rem' }}>
        Escribí como si fueras una persona. Corre la misma lógica que el bot real pero <b>no manda nada por WhatsApp</b>.
        Arriba elegís <b>desde qué celular</b> escribís: el registrado de un agente (por su DNI) o, vacío, un número desconocido.
        Las opciones de agentes te van a pedir el DNI en el chat: probá con el mismo DNI (pasa) y con otro (no coincide).
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...input, width: 260 }} placeholder="Celular registrado del DNI… (opcional)" value={dni} onChange={ev => setDni(ev.target.value.replace(/\D/g, ''))} />
        <button type="button" className="btn" onClick={() => void limpiar()}>🧹 Borrar pruebas</button>
        <span className="muted" style={{ fontSize: '0.8rem' }}>{info}</span>
      </div>
      <div style={{ background: '#0b141a', padding: 10, borderRadius: 10, marginTop: 10, minHeight: 220, maxHeight: '55vh', overflowY: 'auto' }}>
        {!log.length && <div className="muted" style={{ fontSize: '0.85rem' }}>Escribí "hola" para ver el menú.</div>}
        {log.map((x, i) => x.r.tipo === 'document'
          ? <Burbuja key={i} texto={`📄 ${x.r.archivo}\n${x.r.texto}`} pie={<button type="button" className="btn" style={{ padding: '2px 8px' }} onClick={() => abrirPdf(x.r)}>Ver PDF</button>} />
          : <Burbuja key={i} texto={x.r.texto} propio={x.propio} />)}
        {enviando && <div className="muted" style={{ fontSize: '0.8rem' }}>escribiendo…</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input style={input} placeholder="Mensaje…" value={texto} onChange={ev => setTexto(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') void enviar(); }} />
        <button type="button" className="btn" style={{ background: '#16a34a', color: '#fff' }} disabled={enviando} onClick={() => void enviar()}>Enviar</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {['hola', ...e.opciones.filter(o => Number(o.activa)).map(o => String(o.numero)), ...(dni ? [dni] : []), 'si', e.config.palabra_menu || 'MENU'].map(t => (
          <button key={t} type="button" className="btn" style={{ padding: '3px 10px' }} disabled={enviando} onClick={() => void enviar(t)}>{t}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Conexión con Meta ───────────────────────────────────────────────────────

function ConexionTab({ e, guardar }: { e: Estado; guardar: (v: Record<string, string | null>, ok?: string) => Promise<boolean> }) {
  const toast = useToast();
  const [v, setV] = useState<Record<string, string>>({
    wa_phone_number_id: e.config.wa_phone_number_id || '', url_publica: e.config.url_publica || '',
    wa_graph_version: e.config.wa_graph_version || 'v23.0', wa_token: '', wa_app_secret: '', wa_verify_token: '',
  });
  const [prueba, setPrueba] = useState<string>('');

  const guardarTodo = async () => {
    const ok = await guardar({
      wa_phone_number_id: v.wa_phone_number_id, url_publica: v.url_publica, wa_graph_version: v.wa_graph_version,
      wa_token: v.wa_token, wa_app_secret: v.wa_app_secret, wa_verify_token: v.wa_verify_token,
    }, 'Conexión guardada');
    if (ok) setV(x => ({ ...x, wa_token: '', wa_app_secret: '', wa_verify_token: '' }));
  };
  const probar = async () => {
    setPrueba('Probando…');
    try {
      const d = (await apiFetch<any>('/whatsapp-bot/probar-conexion', json('POST'))).data;
      setPrueba(`✅ Conectado: ${d.display_phone_number ?? ''} — ${d.verified_name ?? ''}${d.quality_rating ? ` · calidad ${d.quality_rating}` : ''}`);
    } catch (err: any) { setPrueba(`❌ ${err?.message || 'No conectó'}`); }
  };
  const borrarSecreto = async (k: string) => {
    if (!window.confirm('¿Borrar este dato? Si también está en el .env, se va a usar el del .env.')) return;
    await guardar({ [k]: null }, 'Borrado');
  };
  const generarVerify = () => {
    const a = new Uint8Array(18); crypto.getRandomValues(a);
    setV(x => ({ ...x, wa_verify_token: Array.from(a, n => n.toString(16).padStart(2, '0')).join('') }));
  };
  const copiar = (t: string) => { void navigator.clipboard.writeText(t).then(() => toast.ok('Copiado', t)); };

  // función (no componente): si fuera componente, el input se re-montaría en cada tecla y perdería el foco
  const secreto = ({ k, titulo, cargado, ayuda, extra }: { k: string; titulo: string; cargado: boolean; ayuda: string; extra?: React.ReactNode }) => (
    <div key={k}>
      <label style={label}>{titulo} {cargado ? <span style={{ color: '#4ade80' }}>✓ cargado {e.config[k] && `(${e.config[k]})`}</span> : <span style={{ color: '#f87171' }}>falta</span>}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={input} type={k === 'wa_verify_token' ? 'text' : 'password'} autoComplete="off" value={v[k]} placeholder={cargado ? 'Dejar vacío para no cambiarlo' : ''}
          onChange={ev => setV({ ...v, [k]: ev.target.value })} />
        {extra}
        {e.config[k] && <button type="button" className="btn" title="Borrar" onClick={() => void borrarSecreto(k)}>🗑</button>}
      </div>
      <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>{ayuda}</div>
    </div>
  );

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Conexión con Meta (API oficial)</h3>
        <button type="button" className="btn" onClick={() => void probar()}>🔎 Probar conexión</button>
        <button type="button" className="btn" style={{ background: '#16a34a', color: '#fff' }} onClick={() => void guardarTodo()}>💾 Guardar</button>
      </div>
      {prueba && <div style={{ marginTop: 8, fontSize: '0.88rem' }}>{prueba}</div>}
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Los datos secretos no se vuelven a mostrar; solo se ve si están cargados. Si un dato está vacío acá, se usa el del archivo .env del servidor.
        La guía completa está en <code>apipersonal/docs/WHATSAPP_BOT.md</code>.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div>
          <label style={label}>Phone Number ID {e.credenciales.phone_number_id ? <span style={{ color: '#4ade80' }}>✓</span> : <span style={{ color: '#f87171' }}>falta</span>}</label>
          <input style={input} value={v.wa_phone_number_id} onChange={ev => setV({ ...v, wa_phone_number_id: ev.target.value.replace(/\D/g, '') })} />
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>developers.facebook.com → tu app → WhatsApp → Configuración de la API.</div>
        </div>
        {secreto({
          k: 'wa_token', titulo: 'Token permanente', cargado: e.credenciales.token,
          ayuda: `Configuración del negocio → Usuarios del sistema → Generar token.${e.credenciales.token_origen === 'env' ? ' Ahora se usa el del .env.' : ''}`,
        })}
        {secreto({ k: 'wa_app_secret', titulo: 'App Secret', cargado: e.credenciales.app_secret, ayuda: 'Tu app → Configuración → Básica → Clave secreta de la app.' })}
        {secreto({
          k: 'wa_verify_token', titulo: 'Token de verificación del webhook', cargado: e.credenciales.verify_token,
          ayuda: 'Lo inventamos nosotros. Generalo, guardalo y pegá el MISMO en Meta al configurar el webhook.',
          extra: <button type="button" className="btn" onClick={generarVerify}>🎲 Generar</button>,
        })}
        <div>
          <label style={label}>URL pública (ngrok)</label>
          <input style={input} value={v.url_publica} placeholder="https://tu-dominio.ngrok-free.app" onChange={ev => setV({ ...v, url_publica: ev.target.value })} />
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>El túnel apunta al servidor público (3010 en dev, 3011 en prod).</div>
          {e.tunel_turnos && (
            <div style={{ fontSize: '0.78rem', marginTop: 6, color: e.tunel_turnos.temporal ? '#fbbf24' : '#4ade80' }}>
              Túnel de la Agenda de turnos: <code>{e.tunel_turnos.url}</code>{' '}
              {e.tunel_turnos.temporal
                ? '— es temporal (cambia cada vez que se reinicia), así que no conviene para Meta: usá una dirección fija.'
                : <button type="button" className="btn" style={{ padding: '2px 8px' }} onClick={() => setV({ ...v, url_publica: e.tunel_turnos!.url })}>Usar esta</button>}
            </div>
          )}
        </div>
        <div>
          <label style={label}>Versión de la API de Meta</label>
          <input style={input} value={v.wa_graph_version} onChange={ev => setV({ ...v, wa_graph_version: ev.target.value })} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 12, background: 'rgba(22,163,74,0.08)' }}>
        <b>Para cargar en Meta</b> (tu app → WhatsApp → Configuración → Webhook):
        <div style={{ marginTop: 8, fontSize: '0.88rem' }}>
          URL de devolución de llamada:{' '}
          {e.webhook ? <><code>{e.webhook}</code> <button type="button" className="btn" style={{ padding: '2px 8px' }} onClick={() => copiar(e.webhook)}>📋</button></> : <span className="muted">cargá y guardá la URL pública</span>}
        </div>
        <div style={{ marginTop: 4, fontSize: '0.88rem' }}>Token de verificación: el que guardaste arriba.</div>
        <div style={{ marginTop: 4, fontSize: '0.88rem' }}>Campos del webhook: suscribirse a <b>messages</b>.</div>
      </div>
    </div>
  );
}

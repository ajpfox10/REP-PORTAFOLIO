// src/pages/LegajoPage/RecibidosEnlace.tsx
// Legajo por enlace (mig 138) — lo que mandaron los agentes desde el enlace, para revisar y aprobar.
// Aprobar usa la misma lógica del importador del Formulario de Google: completa lo vacío del legajo,
// agrega familiares y bienes que falten; "pisar" es opcional. También: devolver para corregir, anular,
// y mandar enlaces por tanda (lista de DNIs). El importador del Formulario de Google sigue aparte.
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { escribirWhatsapp, copiarConAviso } from '../../utils/whatsappAgente';
import { linkLegajo, mensajeLegajo } from './LegajoEnlaceBlock';

const CAMPOS: Record<string, string> = {
  nac_pais: 'País nac.', nac_provincia: 'Provincia nac.', nac_partido: 'Partido nac.', estado_civil: 'Estado civil',
  clase: 'Clase', dist_militar: 'Dist. militar', cedula_nro: 'Cédula', cedula_expedida_por: 'Cédula expedida por',
  carta_ciudadania: 'Carta ciudadanía', carta_otorgada_en: 'Carta otorgada en', carta_fecha: 'Fecha carta',
  carta_juez_federal: 'Juez federal', estudios_nivel: 'Nivel estudios', estudios_detalle: 'Detalle estudios',
  titulo_secundario: 'Título sec.', titulo_secundario_otorgado: 'Título sec. otorgado por',
  titulo_terciario: 'Título terciario', titulo_terciario_otorgado: 'Título terciario otorgado por',
  titulo_universitario: 'Título univ.', titulo_universitario_otorgado: 'Título univ. otorgado por',
  aptitud_especial: 'Aptitud especial', mil_presto: 'Servicio militar', mil_arma: 'Arma',
  mil_especialidad: 'Especialidad mil.', mil_grado: 'Grado', mil_destino: 'Destino mil.',
  mil_motivo_excepcion: 'Motivo excepción',
};
const ESTADO: Record<string, { label: string; color: string }> = {
  ENVIADO: { label: '📥 Para revisar', color: '#22d3ee' },
  HABILITADO: { label: '🔗 Esperando al agente', color: '#fbbf24' },
  DEVUELTO: { label: '↩️ Devuelto para corregir', color: '#fb923c' },
  APROBADO: { label: '✅ Cargado al legajo', color: '#34d399' },
  VENCIDO: { label: 'Vencido', color: 'rgba(255,255,255,0.4)' },
  ANULADO: { label: 'Anulado', color: 'rgba(255,255,255,0.4)' },
};
const FILTROS: [string, string][] = [['', 'Abiertos'], ['ENVIADO', 'Para revisar'], ['APROBADO', 'Aprobados'], ['TODOS', 'Todos']];
const fmt = (f?: string | null) => (f ? f.slice(0, 10).split('-').reverse().join('/') + (f.length > 10 ? ` ${f.slice(11, 16)}` : '') : '');
const boton = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 });
const chico: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b', color: '#e2e8f0', fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap' };

interface Fila {
  id: number; dni: number; apellido: string; nombre: string; estado: string; token: string | null; vence_el: string; creado: string;
  guardado_at: string | null; enviado_at: string | null; revisado_at: string | null; devolucion_motivo: string | null;
  resumen: any; empezo: boolean; celular: string | null; dudoso: boolean;
}
interface Config { url_publica: string; plantilla: string; plantillaDefault: string; dias_default: number }

export function RecibidosEnlace({ onClose, onAprobado }: { onClose: () => void; onAprobado: (dni: number) => void }) {
  const toast = useToast();
  const [filtro, setFiltro] = useState('');
  const [rows, setRows] = useState<Fila[]>([]);
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cargando, setCargando] = useState(false);
  const [revisar, setRevisar] = useState<Fila | null>(null);
  const [vista, setVista] = useState<'lista' | 'tanda' | 'mensaje'>('lista');

  const cargar = async () => {
    setCargando(true);
    try {
      const [l, c] = await Promise.all([
        apiFetch<any>(`/legajo/enlace/lista${filtro ? `?estado=${filtro}` : ''}`),
        cfg ? Promise.resolve(null) : apiFetch<any>('/legajo/enlace/config'),
      ]);
      setRows(l.data.rows); setConteo(l.data.conteo);
      if (c) setCfg(c.data);
    } catch (e: any) { toast.error('Recibidos por enlace', e?.message); }
    finally { setCargando(false); }
  };
  useEffect(() => { void cargar(); }, [filtro]);

  const accion = async (url: string, body: any, ok: string) => {
    try {
      await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      toast.ok(ok); setRevisar(null); await cargar();
    } catch (e: any) { toast.error('Legajo por enlace', e?.message); }
  };
  const msg = (r: { nombre: string; apellido: string; token: string | null; vence_el: string }) =>
    cfg && r.token ? mensajeLegajo(cfg.plantilla, r, cfg.url_publica, r.token, r.vence_el) : '';

  const th: React.CSSProperties = { padding: '5px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1e1e2e', borderRadius: 12, padding: 22, width: '100%', maxWidth: 1150, maxHeight: '90vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: '0.95rem' }}>📥 Legajo por enlace: lo que completaron los agentes</strong>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        </div>
        <div className="muted" style={{ fontSize: '0.76rem', marginBottom: 10 }}>
          El agente completa sus datos desde el enlace (hoja 1, familia, incompatibilidad, bienes y DJ). Nada pasa al legajo hasta que se aprueba acá:
          se completan los datos vacíos, se agregan los familiares y bienes que falten y la incompatibilidad si no hay una.
          {cfg && !cfg.url_publica && <span style={{ color: '#fbbf24' }}> ⚠ Falta la dirección pública (Agenda de turnos → Configurar): sin eso no se arman los enlaces.</span>}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          {FILTROS.map(([k, l]) => (
            <button key={k} onClick={() => { setVista('lista'); setFiltro(k); }}
              style={{ ...chico, ...(vista === 'lista' && filtro === k ? { background: '#2563eb', borderColor: '#2563eb' } : {}) }}>
              {l}{k === 'ENVIADO' && conteo.ENVIADO ? ` (${conteo.ENVIADO})` : ''}
              {k === '' ? ` (${(conteo.HABILITADO || 0) + (conteo.ENVIADO || 0) + (conteo.DEVUELTO || 0)})` : ''}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => setVista('tanda')} style={{ ...chico, ...(vista === 'tanda' ? { background: '#4338ca', borderColor: '#4338ca' } : {}) }}>📝 Mandar a varios (tanda)</button>
          <button onClick={() => setVista('mensaje')} style={{ ...chico, ...(vista === 'mensaje' ? { background: '#4338ca', borderColor: '#4338ca' } : {}) }}>✉️ Mensaje de WhatsApp</button>
        </div>

        {vista === 'tanda' && cfg && <Tanda cfg={cfg} onListo={() => { void cargar(); }} />}
        {vista === 'mensaje' && cfg && <EditarMensaje cfg={cfg} onGuardado={c => { setCfg(c); setVista('lista'); }} />}

        {vista === 'lista' && (
          cargando ? <div className="muted">⏳ Cargando…</div> : !rows.length ? <div className="muted" style={{ fontSize: '0.82rem' }}>No hay enlaces en esta lista.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead><tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={th}>Agente</th><th style={th}>DNI</th><th style={th}>Estado</th><th style={th}>Fechas</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const est = ESTADO[r.estado] ?? { label: r.estado, color: '#fff' };
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={td}>{r.apellido}, {r.nombre}</td>
                        <td style={td}>{r.dni}</td>
                        <td style={{ ...td, color: est.color }}>
                          {est.label}
                          {r.estado === 'HABILITADO' && <div className="muted" style={{ fontSize: '0.7rem' }}>{r.empezo ? `empezó a completarlo (${fmt(r.guardado_at)})` : 'todavía no lo abrió / no cargó nada'}</div>}
                          {r.estado === 'DEVUELTO' && <div className="muted" style={{ fontSize: '0.7rem' }}>{r.devolucion_motivo}</div>}
                          {r.estado === 'APROBADO' && r.resumen && <div className="muted" style={{ fontSize: '0.7rem' }}>
                            {r.resumen.datos} dato(s), {r.resumen.familiares} familiar(es), {r.resumen.bienes} bien(es){r.resumen.incompatibilidad ? ', incompatibilidad' : ''}
                          </div>}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <div>Enviado el enlace: {fmt(r.creado)}</div>
                          {r.enviado_at && <div>Lo completó: {fmt(r.enviado_at)}</div>}
                          {['HABILITADO', 'DEVUELTO'].includes(r.estado) && <div className="muted">Vence: {fmt(r.vence_el)}</div>}
                          {r.revisado_at && <div className="muted">Revisado: {fmt(r.revisado_at)}</div>}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {r.estado === 'ENVIADO' && <button style={boton('#2563eb')} onClick={() => setRevisar(r)}>Revisar</button>}
                            {r.token && cfg?.url_publica && <>
                              <button style={chico} title={r.celular ? `WhatsApp a ${r.celular}` : 'Sin celular en la base'}
                                onClick={() => void escribirWhatsapp(toast, r, msg(r))}>📲 Recordar</button>
                              <button style={chico} onClick={() => void copiarConAviso(toast, linkLegajo(cfg.url_publica, r.token!), 'Enlace')}>🔗</button>
                            </>}
                            {['HABILITADO', 'DEVUELTO', 'ENVIADO'].includes(r.estado) && (
                              <button style={{ ...chico, color: '#f87171' }} onClick={() => {
                                if (window.confirm(`¿Anular el enlace de ${r.apellido}? Lo que haya cargado no se pasa al legajo.`)) void accion(`/legajo/enlace/${r.id}/anular`, {}, 'Anulado');
                              }}>Anular</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      {revisar && (
        <Revisar fila={revisar} onClose={() => setRevisar(null)}
          onAprobar={async pisar => {
            await accion(`/legajo/enlace/${revisar.id}/aprobar`, { pisar }, 'Cargado al legajo');
            onAprobado(revisar.dni);
          }}
          onDevolver={motivo => accion(`/legajo/enlace/${revisar.id}/devolver`, { motivo }, 'Devuelto: el agente puede corregir con el mismo enlace')} />
      )}
    </div>
  );
}

// ── Revisar uno ─────────────────────────────────────────────────────────────
function Revisar({ fila, onClose, onAprobar, onDevolver }: {
  fila: Fila; onClose: () => void; onAprobar: (pisar: boolean) => Promise<void>; onDevolver: (motivo: string) => Promise<void>;
}) {
  const toast = useToast();
  const [d, setD] = useState<{ plan: any; respuestas: Record<string, string> } | null>(null);
  const [pisar, setPisar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [verTodo, setVerTodo] = useState(false);
  useEffect(() => {
    apiFetch<any>(`/legajo/enlace/${fila.id}/previa`).then(r => setD(r.data)).catch(e => toast.error('Revisar', e?.message));
  }, [fila.id]);
  const p = d?.plan;
  const ok = p?.estado === 'OK';
  const sec: React.CSSProperties = { margin: '12px 0 4px', fontSize: '0.72rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' };
  const correr = async (fn: () => Promise<void>) => { setOcupado(true); try { await fn(); } finally { setOcupado(false); } };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && !ocupado && onClose()}>
      <div style={{ background: '#181826', borderRadius: 12, padding: 22, width: '100%', maxWidth: 820, maxHeight: '88vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.82rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{fila.apellido}, {fila.nombre} · DNI {fila.dni}</strong>
          <button onClick={onClose} disabled={ocupado} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
        </div>
        <div className="muted" style={{ fontSize: '0.74rem' }}>Lo completó el {fmt(fila.enviado_at)}{fila.celular ? ` · WhatsApp en la base: ${fila.celular}` : ''}{d?.respuestas?.WhatsApp ? ` · WhatsApp que dejó: ${d.respuestas.WhatsApp}` : ''}</div>

        {!d ? <div className="muted" style={{ marginTop: 12 }}>⏳ Cargando…</div> : !ok ? (
          <div style={{ color: '#f87171', marginTop: 12 }}>No se puede cargar: {p?.estado}</div>
        ) : (
          <>
            <div style={sec}>Datos personales que se completan (estaban vacíos)</div>
            {Object.keys(p.datosNuevos).length || p.completarNacimiento ? (
              <div>
                {p.completarNacimiento && <div>Fecha de nacimiento: <b>{fmt(p.completarNacimiento)}</b></div>}
                {Object.entries(p.datosNuevos).map(([k, v]) => <div key={k}>{CAMPOS[k] ?? k}: <b>{String(v)}</b></div>)}
              </div>
            ) : <div className="muted">Ninguno.</div>}

            {p.conflictos.length > 0 && <>
              <div style={sec}>Distinto a lo que ya está cargado (solo se cambia si tildás "pisar")</div>
              {p.conflictos.map((c: any) => (
                <div key={c.campo} style={{ color: '#fbbf24' }}>{CAMPOS[c.campo] ?? c.campo}: <s>{String(c.actual)}</s> → <b>{String(c.nuevo)}</b></div>
              ))}
            </>}

            <div style={sec}>Familiares</div>
            {p.familiaNueva.length ? p.familiaNueva.map((f: any, i: number) => (
              <div key={i}>➕ {f.parentesco} · <b>{f.apellido_nombres}</b>{f.dni_familiar ? ` · DNI ${f.dni_familiar}` : ''}{f.fecha_nacimiento ? ` · nac. ${fmt(f.fecha_nacimiento)}` : ''}{f.vive === 0 ? ' · falleció' : ''}</div>
            )) : <div className="muted">Ninguno nuevo.</div>}
            {p.familiaYaCargada > 0 && <div className="muted">{p.familiaYaCargada} ya estaba(n) cargado(s).</div>}

            <div style={sec}>Incompatibilidad</div>
            <div>{p.incompatibilidad === 'NUEVA' ? 'Se carga la declaración' : p.incompatibilidad === 'EXISTE' ? <span style={{ color: '#fbbf24' }}>Ya tiene una cargada: solo se reemplaza si tildás "pisar"</span> : '—'}</div>

            <div style={sec}>Bienes</div>
            {p.bienesNuevos.length ? p.bienesNuevos.map((b: string, i: number) => <div key={i}>➕ {b}</div>) : <div className="muted">Ninguno nuevo.</div>}

            {p.avisos.length > 0 && <>
              <div style={sec}>Avisos</div>
              {p.avisos.map((a: string, i: number) => <div key={i} style={{ color: '#fbbf24' }}>⚠ {a}</div>)}
            </>}

            <button style={{ ...chico, marginTop: 12 }} onClick={() => setVerTodo(v => !v)}>{verTodo ? 'Ocultar' : 'Ver'} todo lo que respondió</button>
            {verTodo && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: '0.75rem' }}>
                <tbody>{Object.entries(d.respuestas).map(([k, v]) => (
                  <tr key={k} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '3px 6px', color: 'rgba(255,255,255,0.55)', width: '45%' }}>{k}</td>
                    <td style={{ padding: '3px 6px', whiteSpace: 'pre-wrap' }}>{v}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 16, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={pisar} onChange={e => setPisar(e.target.checked)} />
                Pisar con lo del agente los datos distintos (y reemplazar la incompatibilidad existente)
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button style={boton('#16a34a')} disabled={ocupado} onClick={() => void correr(() => onAprobar(pisar))}>✅ Aprobar y cargar al legajo</button>
                <span style={{ flex: 1 }} />
                <input className="input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Qué tiene que corregir (le aparece en el enlace)"
                  style={{ minWidth: 260, flex: 1 }} maxLength={500} />
                <button style={boton('#c2410c')} disabled={ocupado || !motivo.trim()} onClick={() => void correr(() => onDevolver(motivo.trim()))}>↩️ Devolver para corregir</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Tanda: varios DNIs de una ───────────────────────────────────────────────
function Tanda({ cfg, onListo }: { cfg: Config; onListo: () => void }) {
  const toast = useToast();
  const [texto, setTexto] = useState('');
  const [dias, setDias] = useState(cfg.dias_default || 15);
  const [res, setRes] = useState<any[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const dnis = [...new Set((texto.match(/\d[\d.]{5,11}/g) ?? []).map(s => s.replace(/\D/g, '')).filter(s => s.length >= 7 && s.length <= 9))];
  const generar = async () => {
    setOcupado(true);
    try {
      const r = await apiFetch<any>('/legajo/enlace/habilitar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dnis: dnis.map(Number), dias }) });
      setRes(r.data); onListo();
      toast.ok('Enlaces listos', `${r.data.filter((x: any) => x.ok).length} de ${r.data.length}`);
    } catch (e: any) { toast.error('Tanda', e?.message); }
    finally { setOcupado(false); }
  };
  const msg = (x: any) => mensajeLegajo(cfg.plantilla, x, cfg.url_publica, x.token, x.vence_el);
  const oks = (res ?? []).filter(x => x.ok && x.token && x.estado !== 'ENVIADO');
  return (
    <div style={{ fontSize: '0.8rem' }}>
      <div className="muted" style={{ marginBottom: 6 }}>Pegá los DNIs (uno por renglón, o copiados de una planilla). A los que ya tienen un enlace abierto se les devuelve el mismo.</div>
      <textarea className="input" value={texto} onChange={e => setTexto(e.target.value)} rows={5} style={{ width: '100%', fontFamily: 'monospace' }} placeholder={'28123456\n30111222'} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '8px 0 12px', flexWrap: 'wrap' }}>
        <span>{dnis.length} DNI(s)</span>
        <label>Vence en <input className="input" type="number" min={1} max={90} value={dias} onChange={e => setDias(Number(e.target.value))} style={{ width: 70 }} /> días</label>
        <button style={boton('#4338ca')} disabled={!dnis.length || ocupado || !cfg.url_publica} onClick={() => void generar()}>{ocupado ? 'Generando…' : 'Generar enlaces'}</button>
        {oks.length > 0 && <button style={chico} onClick={() => void copiarConAviso(toast, oks.map(x => `${x.apellido}, ${x.nombre} (${x.dni}): ${linkLegajo(cfg.url_publica, x.token)}`).join('\n'), 'Lista de enlaces')}>Copiar lista de enlaces</button>}
      </div>
      {res && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
          <tbody>{res.map(x => (
            <tr key={x.dni} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <td style={{ padding: '4px 6px' }}>{x.dni}</td>
              <td style={{ padding: '4px 6px' }}>{x.apellido ? `${x.apellido}, ${x.nombre}` : ''}</td>
              <td style={{ padding: '4px 6px', color: x.ok ? '#34d399' : '#f87171' }}>
                {!x.ok ? x.motivo : x.estado === 'ENVIADO' ? 'Ya lo completó: está para revisar' : x.existente ? 'Ya tenía enlace (el mismo)' : 'Enlace nuevo'}
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                {x.ok && x.token && x.estado !== 'ENVIADO' && <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                  <button style={chico} title={x.celular ? `WhatsApp a ${x.celular}` : 'Sin celular en la base'} onClick={() => void escribirWhatsapp(toast, x, msg(x))}>📲 WhatsApp</button>
                  <button style={chico} onClick={() => void copiarConAviso(toast, msg(x), 'Mensaje')}>Copiar mensaje</button>
                </div>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

// ── Mensaje de WhatsApp ─────────────────────────────────────────────────────
function EditarMensaje({ cfg, onGuardado }: { cfg: Config; onGuardado: (c: Config) => void }) {
  const toast = useToast();
  const [t, setT] = useState(cfg.plantilla);
  const guardar = async () => {
    try {
      const r = await apiFetch<any>('/legajo/enlace/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plantilla: t }) });
      toast.ok('Mensaje guardado'); onGuardado(r.data);
    } catch (e: any) { toast.error('Mensaje', e?.message); }
  };
  return (
    <div style={{ fontSize: '0.8rem' }}>
      <div className="muted" style={{ marginBottom: 6 }}>Se reemplazan {'{NOMBRE}'}, {'{APELLIDO}'}, {'{LINK}'} (obligatorio) y {'{VENCE}'}. *texto* sale en negrita en WhatsApp.</div>
      <textarea className="input" value={t} onChange={e => setT(e.target.value)} rows={8} style={{ width: '100%' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button style={boton('#2563eb')} disabled={!t.includes('{LINK}')} onClick={() => void guardar()}>Guardar</button>
        <button style={chico} onClick={() => setT(cfg.plantillaDefault)}>Volver al mensaje original</button>
      </div>
    </div>
  );
}

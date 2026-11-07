import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';
import { aExtension, type ResultadoExt } from '../LicenciasMedicasControlPage/WhatsappTab';
import { ExtensionDescarga, NAV, useVersionPublicada } from '../LicenciasMedicasControlPage/ExtensionDescarga';

// ─────────────────────────────────────────────────────────────────────────────
// Formulario de Google de Designación para los agentes de una tanda:
//   1. baja el script (.gs) que crea el formulario en Google;
//   2. guarda el link publicado (compartido por todas las PCs, en app_runtime_config);
//   3. manda el link por WhatsApp a cada agente con la extensión de la app (WhatsApp Web
//      abierto en este navegador), o a mano con "Abrir". Cada intento queda registrado.
// Las respuestas se importan en /app/designaciones-grh.
// ─────────────────────────────────────────────────────────────────────────────

type Agente = {
  dni: number; apellido: string; nombre: string; telefono: string;
  celular: string | null; dudoso: boolean;
  respondio: string | null; ultimoEstado: string | null; ultimoEnvio: string | null; enviados: number;
};

const BORDER = '1px solid rgba(255,255,255,0.1)';
const LS = 'tramites_form_designacion_cfg';
const COLOR: Record<string, string> = { ENVIADO: '#22c55e', NO_ENCONTRADO: '#f59e0b', SIN_WHATSAPP: '#ef4444', ERROR: '#ef4444' };
const TXT: Record<string, string> = { ENVIADO: 'Enviado', NO_ENCONTRADO: 'No encontrado', SIN_WHATSAPP: 'Sin WhatsApp', ERROR: 'Error' };

const capital = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
const fechaHora = (iso: string | null) => iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
/** Número escrito a mano → 549 + área + número (mismo criterio que celularDe del back). */
function celularManual(s: string) {
  const d = s.replace(/\D/g, '');
  if (d.startsWith('549') && d.length === 13) return d;
  const nac = d.startsWith('54') && d.length === 12 ? d.slice(2) : d.replace(/^0+/, '');
  return nac.length === 10 ? `549${nac}` : d;
}
function leerCfg() {
  try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; }
}

export function FormularioDesignacionPanel({ tanda, onCerrar }: { tanda: string; onCerrar: () => void }) {
  const toast = useToast();
  const cfg0 = leerCfg();
  const [ext, setExt] = useState<string | null | undefined>(undefined);
  const publicada = useVersionPublicada();
  const [verDescarga, setVerDescarga] = useState(false);
  const [link, setLink] = useState('');
  const [linkGuardado, setLinkGuardado] = useState('');
  const [plantilla, setPlantilla] = useState('');
  const [plantillaGuardada, setPlantillaGuardada] = useState('');
  const [verPlantilla, setVerPlantilla] = useState(false);
  const [rows, setRows] = useState<Agente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [prueba, setPrueba] = useState(true); // siempre arranca en prueba
  const [destinoPrueba, setDestinoPrueba] = useState<string>(cfg0.destinoPrueba || '');
  const [pausaMin, setPausaMin] = useState<number>(cfg0.pausaMin ?? 20);
  const [pausaMax, setPausaMax] = useState<number>(cfg0.pausaMax ?? 45);
  const [corriendo, setCorriendo] = useState(false);
  const [actual, setActual] = useState<number | null>(null);
  const [espera, setEspera] = useState(0);
  const [res, setRes] = useState<Map<number, ResultadoExt>>(new Map());
  const detenerRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ destinoPrueba, pausaMin, pausaMax })); } catch { /* sin storage */ }
  }, [destinoPrueba, pausaMin, pausaMax]);

  const detectar = useCallback(async () => {
    const r = await aExtension('PING', undefined, 1500);
    setExt(r.ok ? String(r.version || '?') : null);
  }, []);

  const cargar = useCallback(async (seleccionar = false) => {
    setCargando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: Agente[] }>(`/designaciones-form/whatsapp?tanda=${encodeURIComponent(tanda)}`);
      setRows(r.data);
      // por defecto: los que tienen celular, no respondieron y nunca se les mandó
      if (seleccionar) setElegidos(new Set(r.data.filter((a) => a.celular && !a.respondio && !a.enviados).map((a) => a.dni)));
    } catch (e: any) {
      toast.error('No se pudo leer la tanda', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanda]);

  useEffect(() => {
    void detectar();
    void cargar(true);
    apiFetch<{ ok: boolean; data: { link: string; plantilla: string } }>('/designaciones-form/config')
      .then((r) => { setLink(r.data.link); setLinkGuardado(r.data.link); setPlantilla(r.data.plantilla); setPlantillaGuardada(r.data.plantilla); })
      .catch((e) => toast.error('No se pudo leer el link del formulario', e?.message || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectar, cargar]);
  useEffect(() => () => { detenerRef.current = true; }, []);

  async function bajarScript() {
    try {
      const { blob } = await apiFetchBlobWithMeta('/designaciones-form/script');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'designacion_formulario.gs';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) {
      toast.error('No se pudo bajar el script', e?.message || '');
    }
  }

  async function guardarConfig() {
    try {
      await apiFetch('/designaciones-form/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: link.trim(), plantilla }),
      });
      setLinkGuardado(link.trim()); setPlantillaGuardada(plantilla);
      toast.ok('Guardado', 'Link y mensaje del formulario');
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message || '');
    }
  }

  const mensajeDe = (a: Agente) => plantillaGuardada
    .replace(/\{NOMBRE\}/g, capital((a.nombre || '').split(/\s+/)[0] || ''))
    .replace(/\{LINK\}/g, linkGuardado);
  const destinoDe = (a: Agente) => prueba ? celularManual(destinoPrueba) : a.celular;

  async function registrar(a: Agente, r: { estado: string; modo?: string; destino?: string | null; detalle?: string | null }, mensaje: string) {
    try {
      await apiFetch('/designaciones-form/whatsapp/envio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: a.dni, tanda, destino: r.destino ?? null, modo: r.modo ?? 'TELEFONO', estado: r.estado,
          detalle: r.detalle ?? null, prueba, mensaje }),
      });
    } catch (e: any) {
      toast.error('No se pudo registrar el envío', e?.message || '');
    }
  }

  const listo = !!linkGuardado && link.trim() === linkGuardado && plantilla === plantillaGuardada;
  const validar = () => {
    if (!listo) { toast.warning('Falta el link', 'Pegá el link del formulario y apretá Guardar.'); return false; }
    if (prueba && celularManual(destinoPrueba).length !== 13) { toast.warning('Modo prueba', 'Poné tu celular de prueba (ej: 1123456789).'); return false; }
    return true;
  };

  async function enviarUno(a: Agente): Promise<ResultadoExt> {
    const texto = mensajeDe(a);
    const tel = destinoDe(a);
    const r: ResultadoExt = tel
      ? await aExtension('ENVIAR', { modo: 'TELEFONO', buscar: '', palabras: [], telefono: tel, texto }, 180000)
      : { ok: false, estado: 'NO_ENCONTRADO', modo: 'TELEFONO', detalle: 'Sin celular en la base' };
    await registrar(a, { estado: r.estado || 'ERROR', modo: r.modo || 'TELEFONO', destino: r.destino ?? tel, detalle: r.detalle }, texto);
    setRes((prev) => new Map(prev).set(a.dni, r));
    return r;
  }

  async function enviar(lista: Agente[]) {
    if (!ext) { setVerDescarga(true); return; }
    if (!validar()) return;
    if (!prueba && !window.confirm(`¿Mandar el WhatsApp REAL con el formulario a ${lista.length} agente(s)?`)) return;
    detenerRef.current = false;
    setCorriendo(true);
    let ok = 0;
    try {
      for (let i = 0; i < lista.length; i++) {
        if (detenerRef.current) break;
        setActual(lista[i].dni);
        const r = await enviarUno(lista[i]);
        if (r.ok) { ok++; setElegidos((s) => { const n = new Set(s); n.delete(lista[i].dni); return n; }); }
        if (/no respondió|Recargá la página/i.test(r.detalle || '')) { toast.error('Se perdió la extensión', r.detalle || ''); break; }
        if (i < lista.length - 1 && !detenerRef.current) {
          const seg = Math.round(pausaMin + Math.random() * Math.max(0, pausaMax - pausaMin));
          for (let s = seg; s > 0 && !detenerRef.current; s--) { setEspera(s); await new Promise((rs) => setTimeout(rs, 1000)); }
          setEspera(0);
        }
      }
    } finally {
      setCorriendo(false); setActual(null); setEspera(0);
      toast.ok('WhatsApp', `${ok} de ${lista.length} enviado(s)${prueba ? ' (prueba)' : ''}`);
      void cargar();
    }
  }

  // Manual: abre WhatsApp Web con el chat y el mensaje escrito; después "✓" lo registra
  function abrir(a: Agente) {
    if (!validar()) return;
    const tel = destinoDe(a);
    if (!tel) { toast.warning('Sin celular', 'El agente no tiene celular en la base.'); return; }
    window.open(`https://web.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(mensajeDe(a))}`, 'whatsapp');
  }
  async function marcarManual(a: Agente) {
    await registrar(a, { estado: 'ENVIADO', modo: 'MANUAL', destino: destinoDe(a) }, mensajeDe(a));
    setRes((prev) => new Map(prev).set(a.dni, { ok: true, estado: 'ENVIADO', modo: 'TELEFONO' }));
    void cargar();
  }

  const aEnviar = rows.filter((a) => elegidos.has(a.dni));
  const respondieron = rows.filter((a) => a.respondio).length;
  const sinCelular = rows.filter((a) => !a.celular).length;
  const toggle = (dni: number) => setElegidos((s) => { const n = new Set(s); n.has(dni) ? n.delete(dni) : n.add(dni); return n; });

  return (
    <div style={{ border: BORDER, borderRadius: 10, padding: 12, background: 'rgba(22,163,74,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0' }}>📝 Formulario de Designación — "{tanda}"</b>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onCerrar} disabled={corriendo} style={btn(corriendo)}>Cerrar</button>
      </div>

      {/* 1. Script + 2. link */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem', color: '#cbd5e1' }}>
        <button type="button" onClick={() => void bajarScript()} style={btn(false)}>⬇️ Bajar script del formulario (.gs)</button>
        <span style={{ color: '#94a3b8' }}>
          Se crea una sola vez: script.google.com → Nuevo proyecto → pegar → ejecutar <code>crearFormularioDesignacion</code> →
          copiar el “Link para compartir” del registro y pegarlo acá.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/forms/d/e/…/viewform"
          aria-label="Link del formulario"
          style={{ flex: '1 1 320px', minWidth: 0, background: 'rgba(255,255,255,0.05)', border: BORDER, borderRadius: 8, padding: '6px 8px', color: '#e2e8f0', fontSize: '0.8rem' }} />
        <button type="button" onClick={() => setVerPlantilla((v) => !v)} style={btn(false)}>✏️ Mensaje</button>
        <button type="button" onClick={() => void guardarConfig()} disabled={listo}
          style={{ ...btn(listo), background: listo ? 'rgba(255,255,255,0.06)' : '#16a34a', color: '#fff', fontWeight: 700 }}>
          {listo ? '✓ Guardado' : 'Guardar'}
        </button>
      </div>
      {verPlantilla ? (
        <div>
          <textarea value={plantilla} onChange={(e) => setPlantilla(e.target.value)} rows={8} aria-label="Mensaje de WhatsApp"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: BORDER, borderRadius: 8, padding: 8, color: '#e2e8f0', fontSize: '0.8rem' }} />
          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{'{NOMBRE}'} = primer nombre · {'{LINK}'} = link del formulario (obligatorio). Se guarda con “Guardar”.</div>
        </div>
      ) : null}

      {/* 3. Extensión + prueba */}
      <div style={{ fontSize: '0.8rem', color: ext ? '#86efac' : '#fde68a' }}>
        {ext === undefined ? 'Verificando la extensión…'
          : ext ? <>✅ Extensión de WhatsApp instalada (v{ext}). Tené abierto WhatsApp Web en este {NAV.nombre}.</>
          : <>⚠️ Falta la extensión de la app en este {NAV.nombre}: sin ella se manda a mano con “Abrir”.{' '}
              <button type="button" onClick={() => setVerDescarga(true)} style={{ ...btn(false), fontWeight: 700 }}>🧩 Descargar e instalar</button>{' '}
              <button type="button" onClick={detectar} style={btn(false)}>Volver a verificar</button></>}
      </div>
      {verDescarga && <ExtensionDescarga instalada={ext} publicada={publicada} onCerrar={() => setVerDescarga(false)} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem', color: '#cbd5e1' }}>
        <label style={{ cursor: 'pointer', color: prueba ? '#fde68a' : '#fca5a5', fontWeight: 700 }}>
          <input type="checkbox" checked={prueba} disabled={corriendo} onChange={(e) => setPrueba(e.target.checked)} /> Modo prueba
        </label>
        {prueba ? (
          <input value={destinoPrueba} onChange={(e) => setDestinoPrueba(e.target.value)} placeholder="Tu celular (ej: 1123456789)"
            aria-label="Celular de prueba"
            style={{ width: 190, background: 'rgba(255,255,255,0.05)', border: BORDER, borderRadius: 8, padding: '5px 8px', color: '#e2e8f0', fontSize: '0.8rem' }} />
        ) : <span style={{ color: '#fca5a5' }}>⚠️ Se manda a los agentes</span>}
        <span>Pausa entre mensajes</span>
        <input type="number" min={5} max={300} value={pausaMin} onChange={(e) => setPausaMin(Math.max(5, Number(e.target.value) || 5))}
          aria-label="Pausa mínima" style={{ width: 56, background: 'rgba(255,255,255,0.05)', border: BORDER, borderRadius: 6, color: '#e2e8f0', padding: '3px 5px' }} />
        <span>a</span>
        <input type="number" min={5} max={600} value={pausaMax} onChange={(e) => setPausaMax(Math.max(pausaMin, Number(e.target.value) || pausaMin))}
          aria-label="Pausa máxima" style={{ width: 56, background: 'rgba(255,255,255,0.05)', border: BORDER, borderRadius: 6, color: '#e2e8f0', padding: '3px 5px' }} />
        <span>s</span>
      </div>

      {cargando && !rows.length ? <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Leyendo la tanda…</div> : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem', color: '#cbd5e1' }}>
            <span>{rows.length} agente(s) · <b>{respondieron}</b> ya respondieron · <b>{sinCelular}</b> sin celular</span>
            {!corriendo ? (
              <button type="button" onClick={() => void enviar(aEnviar)} disabled={!aEnviar.length || ext === undefined}
                style={{ ...btn(!aEnviar.length), background: '#16a34a', color: '#fff', fontWeight: 700, padding: '7px 14px' }}>
                📲 Mandar a {aEnviar.length} agente(s){prueba ? ' (prueba)' : ''}
              </button>
            ) : (
              <button type="button" onClick={() => { detenerRef.current = true; }}
                style={{ ...btn(false), background: '#b91c1c', color: '#fff', fontWeight: 700, padding: '7px 14px' }}>
                ⏹ Detener{espera ? ` (próximo en ${espera} s)` : ''}
              </button>
            )}
          </div>

          <div style={{ maxHeight: 320, overflow: 'auto', border: BORDER, borderRadius: 8 }}>
            {rows.map((a) => {
              const r = res.get(a.dni);
              return (
                <div key={a.dni} style={{
                  display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', borderBottom: BORDER, fontSize: '0.78rem',
                  background: actual === a.dni ? 'rgba(22,163,74,0.25)' : 'transparent',
                }}>
                  <input type="checkbox" checked={elegidos.has(a.dni)} disabled={corriendo || !a.celular}
                    onChange={() => toggle(a.dni)} aria-label={`Elegir ${a.apellido}`} />
                  <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.apellido}, {a.nombre} <span style={{ color: '#64748b' }}>· DNI {a.dni}</span>
                  </span>
                  <span style={{ width: 130, color: a.celular ? (a.dudoso ? '#fde68a' : '#94a3b8') : '#ef4444', whiteSpace: 'nowrap' }}
                    title={a.telefono || 'Sin teléfono en la base'}>
                    {a.celular ? `+${a.celular}${a.dudoso ? ' ⚠️' : ''}` : 'sin celular'}
                  </span>
                  <span style={{ width: 170, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r?.detalle || ''}>
                    {actual === a.dni ? <span style={{ color: '#86efac' }}>enviando…</span>
                      : r ? <span style={{ color: COLOR[r.estado] || '#fff' }}>{TXT[r.estado] || r.estado}{prueba ? ' (prueba)' : ''}</span>
                      : a.respondio ? <span style={{ color: '#22c55e' }}>✅ Respondió {a.respondio.split('-').reverse().join('/')}</span>
                      : a.ultimoEstado ? <span style={{ color: COLOR[a.ultimoEstado] || '#fff' }}>{TXT[a.ultimoEstado] || a.ultimoEstado} {fechaHora(a.ultimoEnvio)}</span>
                      : <span style={{ color: '#64748b' }}>sin enviar</span>}
                  </span>
                  <button type="button" onClick={() => abrir(a)} disabled={corriendo || (!prueba && !a.celular)} style={btn(corriendo)}
                    title="Abre WhatsApp Web con el mensaje escrito (se manda con Enter allá)">Abrir</button>
                  <button type="button" onClick={() => void marcarManual(a)} disabled={corriendo} style={btn(corriendo)}
                    title="Marcar como enviado a mano">✓</button>
                  <button type="button" onClick={() => void enviar([a])} disabled={corriendo || (!prueba && !a.celular)} style={btn(corriendo)}
                    title="Mandar solo a este agente con la extensión">📲</button>
                </div>
              );
            })}
            {!rows.length ? <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>La tanda no tiene agentes.</div> : null}
          </div>
        </>
      )}
    </div>
  );
}

function btn(disabled: boolean): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 8, padding: '5px 10px',
    color: disabled ? '#475569' : '#e2e8f0', fontSize: '0.78rem', cursor: disabled ? 'default' : 'pointer',
  };
}

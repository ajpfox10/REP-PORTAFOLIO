// src/pages/LicenciasMedicasControlPage/WhatsappTab.tsx
// Pestaña "📲 WhatsApp": avisa por WhatsApp a los agentes con licencias que deben reclamar.
//   · Automático: con la extensión de Chrome (C:\apps\personaldev\whatsapp-extension) usa el
//     WhatsApp Web ya abierto: busca por nombre y, si no lo encuentra, abre el chat por teléfono.
//     La app hace el bucle (tanda + pausa al azar entre mensajes) y la extensión cada envío.
//   · Manual: "Abrir" abre WhatsApp Web con el chat del celular y el mensaje ya escrito;
//     se aprieta Enter allá y "✓ Enviado" acá.
// Cada intento queda en licencias_medicas_whatsapp_envios (los de modo prueba no cuentan como avisado).
// Teléfonos: personal.telefono normalizado en el back (GET /whatsapp/contactos).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { COLOR_RES, Licencia, fmtFecha, keyDe } from './shared';
import { ContactosWhatsapp } from './ContactosWhatsapp';

interface Contacto { dni: string; apellido: string; nombre: string; telefono: string; celular: string | null; dudoso: boolean }
interface Envio {
  id: number; dni: string; desde: string; hasta: string; novedad: string; destino: string | null;
  modo: string; estado: string; detalle: string | null; created_at: string | null; enviado_por: string | null;
}
type Modo = 'NOMBRE_TELEFONO' | 'NOMBRE' | 'TELEFONO';
interface ResultadoExt { ok: boolean; estado: string; modo?: 'NOMBRE' | 'TELEFONO'; destino?: string; detalle?: string | null; version?: string; contactos?: any[] }

const PLANTILLA_DEFAULT = [
  'Buenos días {NOMBRE}, le escribimos de la Oficina de Personal del Hospital. Notamos que cuenta con una licencia *{RESOLUCION}* {RANGO}.',
  '',
  '⚠️ *Antes de venir, debe enviar TODA la documentación por este medio (WhatsApp). Una vez recibida, le asignamos un TURNO para que se apersone con la misma. Sin el envío previo y sin turno NO SE LO ATENDERÁ.*',
  '',
  'La documentación que debe enviar es:',
  '📝 Una nota explicando lo sucedido, dirigida a "Reconocimientos Médicos", con firma, aclaración y DNI de usted.',
  '📝 Copia de DNI.',
  '📝 Certificado médico original en el que se indique reposo (más estudios, medicación, tratamiento, indicaciones o epicrisis en caso de contar con dicha documentación).',
  '',
  'Cualquier duda, ¡consúltenos por este medio!',
  '🚨 *IMPORTANTE: Se recuerda que toda carpeta denegada es ausente.* 🚨',
].join('\n');
// Plantillas por defecto anteriores: si lo guardado en el navegador es una de estas, se reemplaza por la vigente
const PLANTILLAS_VIEJAS = [
  'Hola {NOMBRE}, te escribimos de la Oficina de Personal del Hospital. Tu licencia por {NOVEDAD} {RANGO} figura como *{RESOLUCION}* en el Ministerio. Por favor acercate a Personal para regularizarla. Gracias.',
  'Hola {NOMBRE}, te escribimos de la Oficina de Personal del Hospital. Tu licencia por {NOVEDAD} {RANGO} figura como *{RESOLUCION}* en el Ministerio. Tenés que enviar por este medio la nota de apelación dirigida a Reconocimiento Médico, fotos de los certificados, estudios o demás, y solicitar turno para la entrega de papeles. Sin estos pasos previos NO RECIBIREMOS PAPELES EN VENTANILLA Y TODA CONSULTA SE EVACUA POR ESTE MEDIO ÚNICAMENTE.',
];
const LS = 'lmc_whatsapp_cfg';

function leerCfg() {
  try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; }
}
const capital = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, m => m.toUpperCase());
const palabras = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const esNumero = (s: string) => /^\+?[\d\s-]{8,}$/.test(s.trim());
/** Número de prueba escrito a mano → 549 + área + número (mismo criterio que celularDe del back). */
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

// ── Comunicación con la extensión (via bridge.js por window.postMessage) ──
let seq = 0;
function aExtension(type: string, payload?: any, ms = 5000): Promise<ResultadoExt> {
  const id = `${Date.now()}-${++seq}`;
  return new Promise(resolve => {
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

const COLOR_ESTADO: Record<string, string> = {
  ENVIADO: 'rgba(34,197,94,0.22)', NO_ENCONTRADO: 'rgba(234,179,8,0.25)', SIN_WHATSAPP: 'rgba(239,68,68,0.25)', ERROR: 'rgba(239,68,68,0.25)',
};
const TXT_ESTADO: Record<string, string> = { ENVIADO: 'Avisado', NO_ENCONTRADO: 'No encontrado', SIN_WHATSAPP: 'Sin WhatsApp', ERROR: 'Error' };

export function WhatsappTab({ licencias }: { licencias: Licencia[] }) {
  const toast = useToast();
  const cfg0 = useMemo(leerCfg, []);
  const [plantilla, setPlantilla] = useState<string>(
    cfg0.plantilla && !PLANTILLAS_VIEJAS.includes(cfg0.plantilla) ? cfg0.plantilla : PLANTILLA_DEFAULT,
  );
  const [modo, setModo] = useState<Modo>(cfg0.modo || 'NOMBRE_TELEFONO');
  const [pausaMin, setPausaMin] = useState<number>(cfg0.pausaMin ?? 20);
  const [pausaMax, setPausaMax] = useState<number>(cfg0.pausaMax ?? 45);
  const [prueba, setPrueba] = useState<boolean>(true); // siempre arranca en prueba
  const [destinoPrueba, setDestinoPrueba] = useState<string>(cfg0.destinoPrueba || '');
  const [ocultarAvisados, setOcultarAvisados] = useState(true);
  const [verContactos, setVerContactos] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ plantilla, modo, pausaMin, pausaMax, destinoPrueba })); } catch { /* sin storage */ }
  }, [plantilla, modo, pausaMin, pausaMax, destinoPrueba]);

  const [ext, setExt] = useState<string | null | undefined>(undefined); // undefined = verificando
  const detectar = useCallback(async () => {
    const r = await aExtension('PING', undefined, 1500);
    setExt(r.ok ? (r.version || '?') : null);
  }, []);
  useEffect(() => { void detectar(); }, [detectar]);

  // Contactos + envíos de los DNI en pantalla
  const [contactos, setContactos] = useState<Map<string, Contacto>>(new Map());
  const [envios, setEnvios] = useState<Envio[]>([]);
  const dnis = useMemo(() => [...new Set(licencias.map(l => l.dni))].sort().join(','), [licencias]);
  const cargarContactos = useCallback(async () => {
    if (!dnis) { setContactos(new Map()); setEnvios([]); return; }
    try {
      const r = await apiFetch<{ ok: boolean; contactos: Contacto[]; envios: Envio[] }>(`/licencias-medicas-control/whatsapp/contactos?dni=${dnis}`);
      setContactos(new Map(r.contactos.map(c => [c.dni, c])));
      setEnvios(r.envios);
    } catch (e: any) {
      toast.error('No se pudieron leer los teléfonos', e?.message || '');
    }
  }, [dnis, toast]);
  useEffect(() => { void cargarContactos(); }, [cargarContactos]);

  // Último envío de cada licencia (y si alguno salió OK)
  const avisos = useMemo(() => {
    const m = new Map<string, { ultimo: Envio; avisado: Envio | null }>();
    for (const e of envios) {
      const k = `${e.dni}|${e.desde}|${e.hasta}|${e.novedad}`;
      const prev = m.get(k);
      m.set(k, { ultimo: e, avisado: e.estado === 'ENVIADO' ? e : prev?.avisado ?? null });
    }
    return m;
  }, [envios]);
  const avisoDe = (l: Licencia) => avisos.get(`${l.dni}|${l.desde}|${l.hasta}|${l.novedad}`);

  const filas = useMemo(
    () => licencias.filter(l => !ocultarAvisados || !avisoDe(l)?.avisado),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [licencias, ocultarAvisados, avisos],
  );

  const [tildados, setTildados] = useState<Set<string>>(new Set());
  const [vista, setVista] = useState<string | null>(null);
  const todos = filas.length > 0 && filas.every(l => tildados.has(keyDe(l)));
  const tildar = (k: string, v: boolean) => setTildados(prev => { const n = new Set(prev); v ? n.add(k) : n.delete(k); return n; });
  const tildarTodos = (v: boolean) => setTildados(v ? new Set(filas.map(keyDe)) : new Set());

  const mensajeDe = useCallback((l: Licencia) => {
    const c = contactos.get(l.dni);
    const nombre = capital(palabras(c?.nombre || l.nombre.split(',')[1] || '')[0] || '');
    const rango = l.hasta !== l.desde ? `del ${fmtFecha(l.desde)} al ${fmtFecha(l.hasta)}` : `del ${fmtFecha(l.desde)}`;
    return plantilla
      .replace(/\{NOMBRE\}/g, nombre)
      .replace(/\{APELLIDO\}/g, capital(c?.apellido || l.nombre.split(',')[0] || ''))
      .replace(/\{NOVEDAD\}/g, l.novedad.toLowerCase())
      .replace(/\{RANGO\}/g, rango)
      .replace(/\{DESDE\}/g, fmtFecha(l.desde))
      .replace(/\{HASTA\}/g, fmtFecha(l.hasta))
      .replace(/\{DIAS\}/g, String(l.detalle.length))
      .replace(/\{RESOLUCION\}/g, l.resolucion);
  }, [contactos, plantilla]);

  /** Qué buscar en WhatsApp y a qué número, según modo prueba / modo elegido. */
  const objetivoDe = (l: Licencia) => {
    if (prueba) {
      const d = destinoPrueba.trim();
      return esNumero(d)
        ? { modo: 'TELEFONO' as Modo, buscar: '', palabras: [] as string[], telefono: celularPrueba(d) }
        : { modo: 'NOMBRE' as Modo, buscar: d, palabras: palabras(d), telefono: null };
    }
    const c = contactos.get(l.dni);
    const ape = palabras(c?.apellido || l.nombre.split(',')[0] || '');
    const nom = palabras(c?.nombre || l.nombre.split(',')[1] || '');
    // Busca por el primer apellido; exige primer apellido + primer nombre en el contacto
    return { modo, buscar: ape[0] || '', palabras: [ape[0], nom[0]].filter(Boolean) as string[], telefono: c?.celular ?? null };
  };

  const registrar = async (l: Licencia, r: { modo: string; estado: string; destino?: string | null; detalle?: string | null }, mensaje: string) => {
    try {
      await apiFetch('/licencias-medicas-control/whatsapp/envio', {
        method: 'POST',
        body: JSON.stringify({
          dni: l.dni, desde: l.desde, hasta: l.hasta, novedad: l.novedad,
          destino: r.destino ?? null, modo: r.modo, prueba, estado: r.estado, detalle: r.detalle ?? null, mensaje,
        }),
      });
    } catch (e: any) {
      toast.error('No se pudo registrar el envío', e?.message || '');
    }
  };

  // ── Tanda automática ──
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState<{ i: number; n: number; espera: number; actual: string } | null>(null);
  const [log, setLog] = useState<{ nombre: string; r: ResultadoExt }[]>([]);
  const detener = useRef(false);

  const validarPrueba = () => {
    if (prueba && !destinoPrueba.trim()) { toast.error('Modo prueba', 'Poné el contacto o número de prueba'); return false; }
    return true;
  };

  const enviarTanda = async () => {
    const lista = filas.filter(l => tildados.has(keyDe(l)));
    if (!lista.length || !validarPrueba()) return;
    if (!prueba && !window.confirm(`Se van a mandar ${lista.length} mensajes REALES por WhatsApp. ¿Seguimos?`)) return;
    detener.current = false;
    setEnviando(true);
    setLog([]);
    try {
      for (let i = 0; i < lista.length; i++) {
        if (detener.current) break;
        const l = lista[i];
        setProgreso({ i: i + 1, n: lista.length, espera: 0, actual: l.nombre });
        const obj = objetivoDe(l);
        const texto = mensajeDe(l);
        let r: ResultadoExt;
        if (obj.modo === 'TELEFONO' && !obj.telefono) r = { ok: false, estado: 'NO_ENCONTRADO', modo: 'TELEFONO', detalle: 'Sin celular en la base' };
        else r = await aExtension('ENVIAR', { ...obj, texto }, 180000);
        await registrar(l, { modo: r.modo || (obj.modo === 'TELEFONO' ? 'TELEFONO' : 'NOMBRE'), estado: r.estado || 'ERROR', destino: r.destino, detalle: r.detalle }, texto);
        setLog(prev => [...prev, { nombre: l.nombre, r }]);
        if (r.ok) tildar(keyDe(l), false);
        // Si WhatsApp no está usable no tiene sentido seguir
        if (r.estado === 'ERROR' && /QR|no está listo|no terminó de cargar|no respondió|Recargá/i.test(r.detalle || '')) {
          toast.error('Tanda detenida', r.detalle || '');
          break;
        }
        if (i < lista.length - 1 && !detener.current) {
          const seg = Math.round(pausaMin + Math.random() * Math.max(0, pausaMax - pausaMin));
          for (let s = seg; s > 0 && !detener.current; s--) {
            setProgreso({ i: i + 1, n: lista.length, espera: s, actual: l.nombre });
            await new Promise(res => setTimeout(res, 1000));
          }
        }
      }
    } finally {
      setEnviando(false);
      setProgreso(null);
      void cargarContactos();
    }
  };

  // ── Manual ──
  const abrirManual = async (l: Licencia) => {
    if (!validarPrueba()) return;
    const texto = mensajeDe(l);
    const obj = objetivoDe(l);
    const tel = obj.telefono;
    if (tel) {
      window.open(`https://web.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(texto)}`, 'hpw_whatsapp');
    } else {
      try { await navigator.clipboard.writeText(texto); } catch { /* sin permiso de portapapeles */ }
      toast.ok('Mensaje copiado', `Sin celular: buscá a "${prueba ? destinoPrueba : l.nombre}" en WhatsApp y pegá el mensaje (Ctrl+V)`);
    }
  };
  const marcarManual = async (l: Licencia) => {
    const obj = objetivoDe(l);
    await registrar(l, { modo: 'MANUAL', estado: 'ENVIADO', destino: obj.telefono ? `+${obj.telefono}` : (prueba ? destinoPrueba : l.nombre) }, mensajeDe(l));
    toast.ok('Registrado', l.nombre);
    void cargarContactos();
  };

  const nTild = filas.filter(l => tildados.has(keyDe(l))).length;
  const sinCel = filas.filter(l => !contactos.get(l.dni)?.celular).length;
  const filaVista = filas.find(l => keyDe(l) === vista) || filas.find(l => tildados.has(keyDe(l))) || filas[0];

  return (
    <div style={{ padding: 14 }}>
      {/* Estado de la extensión */}
      <div className="card" style={{
        padding: '10px 14px', marginBottom: 12,
        background: ext ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
        border: `1px solid ${ext ? 'rgba(34,197,94,0.35)' : 'rgba(234,179,8,0.35)'}`,
      }}>
        {ext === undefined ? 'Verificando la extensión…'
          : ext ? <>✅ <b>Extensión instalada</b> (v{ext}). Envío automático disponible: tené WhatsApp Web abierto y vinculado en este Chrome y no uses la PC durante la tanda.{' '}
              {!verContactos && <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: '0.75rem' }} onClick={() => setVerContactos(true)}>📇 Contactos de WhatsApp</button>}</>
          : <>⚠️ <b>Extensión no instalada</b> en este Chrome: solo funciona el envío <b>manual</b> (botón “Abrir”). Para el automático, instalá la extensión
              (<code>C:\apps\personaldev\whatsapp-extension</code>, ver LEEME.txt) y <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: '0.75rem' }} onClick={detectar}>Volver a verificar</button></>}
      </div>

      {verContactos && ext && <ContactosWhatsapp pedirExtension={aExtension} onCerrar={() => setVerContactos(false)} />}

      {/* Configuración */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 12 }}>
        <div>
          <label className="muted" style={{ fontSize: '0.8rem' }} htmlFor="wa-plantilla">Mensaje</label>
          <textarea id="wa-plantilla" className="input" rows={12} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
            value={plantilla} onChange={e => setPlantilla(e.target.value)} disabled={enviando} />
          <div className="muted" style={{ fontSize: '0.72rem' }}>
            Variables: {'{NOMBRE} {APELLIDO} {NOVEDAD} {RANGO} {DESDE} {HASTA} {DIAS} {RESOLUCION}'} · *texto* = negrita ·{' '}
            <a href="#" onClick={e => { e.preventDefault(); setPlantilla(PLANTILLA_DEFAULT); }}>restaurar</a>
          </div>
          {filaVista && (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>Vista previa · {filaVista.nombre}</div>
              {mensajeDe(filaVista)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem' }}>
          <label>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Cómo lo busca</span>
            <select className="input" style={{ width: '100%' }} value={modo} onChange={e => setModo(e.target.value as Modo)} disabled={enviando}>
              <option value="NOMBRE_TELEFONO">Por nombre y, si no lo encuentra, por teléfono</option>
              <option value="NOMBRE">Solo por nombre (contactos agendados)</option>
              <option value="TELEFONO">Solo por teléfono de la base</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Pausa entre mensajes</span>
            <input className="input" type="number" min={5} max={600} style={{ width: 70 }} value={pausaMin} onChange={e => setPausaMin(Math.max(5, Number(e.target.value) || 5))} disabled={enviando} />
            <span>a</span>
            <input className="input" type="number" min={5} max={600} style={{ width: 70 }} value={pausaMax} onChange={e => setPausaMax(Math.max(pausaMin, Number(e.target.value) || pausaMin))} disabled={enviando} />
            <span className="muted">seg</span>
          </div>
          <div style={{ padding: 8, borderRadius: 8, background: prueba ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.12)', border: `1px solid ${prueba ? 'rgba(59,130,246,0.35)' : 'rgba(239,68,68,0.4)'}` }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" checked={prueba} onChange={e => setPrueba(e.target.checked)} disabled={enviando} />
              {prueba ? '🧪 Modo prueba' : '🔴 ENVÍO REAL a los agentes'}
            </label>
            {prueba && (
              <>
                <input className="input" style={{ width: '100%', marginTop: 6 }} placeholder="Contacto agendado o número de prueba"
                  value={destinoPrueba} onChange={e => setDestinoPrueba(e.target.value)} disabled={enviando} />
                <div className="muted" style={{ fontSize: '0.72rem', marginTop: 4 }}>
                  Todos los mensajes van a este destino (nombre → lo busca en WhatsApp; número → abre el chat). No cuentan como avisados.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Barra de acciones */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 8px' }}>
        <button type="button" className="btn" onClick={enviarTanda} disabled={!ext || enviando || !nTild}
          style={{ fontWeight: 700, background: prueba ? undefined : 'rgba(239,68,68,0.35)' }}>
          ▶ Enviar {nTild || ''} tildado{nTild === 1 ? '' : 's'} {prueba ? '(prueba)' : ''}
        </button>
        {enviando && <button type="button" className="btn" onClick={() => { detener.current = true; }}>⏹ Detener</button>}
        {progreso && (
          <span style={{ fontSize: '0.85rem' }}>
            {progreso.espera ? `Enviado ${progreso.i} de ${progreso.n} · próximo en ${progreso.espera} s` : `Enviando ${progreso.i} de ${progreso.n}: ${progreso.actual}…`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem' }}>
          <input type="checkbox" checked={ocultarAvisados} onChange={e => setOcultarAvisados(e.target.checked)} />
          Ocultar los ya avisados
        </label>
        <span className="muted" style={{ fontSize: '0.8rem' }}>{filas.length} licencias · {sinCel} sin celular</span>
      </div>

      {log.length > 0 && (
        <div className="card" style={{ padding: 10, marginBottom: 10, fontSize: '0.8rem', maxHeight: 160, overflowY: 'auto' }}>
          {log.map((x, i) => (
            <div key={i}>
              <span className="badge" style={{ background: COLOR_ESTADO[x.r.estado] ?? COLOR_ESTADO.ERROR }}>{TXT_ESTADO[x.r.estado] ?? x.r.estado}</span>{' '}
              <b>{x.nombre}</b>{x.r.destino ? ` → ${x.r.destino}` : ''}{x.r.modo ? ` (por ${x.r.modo === 'NOMBRE' ? 'nombre' : 'teléfono'})` : ''}
              {x.r.detalle ? <span className="muted"> · {x.r.detalle}</span> : null}
            </div>
          ))}
        </div>
      )}

      {/* Tabla */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap' }}>
            <th style={{ padding: '8px 6px', width: 30 }}>
              <input type="checkbox" checked={todos} onChange={e => tildarTodos(e.target.checked)} disabled={enviando} title="Tildar todos" style={{ width: 16, height: 16 }} />
            </th>
            <th style={{ padding: '8px 6px' }}>Agente / servicio</th>
            <th style={{ padding: '8px 6px' }}>Licencia</th>
            <th style={{ padding: '8px 6px' }}>Celular</th>
            <th style={{ padding: '8px 6px' }}>Último aviso</th>
            <th style={{ padding: '8px 6px' }}>Manual</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center' }} className="muted">Sin licencias para avisar.</td></tr>
          )}
          {filas.map(l => {
            const k = keyDe(l);
            const c = contactos.get(l.dni);
            const av = avisoDe(l);
            return (
              <tr key={k} onClick={() => setVista(k)}
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', background: vista === k ? 'rgba(124,58,237,0.1)' : undefined }}>
                <td style={{ padding: '6px 6px' }} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={tildados.has(k)} onChange={e => tildar(k, e.target.checked)} disabled={enviando} style={{ width: 16, height: 16 }} />
                </td>
                <td style={{ padding: '6px 6px', maxWidth: 230 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.nombre}</div>
                  <div className="muted" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.servicio || undefined}>
                    DNI {l.dni} · {l.servicio || '—'}
                  </div>
                </td>
                <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                  {l.novedad} <span className="badge" style={{ background: COLOR_RES[l.resolucion] ?? 'rgba(168,85,247,0.25)' }}>{l.resolucion}</span>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>{fmtFecha(l.desde)}{l.hasta !== l.desde ? ` → ${fmtFecha(l.hasta)}` : ''}</div>
                </td>
                <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }} title={c?.telefono ? `En la base: ${c.telefono}` : undefined}>
                  {c?.celular
                    ? <>+{c.celular}{c.dudoso && <span className="badge" style={{ background: 'rgba(234,179,8,0.25)', marginLeft: 4 }} title="Puede ser un fijo">dudoso</span>}</>
                    : <span className="muted">Sin celular</span>}
                  {c?.telefono && <div className="muted" style={{ fontSize: '0.7rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.telefono}</div>}
                </td>
                <td style={{ padding: '6px 6px', maxWidth: 220 }}>
                  {av ? (
                    <>
                      <span className="badge" style={{ background: COLOR_ESTADO[av.ultimo.estado] }}>{TXT_ESTADO[av.ultimo.estado] ?? av.ultimo.estado}</span>
                      <div className="muted" style={{ fontSize: '0.7rem' }} title={av.ultimo.detalle || undefined}>
                        {av.ultimo.created_at ? new Date(av.ultimo.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                        {av.ultimo.destino ? ` · ${av.ultimo.destino}` : ''}
                        {av.ultimo.estado !== 'ENVIADO' && av.ultimo.detalle ? ` · ${av.ultimo.detalle}` : ''}
                      </div>
                    </>
                  ) : <span className="muted">—</span>}
                </td>
                <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => abrirManual(l)} disabled={enviando}
                    title="Abre WhatsApp Web con el chat y el mensaje ya escrito">Abrir</button>{' '}
                  <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => marcarManual(l)} disabled={enviando}
                    title="Registrar que se envió a mano">✓ Enviado</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

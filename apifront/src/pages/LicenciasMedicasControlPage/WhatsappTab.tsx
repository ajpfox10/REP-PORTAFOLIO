// src/pages/LicenciasMedicasControlPage/WhatsappTab.tsx
// Pestaña "📲 WhatsApp": avisa por WhatsApp a los agentes con licencias que deben reclamar.
//   · Automático: con la extensión de Chrome (C:\apps\personaldev\whatsapp-extension) usa el
//     WhatsApp Web ya abierto: busca por nombre y, si no lo encuentra, abre el chat por teléfono.
//     La app hace el bucle (tanda + pausa al azar entre mensajes) y la extensión cada envío.
//   · Manual: "Abrir" abre WhatsApp Web con el chat del celular y el mensaje ya escrito;
//     se aprieta Enter allá y "✓ Enviado" acá.
// Cada intento queda en licencias_medicas_whatsapp_envios (los de modo prueba no cuentan como avisado).
// Teléfonos: personal.telefono normalizado en el back (GET /whatsapp/contactos).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { COLOR_RES, Licencia, fmtFecha, keyDe } from './shared';
import { ContactosWhatsapp } from './ContactosWhatsapp';

interface Contacto {
  dni: string; apellido: string; nombre: string; telefono: string; celular: string | null; dudoso: boolean;
  opciones?: { celular: string; dudoso: boolean }[]; // todos los números que se leen en personal.telefono
}
interface Envio {
  id: number; dni: string; desde: string; hasta: string; novedad: string; destino: string | null;
  modo: string; estado: string; detalle: string | null; created_at: string | null; enviado_por: string | null;
}
interface Omitido { dni: string; desde: string; hasta: string; novedad: string; motivo: string | null; created_at: string | null; omitido_por: string | null }
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
// Estilos de la tabla: celdas centradas en vertical, renglones de una línea que se cortan con …
const TD: CSSProperties = { padding: '7px 6px', verticalAlign: 'middle' };
const LINEA: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const BTN: CSSProperties = { padding: '2px 6px', fontSize: '0.72rem', width: '100%' };
const BTN_ICONO: CSSProperties = { padding: '1px 5px', fontSize: '0.72rem', flex: '0 0 auto', lineHeight: 1.2 };

/** foco = la página la abrió desde el botón 📲 de una licencia: `licencias` trae solo esa y se muestra
 *  aunque ya esté avisada u omitida; onQuitarFoco vuelve a la lista completa. */
export function WhatsappTab({ licencias, foco = false, onQuitarFoco }: { licencias: Licencia[]; foco?: boolean; onQuitarFoco?: () => void }) {
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
  // Licencias omitidas (no se avisan): clave dni|desde|hasta|novedad
  const [omitidos, setOmitidos] = useState<Map<string, Omitido>>(new Map());
  const omitidoDe = (l: Licencia) => omitidos.get(`${l.dni}|${l.desde}|${l.hasta}|${l.novedad}`);
  const [ocultarOmitidos, setOcultarOmitidos] = useState(true);
  const dnis = useMemo(() => [...new Set(licencias.map(l => l.dni))].sort().join(','), [licencias]);
  const cargarContactos = useCallback(async () => {
    if (!dnis) { setContactos(new Map()); setEnvios([]); setOmitidos(new Map()); return; }
    try {
      const r = await apiFetch<{ ok: boolean; contactos: Contacto[]; envios: Envio[]; omitidos?: Omitido[] }>(`/licencias-medicas-control/whatsapp/contactos?dni=${dnis}`);
      setContactos(new Map(r.contactos.map(c => [c.dni, c])));
      setEnvios(r.envios);
      setOmitidos(new Map((r.omitidos ?? []).map(o => [`${o.dni}|${o.desde}|${o.hasta}|${o.novedad}`, o])));
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

  // Número elegido a mano por agente (otra opción de la base u "otro…" escrito). Solo para enviar: no toca la ficha.
  const [numeroElegido, setNumeroElegido] = useState<Map<string, string>>(new Map());
  const telefonoDe = (dni: string) => numeroElegido.get(dni) ?? contactos.get(dni)?.celular ?? null;
  const elegirNumero = (dni: string, valor: string) => {
    let cel = valor;
    if (valor === '__otro') {
      const escrito = window.prompt('Número de WhatsApp (con código de área, ej. 11 5555-1234):', '');
      if (!escrito) return;
      cel = celularPrueba(escrito);
      if (!/^549\d{10}$/.test(cel)) { toast.error('Número inválido', escrito); return; }
    }
    setNumeroElegido(prev => {
      const n = new Map(prev);
      if (cel === contactos.get(dni)?.celular) n.delete(dni); else n.set(dni, cel);
      return n;
    });
  };

  // Copiar el número elegido y corregir el teléfono de la ficha (personal.telefono) en la misma fila
  const copiarNumero = async (tel: string) => {
    try { await navigator.clipboard.writeText(`+${tel}`); toast.ok('Número copiado', `+${tel}`); }
    catch { window.prompt('Copiá el número (Ctrl+C):', `+${tel}`); }
  };
  const [editando, setEditando] = useState<{ dni: string; valor: string } | null>(null);
  const [guardandoTel, setGuardandoTel] = useState(false);
  const guardarTelefono = async () => {
    if (!editando || guardandoTel) return;
    const { dni, valor } = editando;
    // Lo escrito reemplaza el teléfono de la ficha (los números viejos no se guardan); vacío = no cambia nada
    if (!valor.trim() || valor.trim() === (contactos.get(dni)?.telefono ?? '').trim()) { setEditando(null); return; }
    setGuardandoTel(true);
    try {
      const r = await apiFetch<{ ok: boolean; contacto: Omit<Contacto, 'apellido' | 'nombre'> }>('/licencias-medicas-control/whatsapp/telefono', {
        method: 'PUT', body: JSON.stringify({ dni, telefono: valor.trim() }),
      });
      setContactos(prev => {
        const n = new Map(prev);
        const viejo = prev.get(dni);
        n.set(dni, { apellido: viejo?.apellido ?? '', nombre: viejo?.nombre ?? '', ...r.contacto });
        return n;
      });
      setNumeroElegido(prev => { const n = new Map(prev); n.delete(dni); return n; });
      setEditando(null);
      toast.ok('Teléfono guardado en la ficha', r.contacto.celular ? `WhatsApp: +${r.contacto.celular}` : 'No se reconoce ningún celular en el texto');
    } catch (e: any) {
      toast.error('No se pudo guardar el teléfono', e?.message || '');
    } finally {
      setGuardandoTel(false);
    }
  };

  const filas = useMemo(
    () => foco ? licencias : licencias.filter(l => (!ocultarAvisados || !avisoDe(l)?.avisado) && (!ocultarOmitidos || !omitidoDe(l))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [licencias, foco, ocultarAvisados, avisos, ocultarOmitidos, omitidos],
  );
  const nOmitidos = licencias.filter(l => omitidoDe(l)).length;

  // Omitir una fila (no se le avisa) / deshacerlo. Se guarda en licencias_medicas_whatsapp_omitidos.
  const omitir = async (l: Licencia) => {
    const motivo = window.prompt(`Omitir el aviso a ${l.nombre}.\nMotivo (opcional):`, '');
    if (motivo === null) return;
    try {
      await apiFetch('/licencias-medicas-control/whatsapp/omitido', {
        method: 'POST', body: JSON.stringify({ dni: l.dni, desde: l.desde, hasta: l.hasta, novedad: l.novedad, motivo }),
      });
      setTildados(prev => { const n = new Set(prev); n.delete(keyDe(l)); return n; });
      toast.ok('Omitido', l.nombre);
      await cargarContactos();
    } catch (e: any) {
      toast.error('No se pudo omitir', e?.message || '');
    }
  };
  const quitarOmitido = async (l: Licencia) => {
    try {
      await apiFetch('/licencias-medicas-control/whatsapp/omitido', {
        method: 'DELETE', body: JSON.stringify({ dni: l.dni, desde: l.desde, hasta: l.hasta, novedad: l.novedad }),
      });
      toast.ok('Ya no está omitido', l.nombre);
      await cargarContactos();
    } catch (e: any) {
      toast.error('No se pudo quitar el omitido', e?.message || '');
    }
  };

  const [tildados, setTildados] = useState<Set<string>>(new Set());
  const [vista, setVista] = useState<string | null>(null);
  const tildables = filas.filter(l => !omitidoDe(l));
  const todos = tildables.length > 0 && tildables.every(l => tildados.has(keyDe(l)));
  const tildar = (k: string, v: boolean) => setTildados(prev => { const n = new Set(prev); v ? n.add(k) : n.delete(k); return n; });
  const tildarTodos = (v: boolean) => setTildados(v ? new Set(tildables.map(keyDe)) : new Set());

  // Los de número dudoso sin aviso que haya salido arrancan tildados (una sola vez por licencia, para no pisar al usuario)
  const yaPretildados = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nuevos = licencias.filter(l => {
      const k = keyDe(l);
      return contactos.get(l.dni)?.dudoso && !avisoDe(l)?.avisado && !omitidoDe(l) && !yaPretildados.current.has(k);
    }).map(keyDe);
    if (!nuevos.length) return;
    nuevos.forEach(k => yaPretildados.current.add(k));
    setTildados(prev => new Set([...prev, ...nuevos]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licencias, contactos, avisos]);

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
    // Número elegido a mano → va directo por teléfono (sin buscar por nombre)
    const elegido = numeroElegido.get(l.dni);
    if (elegido) return { modo: 'TELEFONO' as Modo, buscar: '', palabras: [] as string[], telefono: elegido };
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

  /** Manda (por la extensión) el mensaje de una licencia, lo registra y lo suma al log. */
  const enviarUno = async (l: Licencia): Promise<ResultadoExt> => {
    const obj = objetivoDe(l);
    const texto = mensajeDe(l);
    let r: ResultadoExt;
    if (obj.modo === 'TELEFONO' && !obj.telefono) r = { ok: false, estado: 'NO_ENCONTRADO', modo: 'TELEFONO', detalle: 'Sin celular en la base' };
    else r = await aExtension('ENVIAR', { ...obj, texto }, 180000);
    await registrar(l, { modo: r.modo || (obj.modo === 'TELEFONO' ? 'TELEFONO' : 'NOMBRE'), estado: r.estado || 'ERROR', destino: r.destino, detalle: r.detalle }, texto);
    setLog(prev => [...prev, { nombre: l.nombre, r }]);
    if (r.ok) tildar(keyDe(l), false);
    return r;
  };

  // ↻ Reenviar / 📲 Enviar una sola licencia (sin tildar ni tanda)
  const reenviar = async (l: Licencia) => {
    const verbo = avisoDe(l) ? 'Reenviar' : 'Enviar';
    if (!ext) { toast.error('Sin extensión', `Para ${verbo.toLowerCase()} automático hace falta la extensión; usá "Abrir"`); return; }
    if (!validarPrueba()) return;
    const tel = objetivoDe(l).telefono;
    if (!prueba && !window.confirm(`¿${verbo} el WhatsApp REAL a ${l.nombre}${tel ? ` (+${tel})` : ''}?`)) return;
    detener.current = false;
    setEnviando(true);
    setLog([]);
    setProgreso({ i: 1, n: 1, espera: 0, actual: l.nombre });
    try {
      const r = await enviarUno(l);
      if (r.ok) toast.ok(`${verbo === 'Reenviar' ? 'Reenviado' : 'Enviado'}${prueba ? ' (prueba)' : ''}`, l.nombre);
      else toast.error(TXT_ESTADO[r.estado || 'ERROR'] ?? 'No salió', r.detalle || l.nombre);
    } finally {
      setEnviando(false);
      setProgreso(null);
      void cargarContactos();
    }
  };

  const enviarTanda = async () => {
    const lista = filas.filter(l => tildados.has(keyDe(l)) && !omitidoDe(l));
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
        const r = await enviarUno(l);
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

  const nTild = filas.filter(l => tildados.has(keyDe(l)) && !omitidoDe(l)).length;
  const sinCel = filas.filter(l => !telefonoDe(l.dni)).length;
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

      {foco && (
        <div className="card" style={{ padding: '8px 12px', marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.4)', fontSize: '0.85rem' }}>
          <span>📌 Mostrando solo <b>{licencias[0]?.nombre ?? 'la licencia elegida'}</b>{licencias[0] ? ` · ${licencias[0].novedad} ${fmtFecha(licencias[0].desde)}${licencias[0].hasta !== licencias[0].desde ? ` → ${fmtFecha(licencias[0].hasta)}` : ''}` : ''}. Revisá el número y el modo prueba, y mandalo con el botón verde de la fila.</span>
          {onQuitarFoco && <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: '0.75rem' }} onClick={onQuitarFoco} disabled={enviando}>Ver todas</button>}
        </div>
      )}

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
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem' }}>
          <input type="checkbox" checked={ocultarOmitidos} onChange={e => setOcultarOmitidos(e.target.checked)} />
          Ocultar omitidos
        </label>
        <span className="muted" style={{ fontSize: '0.8rem' }}>{filas.length} licencias · {sinCel} sin celular{nOmitidos ? ` · ${nOmitidos} omitida${nOmitidos === 1 ? '' : 's'}` : ''}</span>
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

      {/* Tabla: anchos fijos y cada celda en 2 renglones como máximo (lo largo se corta con … y va entero en el title) */}
      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 34 }} />
          <col style={{ width: '23%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '28%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: 100 }} />
        </colgroup>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap' }}>
            <th style={{ ...TD, paddingTop: 8, paddingBottom: 8 }}>
              <input type="checkbox" checked={todos} onChange={e => tildarTodos(e.target.checked)} disabled={enviando} title="Tildar todos" style={{ width: 16, height: 16 }} />
            </th>
            <th style={TD}>Agente / servicio</th>
            <th style={TD}>Licencia</th>
            <th style={TD}>Celular</th>
            <th style={TD}>Último aviso</th>
            <th style={TD}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center' }} className="muted">Sin licencias para avisar.</td></tr>
          )}
          {filas.map((l, i) => {
            const k = keyDe(l);
            const c = contactos.get(l.dni);
            const av = avisoDe(l);
            const om = omitidoDe(l);
            const rango = `${fmtFecha(l.desde)}${l.hasta !== l.desde ? ` → ${fmtFecha(l.hasta)}` : ''}`;
            const fechaAviso = av?.ultimo.created_at ? new Date(av.ultimo.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            const extraAviso = [av?.ultimo.destino, av && av.ultimo.estado !== 'ENVIADO' ? av.ultimo.detalle : null].filter(Boolean).join(' · ');
            return (
              <tr key={k} onClick={() => setVista(k)}
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer',
                  background: vista === k ? 'rgba(124,58,237,0.12)' : i % 2 ? 'rgba(255,255,255,0.025)' : undefined,
                  opacity: om ? 0.55 : undefined,
                }}>
                <td style={TD} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={!om && tildados.has(k)} onChange={e => tildar(k, e.target.checked)} disabled={enviando || !!om}
                    title={om ? 'Omitido: no se le avisa' : undefined} style={{ width: 16, height: 16 }} />
                </td>
                <td style={TD}>
                  <div style={{ ...LINEA, fontWeight: 600 }} title={l.nombre}>
                    {om && (
                      <span className="badge" style={{ background: 'rgba(148,163,184,0.3)', fontSize: '0.66rem', padding: '1px 6px', marginRight: 6 }}
                        title={[om.motivo ? `Motivo: ${om.motivo}` : 'Sin motivo', om.omitido_por ? `por ${om.omitido_por}` : '', om.created_at ? new Date(om.created_at).toLocaleString('es-AR') : ''].filter(Boolean).join(' · ')}>OMITIDO</span>
                    )}
                    {l.nombre}
                  </div>
                  <div className="muted" style={{ ...LINEA, fontSize: '0.72rem' }} title={l.servicio || undefined}>
                    DNI {l.dni} · {l.servicio || '—'}
                  </div>
                </td>
                <td style={TD}>
                  <div style={LINEA} title={l.novedad}>{l.novedad}</div>
                  <div style={{ ...LINEA, fontSize: '0.72rem' }}>
                    <span className="badge" style={{ background: COLOR_RES[l.resolucion] ?? 'rgba(168,85,247,0.25)', fontSize: '0.68rem', padding: '1px 6px', marginRight: 6 }}>{l.resolucion}</span>
                    <span className="muted">{rango}</span>
                  </div>
                </td>
                <td style={TD} title={c?.telefono ? `En la base: ${c.telefono}` : undefined} onClick={e => e.stopPropagation()}>
                  {(() => {
                    const tel = telefonoDe(l.dni);
                    const elegido = numeroElegido.has(l.dni);
                    const opciones = [...(c?.opciones ?? [])];
                    if (tel && !opciones.some(o => o.celular === tel)) opciones.push({ celular: tel, dudoso: false }); // escrito a mano
                    const dudoso = !elegido && !!c?.dudoso;
                    return (
                      <div style={{ ...LINEA, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <select
                          className="input" value={tel ?? ''} disabled={enviando}
                          onChange={e => elegirNumero(l.dni, e.target.value)}
                          title={elegido ? 'Número elegido a mano (solo para este envío; no cambia la ficha)' : 'Elegí otro número o escribí uno'}
                          style={{ padding: '1px 4px', fontSize: '0.75rem', minWidth: 0, flex: '1 1 auto', borderColor: elegido ? 'rgba(34,197,94,0.6)' : dudoso ? 'rgba(234,179,8,0.6)' : undefined }}
                        >
                          {!tel && <option value="">Sin celular</option>}
                          {opciones.map(o => <option key={o.celular} value={o.celular}>+{o.celular}{o.dudoso ? ' (dudoso)' : ''}</option>)}
                          <option value="__otro">✏️ Otro número…</option>
                        </select>
                        {dudoso && <span className="badge" style={{ background: 'rgba(234,179,8,0.25)', fontSize: '0.68rem', padding: '1px 6px' }} title="Puede ser un fijo: elegí otro o escribí uno">dudoso</span>}
                        <button type="button" className="btn" style={BTN_ICONO} disabled={!tel} onClick={() => tel && copiarNumero(tel)} title={tel ? `Copiar +${tel}` : 'Sin celular'}>📋</button>
                        <button type="button" className="btn" style={BTN_ICONO} disabled={enviando || guardandoTel}
                          onClick={() => setEditando(editando?.dni === l.dni ? null : { dni: l.dni, valor: '' })}
                          title="Corregir el teléfono de la ficha">✏️</button>
                      </div>
                    );
                  })()}
                  {editando?.dni === l.dni ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                      <input
                        className="input" autoFocus maxLength={30} value={editando.valor} disabled={guardandoTel}
                        placeholder={c?.telefono ? `Nuevo (reemplaza ${c.telefono})` : 'Ej. 1531791175'}
                        onChange={e => setEditando({ dni: l.dni, valor: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') void guardarTelefono(); if (e.key === 'Escape') setEditando(null); }}
                        title="Nuevo teléfono: reemplaza el de la ficha (máx. 30). Enter guarda · Esc cancela"
                        style={{ padding: '1px 4px', fontSize: '0.72rem', minWidth: 0, flex: '1 1 auto' }}
                      />
                      <button type="button" className="btn" style={BTN_ICONO} disabled={guardandoTel} onClick={() => void guardarTelefono()} title="Guardar en la ficha">💾</button>
                      <button type="button" className="btn" style={BTN_ICONO} disabled={guardandoTel} onClick={() => setEditando(null)} title="Cancelar">✕</button>
                    </div>
                  ) : c?.telefono && <div className="muted" style={{ ...LINEA, fontSize: '0.7rem' }} title={c.telefono}>{c.telefono}</div>}
                </td>
                <td style={TD}>
                  {av ? (
                    <>
                      <div style={LINEA}>
                        <span className="badge" style={{ background: COLOR_ESTADO[av.ultimo.estado], fontSize: '0.68rem', padding: '1px 6px' }}>{TXT_ESTADO[av.ultimo.estado] ?? av.ultimo.estado}</span>
                        <span className="muted" style={{ fontSize: '0.7rem', marginLeft: 6 }}>{fechaAviso}</span>
                      </div>
                      {extraAviso && <div className="muted" style={{ ...LINEA, fontSize: '0.7rem' }} title={extraAviso}>{extraAviso}</div>}
                    </>
                  ) : <span className="muted">—</span>}
                </td>
                <td style={TD} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {om ? (
                      <button type="button" className="btn" style={BTN} onClick={() => quitarOmitido(l)} disabled={enviando}
                        title={om.motivo ? `Motivo: ${om.motivo}` : 'Volver a incluirla para avisar'}>↩ Quitar omitido</button>
                    ) : <>
                    <button type="button" className="btn" style={{ ...BTN, background: 'rgba(34,197,94,0.2)' }} onClick={() => reenviar(l)} disabled={enviando || !ext}
                      title={ext ? `${av ? 'Volver a mandar' : 'Mandar'} solo a este agente${prueba ? ' (modo prueba)' : ''}` : 'Necesita la extensión; usá "Abrir"'}>
                      {av ? '↻ Reenviar' : '📲 Enviar'}
                    </button>
                    <button type="button" className="btn" style={BTN} onClick={() => abrirManual(l)} disabled={enviando}
                      title="Abre WhatsApp Web con el chat y el mensaje ya escrito">Abrir</button>
                    <button type="button" className="btn" style={BTN} onClick={() => marcarManual(l)} disabled={enviando}
                      title="Registrar que se envió a mano">✓ Enviado</button>
                    <button type="button" className="btn" style={{ ...BTN, background: 'rgba(148,163,184,0.15)' }} onClick={() => omitir(l)} disabled={enviando}
                      title="No avisarle esta licencia (se oculta; se puede deshacer)">⊘ Omitir</button>
                    </>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

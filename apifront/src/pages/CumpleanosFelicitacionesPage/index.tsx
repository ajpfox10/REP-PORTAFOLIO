// /app/cumpleanos-felicitaciones — felicitaciones de cumpleaños por WhatsApp (tarjeta + texto).
// Usa la misma extensión de Chrome/Edge que los avisos de licencias médicas.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { ExtensionDescarga, NAV, cmpVersion, useVersionPublicada } from '../LicenciasMedicasControlPage/ExtensionDescarga';
import { cargarCumpleanosAlertas, cumpleNombre, fmtCumpleFecha, marcarCumpleanos, type CumpleanosAlerta } from '../AlertasPage/CumpleanosBanner';
import { DISENOS, dibujarTarjeta, olvidarImagenSubida, olvidarImagenesCarpeta } from './tarjeta';
import { copiarTexto, lanzarExplorador } from '../../utils/abrirCarpeta';
import {
  VERSION_EXT_IMAGEN, TXT_ESTADO_WSP, armarTexto, destinoDe, enviarFelicitacion, esPcAutomatica, leerConfigFelicitacion,
  nombreTarjeta, setPcAutomatica, versionExtension, type CarpetaTarjetas, type ConfigFelicitacion, type CumpleFelicitable,
} from './felicitar';

type Fila = CumpleanosAlerta & CumpleFelicitable;
type Vista = 'pendientes' | 'proximos' | 'avisados';

const CAJA: CSSProperties = { border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 14, background: 'rgba(255,255,255,0.03)' };
const H3: CSSProperties = { margin: '0 0 10px 0', fontSize: '1rem', color: '#f9a8d4' };
const TD: CSSProperties = { padding: '6px 8px', verticalAlign: 'middle', borderBottom: '1px solid rgba(255,255,255,0.06)' };
const EJEMPLO = { dni: 0, anio: 0, apellido: 'PEREZ', nombre: 'MARIA LAURA' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Explicacion() {
  const [abierta, setAbierta] = useState(true);
  const P: CSSProperties = { margin: '0 0 8px 0', lineHeight: 1.5 };
  return (
    <div style={{ ...CAJA, background: 'rgba(236,72,153,0.07)', borderColor: 'rgba(236,72,153,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setAbierta(!abierta)}>
        <b style={{ color: '#f9a8d4', fontSize: '1rem' }}>📖 ¿Cómo funciona esta página?</b>
        <span style={{ flex: 1 }} />
        <span className="muted">{abierta ? 'Ocultar ▲' : 'Mostrar ▼'}</span>
      </div>
      {abierta && (
        <div style={{ marginTop: 10, fontSize: '0.86rem', color: '#e2e8f0' }}>
          <p style={P}>
            Desde acá se le manda a cada agente que cumple años una <b>felicitación por WhatsApp</b>: una <b>tarjeta (imagen)</b> con
            el texto como comentario. Se usa el WhatsApp Web que está abierto en este {NAV.nombre}, a través de la misma
            <b> extensión</b> que los avisos de licencias médicas. La extensión tiene que estar en la <b>v{VERSION_EXT_IMAGEN} o más nueva</b>,
            que es la que manda imágenes.
          </p>
          <p style={P}><b>1. De dónde salen los cumpleaños.</b> Todos los días a las 00:05 la base anota como <i>pendientes</i> a los
            agentes <b>activos</b> que cumplen años ese día. Quedan pendientes (también en el cartel rosa del inicio) hasta que se los
            felicita, se los marca como <i>Avisado</i> o se los <i>Omite</i>. Si un día no se mandó, siguen apareciendo como
            “hace N días”.</p>
          <p style={P}><b>2. El texto.</b> Se escribe una sola vez en “Mensaje”. <code>{'{nombre}'}</code> se reemplaza por el primer
            nombre del agente y <code>{'{apellido}'}</code> por el apellido. Los emojis y los renglones se respetan tal cual.</p>
          <p style={P}><b>3. La tarjeta.</b> En “Imagen” se elige uno de los diseños que trae la app (Globos, Confeti, Torta, Flores) o
            una <b>tarjeta propia</b>. Las propias se agregan de dos formas: <b>(a) guardándolas en la carpeta</b>{' '}
            <code>{'G\\TARJETAS CUMPLEANOS'}</code> del servidor (botón <b>📂 Abrir carpeta</b>) y tocando <b>↻ Actualizar carpeta</b>:
            aparecen con 📁, y para cambiarlas o sacarlas alcanza con reemplazar o borrar el archivo (adentro hay un LEEME con el
            paso a paso: cómo hacerla en Canva o PowerPoint, el tamaño, etc.); o <b>(b) con ⬆ Subir imagen</b>, que la guarda en la
            base. En los dos casos: JPG, PNG o WEBP, hasta 8 MB, idealmente <b>cuadrada de 1080×1080</b> (si no, se recorta al
            centro). Si se borra de la carpeta la tarjeta elegida, se manda Globos hasta que se elija otra. Si está tildado <b>“Poner el nombre en la tarjeta”</b>, la app escribe “¡Feliz cumpleaños!” y el
            nombre del agente sobre la imagen (en las tarjetas propias va sobre la franja de abajo, oscurecida: diseñalas con esa
            parte libre, o destildá la casilla si la tarjeta ya trae su texto). En los diseños de la app el título va siempre. La <b>vista previa</b> muestra exactamente
            lo que se va a mandar.</p>
          <p style={P}><b>4. A quién se le manda.</b> “Por teléfono” usa el celular cargado en el legajo (columna Celular; si figura
            “dudoso” es un número que podría ser fijo). “Por nombre y si no, teléfono” busca primero en los contactos agendados del
            WhatsApp (apellido + primer nombre, tiene que haber uno solo) y si no lo encuentra, va por el número.</p>
          <p style={P}><b>5. Modo prueba.</b> Mientras esté tildado, <b>todo</b> (los botones y el automático) se manda al número o
            contacto de prueba, no al agente, y el cumpleaños <b>no</b> se marca como avisado. Sirve para ver cómo llega. Destildalo
            cuando esté todo bien.</p>
          <p style={P}><b>6. Mandar a mano.</b> En la lista, <b>📲 Felicitar</b> manda a ese agente; <b>📲 Felicitar a todos</b> manda
            a todos los pendientes de la lista, de a uno, con una pausa de 20 a 40 segundos entre cada uno (para que WhatsApp no lo
            tome como spam). Mientras manda, la pestaña de WhatsApp pasa al frente sola y después vuelve acá: no hay que tocar nada.
            Se puede frenar con <b>⏹ Detener</b>. Si sale bien (y no es prueba) el cumpleaños queda <b>Avisado</b>. Si falla, queda el
            motivo en la columna WhatsApp (sin celular, sin WhatsApp, no encontrado…) y se puede reintentar.</p>
          <p style={P}><b>7. Envío automático.</b> Con <b>“Envío automático”</b> activado, todos los días desde la hora elegida se
            felicita solo a los que cumplen <b>ese día</b> (los atrasados se mandan a mano). Para eso tiene que haber una PC que lo haga:
            en esa PC hay que tildar <b>“Esta PC manda las felicitaciones automáticas”</b>, y esa PC tiene que tener la app abierta
            (cualquier página), la extensión instalada y el WhatsApp Web vinculado. La app revisa cada 5 minutos. A cada agente se le
            intenta una sola vez por año en automático; si falla, queda para mandarlo a mano. Si dos PCs lo tienen tildado, no se
            duplica: cada cumpleaños lo toma una sola.</p>
          <p style={P}><b>8. Guardar.</b> Los cambios de mensaje, imagen, modo, prueba y automático se aplican con <b>💾 Guardar</b>
            (el automático usa siempre lo guardado). La casilla de “Esta PC…” se guarda sola y vale solo para este navegador.</p>
          <p style={{ ...P, marginBottom: 0 }}><b>9. Historial.</b> Abajo queda cada intento: cuándo, a quién, a qué número, si fue
            prueba o automático, quién lo mandó y el resultado.</p>
        </div>
      )}
    </div>
  );
}

function EstadoWsp({ f }: { f: Fila }) {
  const w = f.whatsapp;
  const ult = w?.real || w?.prueba;
  if (!ult) return <span className="muted">—</span>;
  const ok = ult.estado === 'ENVIADO';
  return (
    <span title={ult.detalle || ''} style={{ color: ok ? '#86efac' : '#fca5a5' }}>
      {ok ? '✅' : '⚠️'} {TXT_ESTADO_WSP[ult.estado] || ult.estado}{!w?.real ? ' (prueba)' : ''}{ult.automatico ? ' · auto' : ''}
      {ult.destino ? <span className="muted"> · {ult.destino}</span> : null}
      {!ok && ult.detalle ? <div className="muted" style={{ fontSize: '0.72rem' }}>{ult.detalle}</div> : null}
    </span>
  );
}

export function CumpleanosFelicitacionesPage() {
  const toast = useToast();
  const [cfg, setCfg] = useState<ConfigFelicitacion | null>(null);
  const [guardada, setGuardada] = useState<string>('');
  const [imagenes, setImagenes] = useState<{ id: number; nombre: string }[]>([]);
  const [carpeta, setCarpeta] = useState<CarpetaTarjetas | null>(null);
  const [leeme, setLeeme] = useState<{ archivo: string; texto: string } | null>(null);
  const [plantillaDefault, setPlantillaDefault] = useState('');
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [vista, setVista] = useState<Vista>('pendientes');
  const [cargando, setCargando] = useState(false);
  const [historial, setHistorial] = useState<any[]>([]);
  const [ext, setExt] = useState<string | null | undefined>(undefined);
  const [verDescarga, setVerDescarga] = useState(false);
  const publicada = useVersionPublicada();
  const [pcAuto, setPcAuto] = useState(esPcAutomatica());
  const [enviando, setEnviando] = useState<string | null>(null);
  const [tanda, setTanda] = useState<{ hechos: number; total: number } | null>(null);
  const detenerRef = useRef(false);
  const subirRef = useRef<HTMLInputElement>(null);

  const extOk = !!ext && ext !== '?' && cmpVersion(ext, VERSION_EXT_IMAGEN) >= 0;
  const sinGuardar = !!cfg && JSON.stringify(cfg) !== guardada;

  const cargarConfig = useCallback(async () => {
    try {
      const d = await leerConfigFelicitacion();
      setCfg(d.config);
      setGuardada(JSON.stringify(d.config));
      setImagenes(d.imagenes);
      setCarpeta(d.carpeta);
      setPlantillaDefault(d.plantilla_default);
    } catch (e: any) {
      toast.error('No se pudo leer la configuración', e?.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarLista = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const estado = vista === 'avisados' ? 'todos' : 'pendientes';
      const dias = vista === 'pendientes' ? 0 : 7;
      let rows = (await cargarCumpleanosAlertas(estado, dias)) as Fila[];
      if (vista === 'proximos') rows = rows.filter((r) => r.dias > 0);
      if (vista === 'avisados') rows = rows.filter((r) => r.estado_aviso !== 'PENDIENTE');
      setFilas(rows);
      const h = await apiFetch<any>('/alertas-cumpleanos/felicitacion/envios?limite=150');
      setHistorial(h.data || []);
    } catch (e: any) {
      toast.error('No se pudo leer la lista', e?.message);
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  const detectar = useCallback(async () => { setExt(await versionExtension()); }, []);

  useEffect(() => { void cargarConfig(); void detectar(); }, [cargarConfig, detectar]);
  useEffect(() => { void cargarLista(); }, [cargarLista]);
  useEffect(() => () => { detenerRef.current = true; }, []);

  // Miniaturas de las opciones de imagen (con nombre de ejemplo)
  const opciones = useMemo(() => [
    ...DISENOS,
    ...(carpeta?.imagenes || []).map((i) => ({ id: `carpeta:${i.archivo}`, nombre: `📁 ${i.nombre}` })),
    ...imagenes.map((i) => ({ id: `subida:${i.id}`, nombre: i.nombre })),
  ], [imagenes, carpeta]);
  const elegidaFalta = !!cfg && cfg.imagen.startsWith('carpeta:') && !!carpeta
    && !carpeta.imagenes.some((i) => `carpeta:${i.archivo}` === cfg.imagen);
  useEffect(() => {
    let vivo = true;
    (async () => {
      for (const o of opciones) {
        if (miniaturas[o.id]) continue;
        try {
          const url = await dibujarTarjeta({ imagen: o.id, nombre: 'María Pérez', mostrarNombre: true, soloEsa: true });
          if (vivo) setMiniaturas((m) => ({ ...m, [o.id]: url }));
        } catch { if (vivo) setMiniaturas((m) => ({ ...m, [o.id]: 'error' })); }
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opciones]);

  // Vista previa: el primer agente de la lista (o uno de ejemplo)
  const muestra = filas[0] || EJEMPLO;
  useEffect(() => {
    if (!cfg) return;
    let vivo = true;
    dibujarTarjeta({ imagen: cfg.imagen, nombre: nombreTarjeta(muestra), mostrarNombre: cfg.nombre_en_imagen })
      .then((u) => { if (vivo) setPreview(u); })
      .catch(() => { if (vivo) setPreview(null); });
    return () => { vivo = false; };
  }, [cfg?.imagen, cfg?.nombre_en_imagen, muestra.nombre, muestra.apellido, carpeta]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof ConfigFelicitacion>(k: K, v: ConfigFelicitacion[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  async function guardar() {
    if (!cfg) return;
    if (cfg.prueba && !cfg.destino_prueba.trim()) { toast.warning('Falta el destino de prueba', 'Poné tu número o un contacto agendado.'); return; }
    try {
      const r = await apiFetch<any>('/alertas-cumpleanos/felicitacion/config', { method: 'PUT', body: JSON.stringify(cfg) });
      setCfg(r.data);
      setGuardada(JSON.stringify(r.data));
      toast.ok('Configuración guardada');
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message);
    }
  }

  async function subirImagen(file: File) {
    const fd = new FormData();
    fd.append('archivo', file);
    fd.append('nombre', file.name.replace(/\.[^.]+$/, ''));
    try {
      const r = await apiFetch<any>('/alertas-cumpleanos/felicitacion/imagenes', { method: 'POST', body: fd });
      setImagenes((prev) => [{ id: Number(r.data.id), nombre: r.data.nombre }, ...prev]);
      set('imagen', `subida:${r.data.id}`);
      toast.ok('Imagen subida', 'Quedó elegida: tocá Guardar para usarla.');
    } catch (e: any) {
      toast.error('No se pudo subir', e?.message);
    }
  }

  // Vuelve a leer la carpeta sin tocar lo que se está editando (las imágenes pudieron reemplazarse)
  async function refrescarCarpeta() {
    try {
      const d = await leerConfigFelicitacion();
      olvidarImagenesCarpeta();
      setMiniaturas((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('carpeta:'))));
      setCarpeta(d.carpeta);
      toast.ok('Carpeta actualizada', `${d.carpeta.imagenes.length} tarjeta(s) en la carpeta`);
    } catch (e: any) {
      toast.error('No se pudo leer la carpeta', e?.message);
    }
  }

  const uncCarpeta = carpeta?.uncRel ? `\\\\${window.location.hostname}\\${carpeta.uncRel}` : '';
  async function abrirCarpetaTarjetas() {
    if (!uncCarpeta) return;
    const copiado = await copiarTexto(uncCarpeta);
    lanzarExplorador(uncCarpeta);
    toast.ok(copiado ? 'Abriendo carpeta (ruta copiada por las dudas)' : 'Abriendo carpeta', uncCarpeta);
  }

  // Instructivo: se lee del LEEME de la carpeta (si lo editan, la página muestra lo nuevo)
  async function verInstructivo() {
    if (leeme) { setLeeme(null); return; }
    try {
      const r = await apiFetch<any>('/alertas-cumpleanos/felicitacion/carpeta-leeme');
      setLeeme(r.data);
    } catch (e: any) {
      toast.error('No se pudo leer el instructivo', e?.message);
    }
  }

  async function borrarImagen(id: number) {
    if (!window.confirm('¿Quitar esta imagen de la lista?')) return;
    try {
      await apiFetch(`/alertas-cumpleanos/felicitacion/imagenes/${id}`, { method: 'DELETE' });
      olvidarImagenSubida(id);
      setImagenes((prev) => prev.filter((i) => i.id !== id));
      if (cfg?.imagen === `subida:${id}`) set('imagen', 'diseno:globos');
      await cargarConfig();
    } catch (e: any) {
      toast.error('No se pudo quitar', e?.message);
    }
  }

  async function felicitar(f: CumpleFelicitable, enTanda = false) {
    if (!cfg) return false;
    if (!extOk) { setVerDescarga(true); return false; }
    setEnviando(`${f.dni}-${f.anio}`);
    try {
      const r = await enviarFelicitacion(f, cfg);
      if (!enTanda) {
        if (r.ok) toast.ok(cfg.prueba ? 'Prueba enviada' : 'Felicitación enviada', cumpleNombre(f as Fila));
        else toast.error(TXT_ESTADO_WSP[r.estado] || r.estado, r.detalle || undefined);
      }
      return r.ok;
    } finally {
      setEnviando(null);
      if (!enTanda) void cargarLista(true);
    }
  }

  async function felicitarTodos() {
    if (!cfg) return;
    if (!extOk) { setVerDescarga(true); return; }
    const lista = filas.filter((f) => f.estado_aviso === 'PENDIENTE');
    if (!lista.length) return;
    const aviso = cfg.prueba
      ? `Modo PRUEBA: se mandan ${lista.length} mensajes a "${cfg.destino_prueba}". ¿Seguir?`
      : `Se va a felicitar a ${lista.length} agente(s) por WhatsApp. ¿Seguir?`;
    if (!window.confirm(aviso)) return;
    detenerRef.current = false;
    setTanda({ hechos: 0, total: lista.length });
    let ok = 0;
    for (let i = 0; i < lista.length; i++) {
      if (detenerRef.current) break;
      if (await felicitar(lista[i], true)) ok++;
      setTanda({ hechos: i + 1, total: lista.length });
      if (i < lista.length - 1 && !detenerRef.current) await sleep(20000 + Math.random() * 20000);
    }
    setTanda(null);
    toast.ok('Tanda terminada', `${ok} de ${lista.length} enviadas`);
    void cargarLista(true);
  }

  async function omitir(f: Fila) {
    try {
      await marcarCumpleanos(f.dni, f.anio, 'omitir');
      void cargarLista(true);
    } catch (e: any) {
      toast.error('No se pudo omitir', e?.message);
    }
  }

  if (!cfg) return <Layout title="Felicitaciones de cumpleaños"><div className="muted">Cargando…</div></Layout>;

  const textoMuestra = armarTexto(cfg.plantilla, muestra);
  const destMuestra = destinoDe(muestra as CumpleFelicitable, cfg);
  const pendientesLista = filas.filter((f) => f.estado_aviso === 'PENDIENTE').length;

  return (
    <Layout title="Felicitaciones de cumpleaños" fluid>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Explicacion />

        {/* Extensión */}
        <div style={{ fontSize: '0.84rem', color: extOk ? '#86efac' : '#fde68a' }}>
          {ext === undefined ? 'Verificando la extensión…'
            : extOk ? <>✅ Extensión instalada (v{ext}).</>
            : ext ? <>⚠️ La extensión de este {NAV.nombre} es la v{ext}: para mandar la tarjeta hace falta la v{VERSION_EXT_IMAGEN} o más nueva (se actualiza sola en unos minutos, o actualizala a mano).{' '}
                <button className="btn" onClick={() => setVerDescarga(true)}>🔄 Cómo actualizarla</button>{' '}
                <button className="btn" onClick={detectar}>Volver a verificar</button></>
            : <>⚠️ Falta la extensión en este {NAV.nombre}.{' '}
                <button className="btn" onClick={() => setVerDescarga(true)}>🧩 Descargar e instalar</button>{' '}
                <button className="btn" onClick={detectar}>Volver a verificar</button></>}
        </div>
        {verDescarga && <ExtensionDescarga instalada={ext ?? null} publicada={publicada} onCerrar={() => { setVerDescarga(false); void detectar(); }} />}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.3fr) minmax(300px, 1fr)', gap: 14, alignItems: 'start' }}>
          {/* Configuración */}
          <div style={{ ...CAJA, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={H3}>⚙️ Configuración</h3>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <b>Mensaje</b>
                <span className="muted" style={{ fontSize: '0.78rem' }}>usa {'{nombre}'} y {'{apellido}'}</span>
                <span style={{ flex: 1 }} />
                <button className="btn" style={{ fontSize: '0.74rem', padding: '2px 8px' }} onClick={() => set('plantilla', plantillaDefault)}>Volver al texto original</button>
              </div>
              <textarea className="input" rows={5} style={{ width: '100%', resize: 'vertical' }} value={cfg.plantilla} onChange={(e) => set('plantilla', e.target.value)} />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <b>Imagen</b>
                <span style={{ flex: 1 }} />
                <input ref={subirRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void subirImagen(f); }} />
                <button className="btn" onClick={abrirCarpetaTarjetas} disabled={!carpeta?.existe} title="Abre la carpeta de tarjetas en el Explorador">📂 Abrir carpeta</button>
                <button className="btn" onClick={refrescarCarpeta} title="Vuelve a leer la carpeta">↻ Actualizar carpeta</button>
                <button className="btn" onClick={() => subirRef.current?.click()}>⬆ Subir imagen</button>
              </div>
              <div style={{ fontSize: '0.78rem', margin: '0 0 8px 0', padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                {carpeta?.existe ? (
                  <>📁 <b>Tarjetas propias:</b> guardá la imagen (JPG/PNG/WEBP, cuadrada 1080×1080) en{' '}
                    <code>{uncCarpeta}</code> y tocá <b>↻ Actualizar carpeta</b>.
                    El paso a paso completo está en{' '}
                    <button className="btn" style={{ padding: '1px 8px', fontSize: '0.76rem' }} onClick={() => void verInstructivo()}>
                      📄 {leeme ? 'Ocultar instructivo' : 'Ver instructivo'}
                    </button>
                    {' '}<span className="muted">({carpeta.imagenes.length} en la carpeta)</span></>
                ) : (
                  <span style={{ color: '#fde68a' }}>⚠️ No se encontró la carpeta de tarjetas ({carpeta?.ruta || '—'}){carpeta?.error ? `: ${carpeta.error}` : ''}.</span>
                )}
              </div>
              {leeme && (
                <div style={{ margin: '0 0 8px 0', border: '1px solid rgba(236,72,153,0.35)', borderRadius: 8, background: 'rgba(0,0,0,0.25)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <b style={{ fontSize: '0.8rem' }}>📄 {leeme.archivo}</b>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>(es el mismo archivo de la carpeta)</span>
                    <span style={{ flex: 1 }} />
                    <button className="btn" style={{ padding: '1px 8px', fontSize: '0.74rem' }} onClick={() => setLeeme(null)}>✕ Cerrar</button>
                  </div>
                  <pre style={{ margin: 0, padding: 10, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'Consolas, "Courier New", monospace', fontSize: '0.78rem', lineHeight: 1.45, color: '#e2e8f0' }}>
                    {leeme.texto}
                  </pre>
                </div>
              )}
              {elegidaFalta && (
                <div style={{ fontSize: '0.8rem', color: '#fde68a', marginBottom: 8 }}>
                  ⚠️ La tarjeta elegida ({cfg.imagen.slice(8)}) ya no está en la carpeta: mientras tanto se manda el diseño Globos. Elegí otra y Guardá.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {opciones.map((o) => {
                  const elegida = cfg.imagen === o.id;
                  const idSubida = o.id.startsWith('subida:') ? Number(o.id.slice(7)) : null;
                  return (
                    <div key={o.id} onClick={() => set('imagen', o.id)} title={o.nombre}
                      style={{ cursor: 'pointer', borderRadius: 10, padding: 4, position: 'relative',
                        border: elegida ? '3px solid #ec4899' : '1px solid rgba(255,255,255,0.15)', background: elegida ? 'rgba(236,72,153,0.12)' : 'transparent' }}>
                      {miniaturas[o.id] === 'error'
                        ? <div style={{ width: '100%', aspectRatio: '1', borderRadius: 6, background: 'rgba(239,68,68,0.15)', display: 'grid', placeItems: 'center', fontSize: '0.72rem', textAlign: 'center', padding: 4 }}>No se pudo abrir</div>
                        : miniaturas[o.id]
                        ? <img src={miniaturas[o.id]} alt={o.nombre} style={{ width: '100%', aspectRatio: '1', borderRadius: 6, display: 'block' }} />
                        : <div style={{ width: '100%', aspectRatio: '1', borderRadius: 6, background: 'rgba(255,255,255,0.06)' }} />}
                      <div style={{ fontSize: '0.72rem', textAlign: 'center', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {elegida ? '✔ ' : ''}{o.nombre}
                      </div>
                      {idSubida != null && (
                        <button title="Quitar imagen" onClick={(e) => { e.stopPropagation(); void borrarImagen(idSubida); }}
                          style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', padding: '1px 5px' }}>✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                <input type="checkbox" checked={cfg.nombre_en_imagen} onChange={(e) => set('nombre_en_imagen', e.target.checked)} />
                Poner el nombre en la tarjeta
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>Buscar al agente</b>
              <select className="input" value={cfg.modo} onChange={(e) => set('modo', e.target.value as ConfigFelicitacion['modo'])}>
                <option value="TELEFONO">Por teléfono (recomendado)</option>
                <option value="NOMBRE_TELEFONO">Por nombre y si no, teléfono</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 8, borderRadius: 8, background: cfg.prueba ? 'rgba(234,179,8,0.12)' : 'rgba(34,197,94,0.1)' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={cfg.prueba} onChange={(e) => set('prueba', e.target.checked)} />
                <b>Modo prueba</b>
              </label>
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Tu número (11 1234-5678) o contacto agendado"
                value={cfg.destino_prueba} onChange={(e) => set('destino_prueba', e.target.value)} disabled={!cfg.prueba} />
              <span style={{ fontSize: '0.78rem', color: cfg.prueba ? '#fde68a' : '#86efac' }}>
                {cfg.prueba ? 'Todo se manda al destino de prueba' : 'Se manda a los agentes'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 8, borderRadius: 8, background: 'rgba(56,189,248,0.08)' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={cfg.automatico} onChange={(e) => set('automatico', e.target.checked)} />
                <b>Envío automático</b>
              </label>
              <span>desde las</span>
              <input className="input" type="time" value={cfg.hora} onChange={(e) => set('hora', e.target.value)} style={{ width: 110 }} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }} title="Se guarda solo en este navegador">
                <input type="checkbox" checked={pcAuto} onChange={(e) => { setPcAutomatica(e.target.checked); setPcAuto(e.target.checked); }} />
                Esta PC manda las felicitaciones automáticas
              </label>
            </div>
            {cfg.automatico && !pcAuto && (
              <div style={{ fontSize: '0.78rem', color: '#fde68a' }}>
                El automático solo corre en la PC que tenga tildado “Esta PC manda…”. Si ninguna lo tiene, no sale nada.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn primary" onClick={guardar} disabled={!sinGuardar}>💾 Guardar</button>
              {sinGuardar
                ? <span style={{ color: '#fde68a', fontSize: '0.8rem' }}>Hay cambios sin guardar (los botones de envío usan lo que ves; el automático, lo guardado).</span>
                : <span className="muted" style={{ fontSize: '0.8rem' }}>Todo guardado.</span>}
            </div>
          </div>

          {/* Vista previa */}
          <div style={{ ...CAJA, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 style={H3}>👀 Vista previa {filas[0] ? <span className="muted" style={{ fontSize: '0.8rem' }}>({cumpleNombre(filas[0])})</span> : <span className="muted" style={{ fontSize: '0.8rem' }}>(ejemplo)</span>}</h3>
            <div style={{ background: '#0b141a', borderRadius: 12, padding: 12 }}>
              <div style={{ marginLeft: 'auto', maxWidth: 340, background: '#005c4b', borderRadius: 10, padding: 5, color: '#e9edef' }}>
                {preview ? <img src={preview} alt="Tarjeta" style={{ width: '100%', borderRadius: 7, display: 'block' }} />
                  : <div style={{ aspectRatio: '1', display: 'grid', placeItems: 'center' }} className="muted">Armando…</div>}
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.86rem', padding: '6px 4px 2px' }}>{textoMuestra}</div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              Destino: {'error' in destMuestra ? destMuestra.error
                : cfg.prueba ? `PRUEBA → ${destMuestra.telefono ? '+' + destMuestra.telefono : destMuestra.buscar}`
                : destMuestra.modo === 'TELEFONO' ? `+${destMuestra.telefono}` : `${destMuestra.buscar} (si no, +${destMuestra.telefono || 'sin celular'})`}
            </div>
            {preview && (
              <a className="btn" href={preview} download={`felicitacion-${nombreTarjeta(muestra).replace(/\s+/g, '_')}.jpg`} style={{ textAlign: 'center' }}>
                ⬇ Descargar la tarjeta
              </a>
            )}
          </div>
        </div>

        {/* Lista */}
        <div style={CAJA}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <h3 style={{ ...H3, margin: 0 }}>🎂 Cumpleaños</h3>
            {(['pendientes', 'proximos', 'avisados'] as Vista[]).map((v) => (
              <button key={v} className={vista === v ? 'btn primary' : 'btn'} onClick={() => setVista(v)}>
                {v === 'pendientes' ? 'Hoy y pendientes' : v === 'proximos' ? 'Próximos 7 días' : 'Avisados / omitidos'}
              </button>
            ))}
            <button className="btn" onClick={() => cargarLista()} disabled={cargando}>↻</button>
            <span style={{ flex: 1 }} />
            {tanda ? (
              <>
                <span style={{ color: '#f9a8d4' }}>Enviando {tanda.hechos}/{tanda.total}…</span>
                <button className="btn danger" onClick={() => { detenerRef.current = true; }}>⏹ Detener</button>
              </>
            ) : vista === 'pendientes' && pendientesLista > 0 ? (
              <button className="btn primary" onClick={felicitarTodos} disabled={!!enviando}>
                📲 Felicitar a todos ({pendientesLista}){cfg.prueba ? ' — PRUEBA' : ''}
              </button>
            ) : null}
          </div>
          {cargando ? <div className="muted">Cargando…</div> : filas.length === 0 ? (
            <div className="muted">{vista === 'pendientes' ? 'No hay cumpleaños pendientes de felicitar. 🎉' : 'Nada para mostrar.'}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                    <th style={TD}>Agente</th><th style={TD}>DNI</th><th style={TD}>Cumple</th><th style={TD}>Celular</th>
                    <th style={TD}>Estado</th><th style={TD}>WhatsApp</th><th style={TD}></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const id = `${f.dni}-${f.anio}`;
                    return (
                      <tr key={id}>
                        <td style={TD}><b>{cumpleNombre(f)}</b></td>
                        <td style={TD}>{f.dni}</td>
                        <td style={TD}>{fmtCumpleFecha(f.fecha_cumple)} <span className="muted">· {f.dias === 0 ? 'hoy' : f.dias < 0 ? `hace ${-f.dias} d` : `en ${f.dias} d`}</span></td>
                        <td style={TD}>{f.celular ? <>+{f.celular}{f.celular_dudoso ? <span style={{ color: '#fde68a' }} title="Podría ser un fijo"> (dudoso)</span> : null}</> : <span style={{ color: '#fca5a5' }}>sin celular</span>}</td>
                        <td style={TD}>{f.estado_aviso === 'AVISADO' ? '✅ Avisado' : f.estado_aviso === 'OMITIDO' ? '⊘ Omitido' : 'Pendiente'}</td>
                        <td style={TD}><EstadoWsp f={f} /></td>
                        <td style={{ ...TD, whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {f.dias <= 0 && (
                            <button className="btn" style={{ padding: '3px 10px', background: '#16a34a', color: '#fff' }}
                              disabled={!!enviando || !!tanda} onClick={() => felicitar(f)}>
                              {enviando === id ? 'Enviando…' : f.whatsapp?.real || f.whatsapp?.prueba ? '↻ Felicitar' : '📲 Felicitar'}
                            </button>
                          )}{' '}
                          {f.estado_aviso === 'PENDIENTE' && (
                            <button className="btn" style={{ padding: '3px 10px' }} disabled={!!enviando || !!tanda} onClick={() => omitir(f)}>Omitir</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Historial */}
        <div style={CAJA}>
          <h3 style={H3}>🗂️ Historial de envíos</h3>
          {historial.length === 0 ? <div className="muted">Todavía no se mandó ninguna felicitación.</div> : (
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                    <th style={TD}>Fecha</th><th style={TD}>Agente</th><th style={TD}>Resultado</th><th style={TD}>Destino</th>
                    <th style={TD}>Tipo</th><th style={TD}>Mandó</th><th style={TD}>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((h) => (
                    <tr key={h.id}>
                      <td style={TD}>{new Date(h.created_at).toLocaleString('es-AR')}</td>
                      <td style={TD}>{[h.apellido, h.nombre].filter(Boolean).join(', ')} <span className="muted">({h.dni})</span></td>
                      <td style={{ ...TD, color: h.estado === 'ENVIADO' ? '#86efac' : '#fca5a5' }}>{TXT_ESTADO_WSP[h.estado] || h.estado}</td>
                      <td style={TD}>{h.destino || '—'}</td>
                      <td style={TD}>{Number(h.prueba) ? 'Prueba' : 'Real'}{Number(h.automatico) ? ' · automático' : ''}</td>
                      <td style={TD}>{h.enviado_por_nombre || '—'}</td>
                      <td style={TD} className="muted">{h.detalle || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

export default CumpleanosFelicitacionesPage;

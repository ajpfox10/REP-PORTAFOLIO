// src/pages/LicenciasMedicasControlPage/ExtensionDescarga.tsx
// Descarga de la extensión de Chrome desde la app (queda en Descargas de cada PC) + guía de
// instalación / actualización. El zip y version.json los arma whatsapp-extension\empaquetar.ps1
// en public/extension-whatsapp/ (van a prod con el deploy del front).
import { useEffect, useState } from 'react';
import { useToast } from '../../ui/toast';

const BASE = '/extension-whatsapp';
const ZIP = 'personal-whatsapp-extension.zip';
const CARPETA = 'personal-whatsapp-extension';
const AVISO_SMARTSCREEN = 'Si al abrir instalar-actualizador.cmd Windows muestra “Windows protegió su PC”, tocá “Más información” → “Ejecutar de todas formas”.';

/** Nombre con el que figura en chrome://extensions (desde v1.5.0 también baja el CUIL de ANSES). */
export const NOMBRE_EXT = 'Personal - Asistente (WhatsApp y CUIL ANSES)';

/** -1 si a < b (versiones "1.2.0") */
export function cmpVersion(a: string, b: string) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Versión publicada de la extensión (null si no se pudo leer). */
export function useVersionPublicada() {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${BASE}/version.json`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => setV(j?.version || null))
      .catch(() => setV(null));
  }, []);
  return v;
}

export function hayVersionNueva(instalada: string | null | undefined, publicada: string | null) {
  return !!instalada && instalada !== '?' && !!publicada && cmpVersion(instalada, publicada) < 0;
}

/** Navegador actual: los pasos de instalación cambian entre Chrome y Edge (misma extensión). */
export const NAV = typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent)
  ? {
      nombre: 'Edge', url: 'edge://extensions',
      modoDev: <>En el <b>costado izquierdo</b> activá <b>Modo de desarrollador</b> (si no ves el costado, agrandá la ventana o tocá ☰).</>,
      cargar: <>Tocá <b>Cargar desempaquetada</b> (arriba)</>,
      recargar: <>tocá <b>Volver a cargar</b> (flecha circular ↻)</>,
      avisoDev: <>Si al abrir Edge aparece “Desactivar extensiones del modo de desarrollador”, cerralo con la <b>X</b> (no “Desactivar”).</>,
    }
  : {
      nombre: 'Chrome', url: 'chrome://extensions',
      modoDev: <>Arriba a la derecha activá <b>Modo de desarrollador</b>.</>,
      cargar: <>Tocá <b>Cargar descomprimida</b> (arriba a la izquierda)</>,
      recargar: <>tocá la <b>flecha circular ↻</b> (recargar)</>,
      avisoDev: <>Si al abrir Chrome aparece “Inhabilitar extensiones en modo de desarrollador”, tocá la <b>X</b> (no “Inhabilitar”).</>,
    };

export function ExtensionDescarga({ instalada, publicada, onCerrar }: {
  instalada: string | null | undefined;
  publicada: string | null;
  onCerrar: () => void;
}) {
  const toast = useToast();
  const actualizar = hayVersionNueva(instalada, publicada);
  const copiar = async (txt: string) => {
    try { await navigator.clipboard.writeText(txt); toast.ok('Copiado', txt); } catch { toast.error('No se pudo copiar', txt); }
  };
  const paso = (n: number, contenido: React.ReactNode) => (
    <li style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ flex: '0 0 24px', height: 24, borderRadius: 12, background: 'rgba(34,197,94,0.3)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '0.8rem' }}>{n}</span>
      <div style={{ flex: 1 }}>{contenido}</div>
    </li>
  );
  const btnChico = { padding: '1px 8px', fontSize: '0.75rem' } as const;
  const botonCopiar = <button type="button" className="btn" style={btnChico} onClick={() => copiar(NAV.url)}>📋 Copiar</button>;

  return (
    <div className="card" style={{ padding: 12, marginBottom: 12, border: '1px solid rgba(34,197,94,0.3)', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>🧩 Extensión de la app para esta PC (WhatsApp y CUIL ANSES)</b>
        <span className="badge" title="Los pasos se muestran para el navegador en el que abriste esta página">Pasos para {NAV.nombre}</span>
        {publicada && <span className="muted" style={{ fontSize: '0.75rem' }}>Última versión: v{publicada}{instalada && instalada !== '?' ? ` · instalada: v${instalada}` : ''}</span>}
        <span style={{ flex: 1 }} />
        <a className="btn" href={`${BASE}/${ZIP}`} download={ZIP} style={{ fontWeight: 700 }}>⬇️ Descargar extensión</a>
        <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>
      </div>
      <div className="muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
        Se instala una sola vez en cada PC, en el navegador (Chrome o Edge) donde está abierto WhatsApp Web y donde se usa la app.
        Sirve para mandar los avisos y leer los mensajes recibidos de WhatsApp, y para bajar la constancia de CUIL de ANSES (Trámites). La app, WhatsApp Web y la extensión tienen que estar en el <b>mismo navegador</b>.
      </div>

      {actualizar ? (
        <>
          <div style={{ marginTop: 10, fontWeight: 700 }}>🔄 Actualizar (ya la tenés instalada)</div>
          <ol style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
            {paso(1, <>Tocá <b>⬇️ Descargar extensión</b>. Queda en <b>Descargas</b> como <code>{ZIP}</code>.</>)}
            {paso(2, <>En Descargas, clic derecho al archivo → <b>Extraer todo…</b> → <b>Extraer</b>. Si pregunta, <b>reemplazar</b> los archivos de la carpeta <code>{CARPETA}</code>.</>)}
            {paso(3, <>En {NAV.nombre} abrí <code>{NAV.url}</code> {botonCopiar} (pegalo en la barra de direcciones).</>)}
            {paso(4, <>En “{NOMBRE_EXT}” (antes “Personal - Avisos por WhatsApp”) {NAV.recargar}. Tiene que decir <b>{publicada}</b>.</>)}
            {paso(5, <>En la carpeta <code>{CARPETA}</code> hacé <b>doble clic en <code>instalar-actualizador.cmd</code></b> (una sola vez):
              desde ahí la extensión <b>se actualiza sola</b> y no hay que repetir estos pasos.</>)}
            {paso(6, <>Volvé acá y apretá <b>F5</b>.</>)}
          </ol>
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 8 }}>{AVISO_SMARTSCREEN}</div>
        </>
      ) : (
        <>
          <div style={{ marginTop: 10, fontWeight: 700 }}>📖 Cómo instalarla en {NAV.nombre}</div>
          <ol style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
            {paso(1, <>Tocá <b>⬇️ Descargar extensión</b>. Queda en la carpeta <b>Descargas</b> como <code>{ZIP}</code>.</>)}
            {paso(2, <>Abrí <b>Descargas</b>, clic derecho al archivo → <b>Extraer todo…</b> → <b>Extraer</b>. Se crea la carpeta <code>{CARPETA}</code>.
              <div className="muted" style={{ fontSize: '0.75rem' }}>⚠️ No borres ni muevas esa carpeta después: {NAV.nombre} usa la extensión desde ahí.</div></>)}
            {paso(3, <>En {NAV.nombre} abrí una pestaña nueva y pegá <code>{NAV.url}</code> en la barra de direcciones {botonCopiar}
              <div className="muted" style={{ fontSize: '0.75rem' }}>(no se puede abrir con un link: hay que pegarlo a mano)</div></>)}
            {paso(4, NAV.modoDev)}
            {paso(5, <>{NAV.cargar} y elegí <b>Descargas → {CARPETA}</b>. Hay que elegir la carpeta (la que adentro tiene <code>manifest.json</code>), no el .zip.</>)}
            {paso(6, <>Tiene que aparecer <b>“{NOMBRE_EXT}”</b>{publicada ? <> versión <b>{publicada}</b></> : null}.</>)}
            {paso(7, <>En la carpeta <code>{CARPETA}</code> hacé <b>doble clic en <code>instalar-actualizador.cmd</code></b> y esperá el “LISTO”.
              Desde ahí la extensión <b>se actualiza sola</b> (al prender la PC y cada 2 horas): no hay que volver a instalarla.</>)}
            {paso(8, <>Abrí <a href="https://web.whatsapp.com" target="_blank" rel="noreferrer">WhatsApp Web</a> en ese mismo {NAV.nombre} y vinculalo con el celular si no lo está.</>)}
            {paso(9, <>Volvé acá y apretá <b>F5</b>: arriba tiene que decir <b>✅ Extensión instalada</b>.</>)}
          </ol>
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 8 }}>
            {AVISO_SMARTSCREEN}{' '}{NAV.avisoDev}{' '}
            La app tiene que estar abierta por IP (192.168.0.21 o 10.115.31.28) para que la extensión la reconozca.
          </div>
        </>
      )}
    </div>
  );
}

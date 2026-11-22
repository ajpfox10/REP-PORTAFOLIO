// RecargaPorVersion — después de un deploy las PCs siguen con la app vieja abierta hasta que alguien
// aprieta F5 (y la vieja no hace lo nuevo: avisar que está conectada, mandar la cola, etc.).
// Cada 2 minutos mira el index.html del servidor: si el archivo principal (assets/index-XXXX.js) cambió,
// hay versión nueva. Se recarga SOLA si la pestaña está en segundo plano o nadie la tocó en 5 minutos
// (así no se pierde algo que se está escribiendo); si no, muestra un aviso con el botón "Recargar".
// En desarrollo (vite dev, sin archivo con hash) no hace nada.
import React, { useEffect, useState } from 'react';

const CADA_MS = 2 * 60_000;
const INACTIVA_MS = 5 * 60_000;

function scriptActual(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? new URL(s.src, location.origin).pathname : null;
}

export function RecargaPorVersion() {
  const [nueva, setNueva] = useState(false);
  useEffect(() => {
    const actual = scriptActual();
    if (!actual) return;                       // vite dev: no hay build con hash
    let ultimaActividad = Date.now();
    const marcar = () => { ultimaActividad = Date.now(); };
    const eventos = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'];
    eventos.forEach(e => window.addEventListener(e, marcar, { passive: true }));
    let hayNueva = false;
    const recargarSiSePuede = () => {
      if (!hayNueva) return;
      if (document.hidden || Date.now() - ultimaActividad > INACTIVA_MS) location.reload();
    };
    const revisar = async () => {
      try {
        const html = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' }).then(r => (r.ok ? r.text() : ''));
        const m = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/);
        if (m && new URL(m[1], location.origin).pathname !== actual) { hayNueva = true; setNueva(true); recargarSiSePuede(); }
      } catch { /* sin red: se reintenta */ }
    };
    const t0 = setTimeout(revisar, 30_000);
    const t = setInterval(() => { void revisar(); recargarSiSePuede(); }, CADA_MS);
    const alOcultar = () => recargarSiSePuede();
    document.addEventListener('visibilitychange', alOcultar);
    return () => {
      clearTimeout(t0); clearInterval(t);
      eventos.forEach(e => window.removeEventListener(e, marcar));
      document.removeEventListener('visibilitychange', alOcultar);
    };
  }, []);
  if (!nueva) return null;
  return (
    <div style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 9999, padding: '8px 12px', borderRadius: 8, background: '#1e3a8a', color: '#fff', fontSize: '0.85rem', boxShadow: '0 4px 14px rgba(0,0,0,0.4)', display: 'flex', gap: 10, alignItems: 'center' }}>
      <span>🔄 Hay una versión nueva de la app. Se recarga sola si no la usás unos minutos.</span>
      <button type="button" className="btn" onClick={() => location.reload()} style={{ background: '#fff', color: '#1e3a8a', fontWeight: 700 }}>Recargar ahora</button>
    </div>
  );
}

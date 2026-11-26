// src/components/BloqueoDocumentacionInterruptor.tsx
// Activar / desactivar el cartel de documentación incompleta (BloqueoDocumentacion.tsx).
// Solo aparece en la PC del servidor: el back decide por el nombre del equipo (SERVIDOR-RRHH)
// y rechaza el cambio desde cualquier otra PC.

import { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';

export async function cambiarBloqueoDocumentacion(activo: boolean): Promise<boolean> {
  try {
    const r = await apiFetch<any>('/bloqueo-documentacion/estado', { method: 'PUT', body: JSON.stringify({ activo }) });
    return !!r?.ok;
  } catch (e: any) {
    window.alert(e?.message || 'No se pudo cambiar el bloqueo');
    return false;
  }
}

export function BloqueoDocumentacionInterruptor() {
  const [estado, setEstado] = useState<{ activo: boolean; puede_configurar: boolean } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<any>('/bloqueo-documentacion/estado')
      .then(r => { if (alive) setEstado(r?.data ?? null); })
      .catch(() => { if (alive) setEstado(null); });
    return () => { alive = false; };
  }, []);

  if (!estado?.puede_configurar) return null;

  const cambiar = async () => {
    const nuevo = !estado.activo;
    if (!window.confirm(nuevo
      ? '¿Activar el bloqueo por documentación de la TANDA 1? A todos les va a pedir el código al iniciar sesión.'
      : '¿Desactivar el bloqueo por documentación de la TANDA 1? Nadie va a ver el cartel hasta que se vuelva a activar.')) return;
    setGuardando(true);
    if (await cambiarBloqueoDocumentacion(nuevo)) setEstado({ ...estado, activo: nuevo });
    setGuardando(false);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      margin: '8px 0', padding: '8px 12px', borderRadius: 8,
      border: `1px solid ${estado.activo ? 'rgba(220,38,38,0.5)' : 'rgba(148,163,184,0.4)'}`,
      background: estado.activo ? 'rgba(127,29,29,0.18)' : 'rgba(148,163,184,0.08)',
      fontSize: '0.84rem',
    }}>
      <span>🔒 Bloqueo por documentación TANDA 1: <b>{estado.activo ? 'ACTIVO' : 'DESACTIVADO'}</b></span>
      <span className="muted" style={{ fontSize: '0.76rem' }}>(solo se cambia desde esta PC del servidor)</span>
      <button type="button" onClick={cambiar} disabled={guardando}
        style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: 'none', fontWeight: 700, cursor: guardando ? 'wait' : 'pointer',
                 background: estado.activo ? '#334155' : '#7f1d1d', color: '#fff' }}>
        {guardando ? 'Guardando…' : estado.activo ? 'Desactivar' : 'Activar'}
      </button>
    </div>
  );
}

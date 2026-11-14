// src/components/ResolucionesSinArchivoBanner.tsx
// Banner "resoluciones sin archivo escaneado" (GET /resoluciones-sin-archivo).
//  - modo "resumen" (dashboard): una línea con el total y link a Resoluciones.
//  - modo "completo" (página Resoluciones): lista desplegable; cada fila se abre en el
//    visor (onAbrir) o se desactiva (🔕) — la desactivada no vuelve a aparecer.
// Cuando la resolución queda vinculada a su archivo, sale sola del listado.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/http';

export interface ResolucionSinArchivo {
  id: number;
  dni: number;
  numero: string;
  motivo: string | null;
  fecha: string | null;
  agente: string;
  estado: 'EMPATE' | 'ENCONTRADO' | 'SIN_ARCHIVO';
  posibles: string[];
}

/** Disparar después de vincular un archivo a mano, para que el banner se actualice. */
export const EVENTO_RES_VINCULO = 'resoluciones:vinculo';

const ESTADO_TXT: Record<ResolucionSinArchivo['estado'], string> = {
  EMPATE: 'Hay varios posibles: elegir',
  ENCONTRADO: 'Encontrado: abrir para confirmar',
  SIN_ARCHIVO: 'No está en Resoluciones y Varios',
};
const ESTADO_COLOR: Record<ResolucionSinArchivo['estado'], string> = {
  EMPATE: '#fcd34d', ENCONTRADO: '#86efac', SIN_ARCHIVO: '#fca5a5',
};

const fmtFecha = (d: string | null) => (d ? new Date(d).toLocaleDateString('es-AR', { timeZone: 'UTC' }) : '—');

export function ResolucionesSinArchivoBanner({ modo, onAbrir }: {
  modo: 'resumen' | 'completo';
  onAbrir?: (r: ResolucionSinArchivo) => void;
}) {
  const [items, setItems] = useState<ResolucionSinArchivo[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [enviando, setEnviando] = useState<number | null>(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<any>('/resoluciones-sin-archivo');
      if (r?.ok) setItems(r.data || []);
    } catch { /* sin conexión: se reintenta en la próxima vuelta */ }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const id = window.setInterval(cargar, 300_000);
    window.addEventListener(EVENTO_RES_VINCULO, cargar);
    return () => { window.clearInterval(id); window.removeEventListener(EVENTO_RES_VINCULO, cargar); };
  }, [cargar]);

  const desactivar = async (r: ResolucionSinArchivo) => {
    setEnviando(r.id); setError('');
    try {
      const res = await apiFetch<any>(`/resoluciones-sin-archivo/${r.id}/ocultar`, { method: 'POST' });
      if (!res?.ok) throw new Error(res?.error || 'No se pudo desactivar');
      setItems(prev => (prev || []).filter(x => x.id !== r.id));
    } catch (e: any) {
      setError(e?.message || 'No se pudo desactivar');
    } finally { setEnviando(null); }
  };

  // "↻ Buscar de nuevo": registra PDF nuevos de RESOLUCIONES Y VARIOS y vincula los que tengan un solo candidato
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState('');
  const buscarDeNuevo = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setBuscando(true); setError(''); setResultado('');
    try {
      const r = await apiFetch<any>('/resoluciones-sin-archivo/buscar', { method: 'POST', body: JSON.stringify({}) });
      if (!r?.ok) throw new Error(r?.error || 'No se pudo buscar');
      const v = (r.vinculados || []).length;
      setResultado(`${r.registrados || 0} PDF nuevo(s) en la carpeta · ${v} resolución(es) vinculada(s)`);
      await cargar();
      if (v) window.dispatchEvent(new Event(EVENTO_RES_VINCULO));
    } catch (err: any) {
      setError(err?.message || 'No se pudo buscar');
    } finally { setBuscando(false); }
  };

  const conteo = useMemo(() => {
    const c = { EMPATE: 0, ENCONTRADO: 0, SIN_ARCHIVO: 0 };
    (items || []).forEach(i => { c[i.estado]++; });
    return c;
  }, [items]);

  const visibles = useMemo(() => {
    const q = filtro.trim().toUpperCase();
    const orden = { EMPATE: 0, ENCONTRADO: 1, SIN_ARCHIVO: 2 };
    return (items || [])
      .filter(i => !q || `${i.agente} ${i.dni} ${i.numero} ${i.motivo || ''}`.toUpperCase().includes(q))
      .sort((a, b) => orden[a.estado] - orden[b.estado]);
  }, [items, filtro]);

  if (!items || items.length === 0) return null;

  const caja: React.CSSProperties = {
    marginTop: 12, marginBottom: modo === 'completo' ? 12 : 0,
    background: 'rgba(120,53,15,0.25)', border: '1px solid rgba(245,158,11,0.55)',
    borderRadius: 10, padding: '10px 14px', color: '#fde68a',
  };
  const btn: React.CSSProperties = {
    background: 'rgba(120,53,15,0.6)', border: '1px solid #f59e0b', borderRadius: 6, color: '#fef3c7',
    padding: '3px 10px', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const titulo = `⚠️ ${items.length === 1 ? 'Una resolución' : `${items.length} resoluciones`} sin archivo escaneado`;
  const detalle = [
    conteo.EMPATE && `${conteo.EMPATE} para elegir`,
    conteo.ENCONTRADO && `${conteo.ENCONTRADO} encontradas sin confirmar`,
    conteo.SIN_ARCHIVO && `${conteo.SIN_ARCHIVO} no están en la carpeta`,
  ].filter(Boolean).join(' · ');

  if (modo === 'resumen') {
    return (
      <div style={{ ...caja, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.85rem' }}><b>{titulo}</b> <span style={{ fontSize: '0.75rem', color: '#fcd34d' }}>({detalle})</span></span>
        <Link to="/app/resoluciones" style={{ color: '#fcd34d', fontSize: '0.75rem' }}>Ver en Resoluciones →</Link>
      </div>
    );
  }

  return (
    <div style={caja}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
        onClick={() => setAbierto(a => !a)}>
        <span style={{ fontSize: '0.85rem' }}><b>{titulo}</b> <span style={{ fontSize: '0.75rem', color: '#fcd34d' }}>({detalle})</span></span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" style={btn} disabled={buscando} onClick={buscarDeNuevo}
            title="Registra los PDF nuevos de RESOLUCIONES Y VARIOS y vincula los que encuentre">
            {buscando ? 'Buscando…' : '↻ Buscar de nuevo'}
          </button>
          <span style={{ fontSize: '0.75rem', color: '#fcd34d' }}>{abierto ? '▲ Ocultar lista' : '▼ Ver lista'}</span>
        </span>
      </div>
      {resultado && <div style={{ fontSize: '0.75rem', color: '#86efac', marginTop: 4 }}>✅ {resultado}</div>}
      {error && !abierto && <div style={{ color: '#fca5a5', fontSize: '0.75rem', marginTop: 4 }}>⚠️ {error}</div>}
      {abierto && (
        <div style={{ marginTop: 8 }}>
          <input className="input" placeholder="Filtrar por agente, DNI o número…" value={filtro}
            onChange={e => setFiltro(e.target.value)} style={{ fontSize: '0.78rem', maxWidth: 320, marginBottom: 6 }} />
          {error && <div style={{ color: '#fca5a5', fontSize: '0.75rem', marginBottom: 4 }}>⚠️ {error}</div>}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {visibles.map(r => (
              <div key={r.id} style={{
                display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                padding: '5px 0', borderTop: '1px solid rgba(245,158,11,0.2)', fontSize: '0.78rem',
              }}>
                <div style={{ flex: '1 1 340px', minWidth: 0 }}>
                  <b>{r.agente || 'Sin nombre'}</b> <span style={{ color: '#fcd34d' }}>· DNI {r.dni}</span>
                  <div style={{ overflowWrap: 'anywhere' }}>
                    {r.motivo ? `${r.motivo} · ` : ''}<b>{r.numero}</b> · {fmtFecha(r.fecha)}
                  </div>
                  <div style={{ color: ESTADO_COLOR[r.estado], fontSize: '0.72rem', overflowWrap: 'anywhere' }}>
                    {ESTADO_TXT[r.estado]}{r.posibles.length > 0 && `: ${r.posibles.join(' | ')}`}
                  </div>
                </div>
                {onAbrir && <button type="button" style={btn} onClick={() => onAbrir(r)}>📂 Abrir</button>}
                <button type="button" style={btn} disabled={enviando === r.id}
                  title="No volver a mostrar esta resolución en el aviso"
                  onClick={() => desactivar(r)}>{enviando === r.id ? '…' : '🔕 Desactivar'}</button>
              </div>
            ))}
            {visibles.length === 0 && <div style={{ fontSize: '0.75rem', padding: '6px 0' }}>Nada coincide con el filtro.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

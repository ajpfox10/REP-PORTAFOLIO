// src/pages/TramitesDocumentalesPage/CombinarPdfTab.tsx
// Pestaña "Combinación de PDF": elegís una tanda y un agente; el backend combina
// los archivos de las subcarpetas (en el orden de "Orden de documentos") y devuelve
// el PDF + manifiesto de páginas. Acá se ven las páginas (pdfjs), se reordenan
// (arrastrar / ↑↓), se hace zoom, y se guarda el combinado en DOCU.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { pdfjsLib, PageCanvas, base64ToBytes } from './pdfVisor';
import type { TandaAgente, PageItem } from './pdfVisor';

export function CombinarPdfTab() {
  const toast = useToast();
  const [tandas, setTandas] = useState<string[]>([]);
  const [agentesPorTanda, setAgentesPorTanda] = useState<Map<string, TandaAgente[]>>(new Map());
  const [selectedTanda, setSelectedTanda] = useState('');
  const [agente, setAgente] = useState<TandaAgente | null>(null);

  const [pdf, setPdf] = useState<any>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Lupa: una hoja en ventana grande (zoom en % del ancho de la ventana).
  const [lupaIdx, setLupaIdx] = useState<number | null>(null);
  const [lupaZoom, setLupaZoom] = useState(1);
  // Ampliar: el visor entero ocupa toda la pantalla.
  const [ampliado, setAmpliado] = useState(false);

  // Teclado: Esc cierra (primero la lupa), ← → cambian de hoja, + − zoom de la lupa.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (lupaIdx !== null) {
        if (e.key === 'Escape') setLupaIdx(null);
        else if (e.key === 'ArrowLeft') setLupaIdx((i) => (i !== null && i > 0 ? i - 1 : i));
        else if (e.key === 'ArrowRight') setLupaIdx((i) => (i !== null && i < pages.length - 1 ? i + 1 : i));
        else if (e.key === '+' || e.key === '=') setLupaZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
        else if (e.key === '-') setLupaZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
        else return;
        e.preventDefault();
      } else if (ampliado && e.key === 'Escape') {
        setAmpliado(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lupaIdx, ampliado, pages.length]);

  // Ctrl + rueda dentro de la lupa = zoom (listener nativo no-pasivo para frenar el zoom del navegador).
  const lupaScrollRef = useRef<HTMLDivElement | null>(null);
  const lupaAbierta = lupaIdx !== null;
  useEffect(() => {
    const el = lupaScrollRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setLupaZoom((z) => Math.min(4, Math.max(0.5, +(z + (e.deltaY < 0 ? 0.15 : -0.15)).toFixed(2))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [lupaAbierta]);

  // Si la hoja de la lupa se sacó, se queda en una posición válida (o cierra si no quedan).
  useEffect(() => {
    if (lupaIdx !== null && lupaIdx >= pages.length) setLupaIdx(pages.length ? pages.length - 1 : null);
  }, [pages.length, lupaIdx]);
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ ok: boolean; data: { rows: TandaAgente[]; tandas: string[] } }>('/tramites-documentales/tandas');
        const map = new Map<string, TandaAgente[]>();
        for (const r of res.data.rows) { const l = map.get(r.tanda) || []; l.push(r); map.set(r.tanda, l); }
        setAgentesPorTanda(map);
        setTandas(res.data.tandas || []);
      } catch (e: any) { toast.error('No se pudieron cargar tandas', e?.message || 'Error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentesTanda = agentesPorTanda.get(selectedTanda) || [];
  // Buscador dentro de la tanda: por DNI (dígitos) o por apellido/nombre (sin tildes ni mayúsculas)
  const [busqueda, setBusqueda] = useState('');
  const sinTildes = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const agentesFiltrados = useMemo(() => {
    const q = busqueda.trim();
    if (!q) return agentesTanda;
    const dig = q.replace(/\D/g, '');
    if (dig && dig.length === q.replace(/[\s.]/g, '').length) return agentesTanda.filter((a) => String(a.dni).includes(dig));
    const palabras = sinTildes(q).split(/[\s,]+/).filter(Boolean);
    return agentesTanda.filter((a) => { const n = sinTildes(a.apellidoNombre || ''); return palabras.every((w) => n.includes(w)); });
  }, [agentesTanda, busqueda]);

  const combinar = useCallback(async (a: TandaAgente) => {
    setAgente(a); setPdf(null); setPages([]); setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { pages: Omit<PageItem, 'origIdx'>[]; pdfBase64: string; saltados: any[] } }>(
        '/tramites-documentales/combinar-agente',
        { method: 'POST', body: JSON.stringify({ dni: a.dni }) }
      );
      const doc = await pdfjsLib.getDocument({ data: base64ToBytes(res.data.pdfBase64) }).promise;
      setPdf(doc);
      setPages(res.data.pages.map((p, i) => ({ ...p, origIdx: i, rot: 0 })));
    } catch (e: any) {
      toast.error('No se pudo combinar', e?.message || 'Error');
    } finally { setLoading(false); }
  }, [toast]);

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= pages.length) return;
    setPages((prev) => { const n = prev.slice(); [n[idx], n[j]] = [n[j], n[idx]]; return n; });
  }
  function onDrop(idx: number) {
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from === null || from === idx) return;
    setPages((prev) => { const n = prev.slice(); const [m] = n.splice(from, 1); n.splice(idx, 0, m); return n; });
  }

  // Saca la hoja → DOCU\<dni>\Trasladados\<subcarpeta>\ (se recupera en ♻️ Restaurar).
  async function sacar(p: PageItem) {
    if (!agente || busyId) return;
    setBusyId(p.id);
    try {
      const res = await apiFetch<{ ok: boolean; data: { modo: 'hoja' | 'archivo'; trasladado: string } }>(
        '/tramites-documentales/combinar-sacar',
        { method: 'POST', body: JSON.stringify({ dni: agente.dni, rel: p.rel, page: p.page }) }
      );
      setPages((prev) => res.data.modo === 'archivo'
        ? prev.filter((x) => x.rel !== p.rel)
        // el original quedó sin esa hoja: las siguientes del mismo archivo corren una posición
        : prev.filter((x) => x.id !== p.id).map((x) => (x.rel === p.rel && x.page > p.page ? { ...x, page: x.page - 1 } : x)));
      toast.ok('Hoja trasladada', `→ ${res.data.trasladado} (se recupera en ♻️ Restaurar)`);
    } catch (e: any) {
      toast.error('No se pudo sacar la hoja', e?.message || 'Error');
    } finally { setBusyId(null); }
  }

  // Rota la hoja en el archivo original.
  async function rotar(p: PageItem, delta: 90 | -90) {
    if (!agente || busyId) return;
    setBusyId(p.id);
    try {
      await apiFetch('/tramites-documentales/combinar-rotar',
        { method: 'POST', body: JSON.stringify({ dni: agente.dni, rel: p.rel, page: p.page, delta }) });
      setPages((prev) => prev.map((x) => (x.id === p.id ? { ...x, rot: x.rot + delta } : x)));
    } catch (e: any) {
      toast.error('No se pudo rotar', e?.message || 'Error');
    } finally { setBusyId(null); }
  }

  async function guardar() {
    if (!agente || !pages.length) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { paginas: number; ruta: string } }>(
        '/tramites-documentales/combinar-guardar',
        { method: 'POST', body: JSON.stringify({ dni: agente.dni, pages: pages.map((p) => ({ rel: p.rel, page: p.page })) }) }
      );
      toast.ok('Combinado guardado', `${res.data.paginas} páginas → ${res.data.ruta}`);
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message || 'Error');
    } finally { setSaving(false); }
  }

  const chip: React.CSSProperties = { padding: '5px 14px', borderRadius: 999, fontSize: '0.78rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)' };
  const iconBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#cbd5e1', cursor: 'pointer', width: 28, height: 26, fontSize: '0.8rem' };

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 480 }}>
      {/* Izquierda: tandas + agentes */}
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>Tandas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tandas.map((t) => (
            <button key={t} type="button" onClick={() => { setSelectedTanda(t); setAgente(null); setPdf(null); setPages([]); }}
              style={{ ...chip, background: selectedTanda === t ? '#7c3aed' : 'rgba(255,255,255,0.05)', color: selectedTanda === t ? '#fff' : '#cbd5e1' }}>
              {t} <span style={{ opacity: 0.7 }}>({agentesPorTanda.get(t)?.length || 0})</span>
            </button>
          ))}
          {!tandas.length && <div style={{ color: '#64748b', fontSize: '0.82rem' }}>No hay tandas.</div>}
        </div>
        {selectedTanda && (
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por DNI o apellido…" aria-label="Buscar agente de la tanda por DNI o apellido"
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: '0.84rem' }} />
        )}
        {selectedTanda && busqueda.trim() && (
          <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: -4 }}>{agentesFiltrados.length} de {agentesTanda.length}</div>
        )}
        <div style={{ flex: 1, overflow: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
          {agentesFiltrados.map((a) => (
            <div key={a.id} onClick={() => void combinar(a)}
              style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: agente?.id === a.id ? 'rgba(124,58,237,0.22)' : 'transparent' }}>
              <div style={{ color: '#e2e8f0', fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.apellidoNombre || `DNI ${a.dni}`}</div>
              <div style={{ color: '#64748b', fontSize: '0.72rem' }}>DNI {a.dni}</div>
            </div>
          ))}
          {selectedTanda && !!agentesTanda.length && !agentesFiltrados.length && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Nadie coincide con «{busqueda}».</div>}
          {selectedTanda && !agentesTanda.length && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Tanda vacía.</div>}
          {!selectedTanda && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Elegí una tanda.</div>}
        </div>
      </div>

      {/* Derecha: visor (con "Ampliar" pasa a ocupar toda la pantalla) */}
      <div style={ampliado
        ? { position: 'fixed', inset: 10, zIndex: 1000, background: '#0b1220', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10,
            padding: 12, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }
        : { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!agente ? (
          <div style={{ color: '#64748b', fontSize: '0.85rem', margin: 'auto' }}>Elegí un agente para combinar sus documentos.</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
              <strong style={{ color: '#fff', fontSize: '0.9rem' }}>{agente.apellidoNombre || `DNI ${agente.dni}`}</strong>
              <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{pages.length} página(s)</span>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" style={iconBtn} onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}>−</button>
                <span style={{ color: '#94a3b8', fontSize: '0.75rem', width: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                <button type="button" style={iconBtn} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}>+</button>
              </div>
              <button type="button" onClick={() => setAmpliado((a) => !a)} title={ampliado ? 'Volver (Esc)' : 'Ver el visor a pantalla completa'}
                style={{ ...iconBtn, width: 'auto', padding: '0 10px' }}>
                {ampliado ? '✕ Cerrar' : '⛶ Ampliar'}
              </button>
              <button type="button" onClick={() => void guardar()} disabled={saving || !pages.length}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.82rem',
                  background: saving || !pages.length ? 'rgba(255,255,255,0.08)' : '#0f766e', color: saving || !pages.length ? '#64748b' : '#fff',
                  cursor: saving || !pages.length ? 'default' : 'pointer' }}>
                {saving ? 'Guardando…' : '💾 Guardar combinado'}
              </button>
            </div>

            {loading ? (
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: 20 }}>Combinando y renderizando…</div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: 4 }}>
                {pages.map((p, idx) => (
                  <div key={p.id}
                    draggable
                    onDragStart={() => { dragIdx.current = idx; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(idx)}
                    style={{ display: 'flex', gap: 10, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 8, background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ color: '#64748b', fontSize: '0.72rem' }}>#{idx + 1}</span>
                      <button type="button" style={{ ...iconBtn, opacity: idx === 0 ? 0.3 : 1 }} disabled={idx === 0} onClick={() => move(idx, -1)}>↑</button>
                      <button type="button" style={{ ...iconBtn, opacity: idx === pages.length - 1 ? 0.3 : 1 }} disabled={idx === pages.length - 1} onClick={() => move(idx, 1)}>↓</button>
                      <span title="Arrastrar" style={{ cursor: 'grab', color: '#64748b', fontSize: '1rem' }}>⠿</span>
                      <div style={{ height: 6 }} />
                      <button type="button" title="Lupa: ver esta hoja grande" style={iconBtn}
                        onClick={() => { setLupaIdx(idx); setLupaZoom(1); }}>🔍</button>
                      <button type="button" title="Rotar a la izquierda (corrige el archivo original)" style={{ ...iconBtn, opacity: busyId ? 0.4 : 1 }}
                        disabled={!!busyId} onClick={() => void rotar(p, -90)}>↺</button>
                      <button type="button" title="Rotar a la derecha (corrige el archivo original)" style={{ ...iconBtn, opacity: busyId ? 0.4 : 1 }}
                        disabled={!!busyId} onClick={() => void rotar(p, 90)}>↻</button>
                      <button type="button" title="Sacar esta hoja → carpeta Trasladados (se recupera en ♻️ Restaurar)"
                        style={{ ...iconBtn, color: '#fca5a5', borderColor: 'rgba(248,113,113,0.4)', opacity: busyId ? 0.4 : 1 }}
                        disabled={!!busyId} onClick={() => void sacar(p)}>{busyId === p.id ? '…' : '✕'}</button>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#cbd5e1', fontSize: '0.75rem', marginBottom: 4 }}>
                        <strong style={{ color: '#a5b4fc' }}>{p.doc}</strong> · {p.archivo}{p.page > 0 ? ` (pág ${p.page + 1})` : ''}
                      </div>
                      <div style={{ maxWidth: (ampliado ? 900 : 640) * zoom, transition: 'max-width 0.1s', cursor: 'zoom-in' }}
                        onDoubleClick={() => { setLupaIdx(idx); setLupaZoom(1); }} title="Doble clic: lupa">
                        {pdf && <PageCanvas pdf={pdf} origIdx={p.origIdx} rot={p.rot} />}
                      </div>
                    </div>
                  </div>
                ))}
                {!pages.length && <div style={{ color: '#64748b', fontSize: '0.85rem', padding: 20 }}>Sin páginas combinables.</div>}
              </div>
            )}
          </>
        )}
      </div>

      {/* Lupa: la hoja en una ventana grande, con zoom, ← → y las mismas acciones */}
      {lupaIdx !== null && pages[lupaIdx] && pdf && (() => {
        const p = pages[lupaIdx];
        return (
          <div onClick={() => setLupaIdx(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(2,6,23,0.85)', display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 1400, display: 'flex', flexDirection: 'column', background: '#0b1220', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <span style={{ color: '#64748b', fontSize: '0.75rem' }}>#{lupaIdx + 1} de {pages.length}</span>
                <strong style={{ color: '#a5b4fc', fontSize: '0.8rem' }}>{p.doc}</strong>
                <span style={{ color: '#cbd5e1', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>
                  {p.archivo}{p.page > 0 ? ` (pág ${p.page + 1})` : ''}
                </span>
                <div style={{ flex: 1 }} />
                <button type="button" style={{ ...iconBtn, opacity: lupaIdx === 0 ? 0.3 : 1 }} disabled={lupaIdx === 0} title="Hoja anterior (←)"
                  onClick={() => setLupaIdx(lupaIdx - 1)}>‹</button>
                <button type="button" style={{ ...iconBtn, opacity: lupaIdx === pages.length - 1 ? 0.3 : 1 }} disabled={lupaIdx === pages.length - 1} title="Hoja siguiente (→)"
                  onClick={() => setLupaIdx(lupaIdx + 1)}>›</button>
                <span style={{ width: 8 }} />
                <button type="button" style={iconBtn} title="Alejar (−)" onClick={() => setLupaZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
                <span style={{ color: '#94a3b8', fontSize: '0.75rem', width: 44, textAlign: 'center' }}>{Math.round(lupaZoom * 100)}%</span>
                <button type="button" style={iconBtn} title="Acercar (+)" onClick={() => setLupaZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
                <button type="button" style={{ ...iconBtn, width: 'auto', padding: '0 8px' }} title="Ajustar al ancho" onClick={() => setLupaZoom(1)}>Ajustar</button>
                <span style={{ width: 8 }} />
                <button type="button" style={{ ...iconBtn, opacity: busyId ? 0.4 : 1 }} disabled={!!busyId} title="Rotar a la izquierda" onClick={() => void rotar(p, -90)}>↺</button>
                <button type="button" style={{ ...iconBtn, opacity: busyId ? 0.4 : 1 }} disabled={!!busyId} title="Rotar a la derecha" onClick={() => void rotar(p, 90)}>↻</button>
                <button type="button" title="Sacar esta hoja → Trasladados"
                  style={{ ...iconBtn, color: '#fca5a5', borderColor: 'rgba(248,113,113,0.4)', opacity: busyId ? 0.4 : 1 }}
                  disabled={!!busyId} onClick={() => void sacar(p)}>{busyId === p.id ? '…' : '✕'}</button>
                <span style={{ width: 8 }} />
                <button type="button" style={{ ...iconBtn, width: 'auto', padding: '0 10px' }} title="Cerrar (Esc)" onClick={() => setLupaIdx(null)}>Cerrar</button>
              </div>
              {/* Ctrl + rueda = zoom; rueda sola = desplazar */}
              <div ref={lupaScrollRef} style={{ flex: 1, overflow: 'auto', padding: 16, background: '#111827' }}>
                <div style={{ width: `${lupaZoom * 100}%`, margin: lupaZoom <= 1 ? '0 auto' : 0 }}>
                  <PageCanvas key={p.id} pdf={pdf} origIdx={p.origIdx} rot={p.rot} scale={2.5} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

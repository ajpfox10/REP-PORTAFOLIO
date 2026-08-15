// src/pages/TramitesDocumentalesPage/CombinarPdfTab.tsx
// Pestaña "Combinación de PDF": elegís una tanda y un agente; el backend combina
// los archivos de las subcarpetas (en el orden de "Orden de documentos") y devuelve
// el PDF + manifiesto de páginas. Acá se ven las páginas (pdfjs), se reordenan
// (arrastrar / ↑↓), se hace zoom, y se guarda el combinado en DOCU.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// Vite empaqueta el worker a partir de este patrón (sin necesitar tipos de "?url").
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

const RENDER_SCALE = 1.3; // resolución de render; el zoom es CSS sobre esto

type TandaAgente = { id: number; tanda: string; dni: number; apellidoNombre: string };
type PageItem = { id: string; doc: string; rel: string; page: number; archivo: string; origIdx: number };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// Renderiza una página del pdf en un canvas (una sola vez por origIdx).
function PageCanvas({ pdf, origIdx }: { pdf: any; origIdx: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const page = await pdf.getPage(origIdx + 1);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = ref.current;
        if (!canvas || cancel) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch { /* noop */ }
    })();
    return () => { cancel = true; };
  }, [pdf, origIdx]);
  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: 'auto', background: '#fff', borderRadius: 4 }} />;
}

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

  const combinar = useCallback(async (a: TandaAgente) => {
    setAgente(a); setPdf(null); setPages([]); setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { pages: Omit<PageItem, 'origIdx'>[]; pdfBase64: string; saltados: any[] } }>(
        '/tramites-documentales/combinar-agente',
        { method: 'POST', body: JSON.stringify({ dni: a.dni }) }
      );
      const doc = await pdfjsLib.getDocument({ data: base64ToBytes(res.data.pdfBase64) }).promise;
      setPdf(doc);
      setPages(res.data.pages.map((p, i) => ({ ...p, origIdx: i })));
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
        <div style={{ flex: 1, overflow: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
          {agentesTanda.map((a) => (
            <div key={a.id} onClick={() => void combinar(a)}
              style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: agente?.id === a.id ? 'rgba(124,58,237,0.22)' : 'transparent' }}>
              <div style={{ color: '#e2e8f0', fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.apellidoNombre || `DNI ${a.dni}`}</div>
              <div style={{ color: '#64748b', fontSize: '0.72rem' }}>DNI {a.dni}</div>
            </div>
          ))}
          {selectedTanda && !agentesTanda.length && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Tanda vacía.</div>}
          {!selectedTanda && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Elegí una tanda.</div>}
        </div>
      </div>

      {/* Derecha: visor */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#cbd5e1', fontSize: '0.75rem', marginBottom: 4 }}>
                        <strong style={{ color: '#a5b4fc' }}>{p.doc}</strong> · {p.archivo}{p.page > 0 ? ` (pág ${p.page + 1})` : ''}
                      </div>
                      <div style={{ maxWidth: 640 * zoom, transition: 'max-width 0.1s' }}>
                        {pdf && <PageCanvas pdf={pdf} origIdx={p.origIdx} />}
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
    </div>
  );
}

// src/pages/EscaneoPage/ScanPagesOrganizer.tsx
// Modal para ordenar / rotar / quitar las páginas escaneadas antes de guardar.
// Compartido por EscaneoPage, EscaneoAgentePage y ResolucionesPage.
//
// El orden y las bajas se trabajan sobre un borrador y se aplican con "Aplicar".
// La rotación es inmediata (el servidor reescribe el archivo y cambia el storageKey),
// por eso las páginas se identifican por jobId:pageNumber, que no cambia al rotar.
import React, { useEffect, useMemo, useState } from 'react';

export interface OrganizerPage {
  jobId: number;
  pageNumber: number;
  storageKey: string;
  blobUrl: string | null;
  loadError: boolean;
  rotating?: boolean;
}

export function scanPageId(p: { jobId: number; pageNumber: number }): string {
  return `${p.jobId}:${p.pageNumber}`;
}

/** Reordena/filtra la sesión según los ids que devuelve el organizador y libera los blobs quitados. */
export function applyScanPageOrder<T extends OrganizerPage>(prev: T[], ids: string[]): T[] {
  const byId = new Map(prev.map(p => [scanPageId(p), p]));
  const keep = new Set(ids);
  prev.forEach(p => {
    if (!keep.has(scanPageId(p)) && p.blobUrl) URL.revokeObjectURL(p.blobUrl);
  });
  return ids.map(id => byId.get(id)).filter((p): p is T => !!p);
}

type Props<T extends OrganizerPage> = {
  pages: T[];
  initialPageId?: string | null;
  onRotate: (page: T, degrees: number) => void;
  onApply: (ids: string[]) => void;
  onClose: () => void;
};

export function ScanPagesOrganizer<T extends OrganizerPage>({ pages, initialPageId, onRotate, onApply, onClose }: Props<T>) {
  const [order, setOrder] = useState<string[]>(() => pages.map(scanPageId));
  const [selected, setSelected] = useState<string | null>(initialPageId ?? null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [zoomId, setZoomId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(pages.map(p => [scanPageId(p), p])), [pages]);
  // Si una página desaparece de la sesión (ej. descartada afuera), sacarla del borrador
  const visible = order.filter(id => byId.has(id));
  const removedCount = pages.length - visible.length;
  const changed = removedCount > 0 || visible.some((id, i) => scanPageId(pages[i] ?? { jobId: -1, pageNumber: -1 }) !== id);
  const anyRotating = pages.some(p => p.rotating);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (zoomId) setZoomId(null); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomId, onClose]);

  const move = (id: string, delta: number) => {
    setOrder(prev => {
      const list = prev.filter(x => byId.has(x));
      const from = list.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return list;
      const next = [...list];
      next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  };

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setOrder(prev => {
      const list = prev.filter(x => byId.has(x) && x !== dragId);
      const idx = list.indexOf(targetId);
      // Arrastrando hacia adelante queda después del destino; hacia atrás, antes.
      const fromIdx = prev.filter(x => byId.has(x)).indexOf(dragId);
      const toIdx = prev.filter(x => byId.has(x)).indexOf(targetId);
      list.splice(fromIdx < toIdx ? idx + 1 : idx, 0, dragId);
      return list;
    });
  };

  const remove = (id: string) => {
    setOrder(prev => prev.filter(x => x !== id));
    if (selected === id) setSelected(null);
  };

  const zoomPage = zoomId ? byId.get(zoomId) : null;

  return (
    <div className="scan-viewer-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="scan-viewer-modal scan-org-modal" onClick={e => e.stopPropagation()}>
        <div className="scan-viewer-header">
          <div className="scan-viewer-title">
            🗂️ Ordenar páginas <span className="muted" style={{ fontWeight: 400 }}>· {visible.length} pág.</span>
          </div>
          <div className="scan-viewer-actions">
            <button type="button" className="btn" disabled={visible.length < 2}
              onClick={() => setOrder(prev => prev.filter(x => byId.has(x)).reverse())}
              title="Para cuando las hojas entraron al alimentador al revés">
              ⇅ Invertir orden
            </button>
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn primary" disabled={anyRotating || visible.length === 0}
              onClick={() => onApply(visible)}
              title={visible.length === 0 ? 'Para quitar todas usá Descartar' : undefined}>
              ✅ Aplicar{changed ? '' : ' (sin cambios)'}
            </button>
          </div>
        </div>

        <div className="scan-org-hint muted">
          Arrastrá las páginas para ordenarlas · doble click para ampliar
          {removedCount > 0 && <> · <b style={{ color: '#fca5a5' }}>{removedCount} quitada(s)</b></>}
          <span style={{ marginLeft: 'auto' }}>La rotación se aplica en el momento</span>
        </div>

        <div className="scan-org-body">
          <div className="scan-org-grid">
            {visible.map((id, idx) => {
              const page = byId.get(id)!;
              return (
                <div key={id}
                  className={`scan-org-item${selected === id ? ' selected' : ''}${dragId === id ? ' dragging' : ''}${overId === id && dragId !== id ? ' over' : ''}`}
                  draggable={!page.rotating}
                  onClick={() => setSelected(id)}
                  onDoubleClick={() => page.blobUrl && setZoomId(id)}
                  onDragStart={e => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={e => { e.preventDefault(); if (overId !== id) setOverId(id); }}
                  onDragLeave={() => setOverId(prev => prev === id ? null : prev)}
                  onDrop={e => { e.preventDefault(); dropOn(id); setDragId(null); setOverId(null); }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}>
                  <div className="scan-org-frame">
                    {page.blobUrl ? (
                      <img src={page.blobUrl} alt={`Página ${idx + 1}`} draggable={false} />
                    ) : page.loadError ? (
                      <div className="scan-preview-state scan-preview-error">❌<br />Error</div>
                    ) : (
                      <div className="scan-preview-state">Cargando…</div>
                    )}
                    {page.rotating && <div className="scan-org-busy">Rotando…</div>}
                    <button type="button" className="scan-preview-remove" title="Quitar página"
                      onClick={e => { e.stopPropagation(); remove(id); }}>×</button>
                  </div>
                  <div className="scan-org-num">Pág. {idx + 1}</div>
                  <div className="scan-org-tools" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
                    <button type="button" disabled={idx === 0} onClick={() => move(id, -1)} title="Mover antes">◀</button>
                    <button type="button" disabled={page.rotating || !page.blobUrl} onClick={() => onRotate(page, 270)} title="Rotar 90° a la izquierda">↺</button>
                    <button type="button" disabled={page.rotating || !page.blobUrl} onClick={() => onRotate(page, 180)} title="Rotar 180°">180°</button>
                    <button type="button" disabled={page.rotating || !page.blobUrl} onClick={() => onRotate(page, 90)} title="Rotar 90° a la derecha">↻</button>
                    <button type="button" disabled={idx === visible.length - 1} onClick={() => move(id, 1)} title="Mover después">▶</button>
                  </div>
                </div>
              );
            })}
          </div>
          {visible.length === 0 && (
            <div className="scan-empty-inline" style={{ margin: 20 }}>
              Quitaste todas las páginas. Cancelá para volver, o usá "Descartar" afuera.
            </div>
          )}
        </div>

        {zoomPage?.blobUrl && (
          <div className="scan-org-zoom" onClick={() => setZoomId(null)}>
            <img src={zoomPage.blobUrl} alt="Página ampliada" />
            <div className="scan-org-zoom-hint">Click o Esc para volver</div>
          </div>
        )}
      </div>
    </div>
  );
}

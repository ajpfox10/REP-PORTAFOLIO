// src/pages/TramitesDocumentalesPage/pdfVisor.tsx
// Visor compartido por "Combinación de PDF" y "Documentos": pdfjs + render de una página.
import React, { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
export { pdfjsLib };

// Vite empaqueta el worker a partir de este patrón (sin necesitar tipos de "?url").
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

// Resolución de render, relativa a una hoja NORMAL (lado corto = 612 pt, carta/oficio): cada página
// se dibuja a ~ RENDER_SCALE × 612 px de ancho sea cual sea su tamaño en puntos. Antes una foto metida
// a 1 px = 1 pt (2480 pt) se dibujaba a ~3200 px y el navegador la achicaba ×5 → letra finita y clara.
// El zoom es CSS sobre esto.
export const RENDER_SCALE = 2;
const LADO_NORMAL_PT = 612;

export type TandaAgente = { id: number; tanda: string; dni: number; apellidoNombre: string };
// rot = rotación aplicada después de combinar (ya guardada en el original; acá solo se
// suma al render porque el PDF combinado en memoria es el de antes de rotar).
export type PageItem = { id: string; doc: string; rel: string; page: number; archivo: string; origIdx: number; rot: number };

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// Renderiza una página del pdf en un canvas (una sola vez por origIdx).
export function PageCanvas({ pdf, origIdx, rot = 0, scale = RENDER_SCALE }: { pdf: any; origIdx: number; rot?: number; scale?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const page = await pdf.getPage(origIdx + 1);
        const rotation = ((((page.rotate || 0) + rot) % 360) + 360) % 360;
        const base = page.getViewport({ scale: 1, rotation });
        const corto = Math.min(base.width, base.height) || LADO_NORMAL_PT;
        const viewport = page.getViewport({ scale: scale * (LADO_NORMAL_PT / corto), rotation });
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
  }, [pdf, origIdx, rot, scale]);
  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: 'auto', background: '#fff', borderRadius: 4 }} />;
}


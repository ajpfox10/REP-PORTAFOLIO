// src/pages/TramitesDocumentalesPage/RestaurarTab.tsx
// Pestaña "♻️ Restaurar": lo que se sacó en "Combinación de PDF" queda en
// DOCU\<dni>\Trasladados\<subcarpeta>\. Acá se lista (por tanda o todas), se ve
// y se devuelve a su subcarpeta de origen (sin pisar archivos existentes).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

type TandaAgente = { id: number; tanda: string; dni: number; apellidoNombre: string };
type Trasladado = { dni: number; rel: string; carpeta: string; archivo: string; bytes: number; fecha: string };
type Preview = { row: Trasladado; tipo: 'pdf' | 'jpg' | 'png' | 'otro'; pdf?: any; src?: string };

const TODAS = '__todas__';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function PdfPage({ pdf, n }: { pdf: any; n: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = ref.current;
        if (!canvas || cancel) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
      } catch { /* noop */ }
    })();
    return () => { cancel = true; };
  }, [pdf, n]);
  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: 'auto', background: '#fff', borderRadius: 4 }} />;
}

export function RestaurarTab() {
  const toast = useToast();
  const [tandas, setTandas] = useState<string[]>([]);
  const [agentes, setAgentes] = useState<TandaAgente[]>([]);
  const [selectedTanda, setSelectedTanda] = useState(TODAS);
  const [rows, setRows] = useState<Trasladado[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ ok: boolean; data: { rows: TandaAgente[]; tandas: string[] } }>('/tramites-documentales/tandas');
        setAgentes(res.data.rows || []);
        setTandas(res.data.tandas || []);
      } catch (e: any) { toast.error('No se pudieron cargar tandas', e?.message || 'Error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nombrePorDni = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of agentes) if (!m.has(a.dni)) m.set(a.dni, a.apellidoNombre);
    return m;
  }, [agentes]);

  const cargar = useCallback(async () => {
    const dnis = Array.from(new Set(
      agentes.filter((a) => selectedTanda === TODAS || a.tanda === selectedTanda).map((a) => a.dni)
    ));
    if (!dnis.length) { setRows([]); return; }
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: Trasladado[] } }>(
        `/tramites-documentales/trasladados?dnis=${dnis.join(',')}`
      );
      setRows(res.data.rows || []);
    } catch (e: any) {
      toast.error('No se pudo listar lo trasladado', e?.message || 'Error');
    } finally { setLoading(false); }
  }, [agentes, selectedTanda, toast]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function ver(row: Trasladado) {
    setPreview({ row, tipo: 'otro' });
    try {
      const qs = new URLSearchParams({ dni: String(row.dni), rel: row.rel });
      const res = await apiFetch<{ ok: boolean; data: { tipo: Preview['tipo']; base64: string | null } }>(
        `/tramites-documentales/trasladados/archivo?${qs.toString()}`
      );
      const { tipo, base64 } = res.data;
      if (tipo === 'pdf' && base64) {
        const pdf = await pdfjsLib.getDocument({ data: base64ToBytes(base64) }).promise;
        setPreview({ row, tipo, pdf });
      } else if ((tipo === 'jpg' || tipo === 'png') && base64) {
        setPreview({ row, tipo, src: `data:image/${tipo === 'jpg' ? 'jpeg' : 'png'};base64,${base64}` });
      } else {
        setPreview({ row, tipo: 'otro' });
      }
    } catch (e: any) {
      toast.error('No se pudo abrir', e?.message || 'Error');
    }
  }

  async function restaurar(row: Trasladado) {
    setBusy(row.rel + row.dni);
    try {
      const res = await apiFetch<{ ok: boolean; data: { rel: string } }>('/tramites-documentales/trasladados/restaurar', {
        method: 'POST', body: JSON.stringify({ dni: row.dni, rel: row.rel }),
      });
      toast.ok('Restaurado', `→ ${res.data.rel}`);
      setRows((prev) => prev.filter((r) => !(r.dni === row.dni && r.rel === row.rel)));
      if (preview?.row.rel === row.rel && preview.row.dni === row.dni) setPreview(null);
    } catch (e: any) {
      toast.error('No se pudo restaurar', e?.message || 'Error');
    } finally { setBusy(null); }
  }

  const chip: React.CSSProperties = { padding: '5px 14px', borderRadius: 999, fontSize: '0.78rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)' };
  const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', cursor: 'pointer', fontSize: '0.75rem' };
  const fmtFecha = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {[TODAS, ...tandas].map((t) => (
          <button key={t} type="button" onClick={() => { setSelectedTanda(t); setPreview(null); }}
            style={{ ...chip, background: selectedTanda === t ? '#7c3aed' : 'rgba(255,255,255,0.05)', color: selectedTanda === t ? '#fff' : '#cbd5e1' }}>
            {t === TODAS ? 'Todas las tandas' : t}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={() => void cargar()}>⟳ Actualizar</button>
      </div>
      <div style={{ color: '#64748b', fontSize: '0.75rem' }}>
        Hojas y archivos sacados en «Combinación de PDF». Están en la carpeta <code>Trasladados</code> de cada agente; «Restaurar» los devuelve a su subcarpeta.
      </div>

      <div style={{ display: 'flex', gap: 16, minHeight: 420 }}>
        <div style={{ flex: 1, minWidth: 0, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'auto' }}>
          {loading ? (
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: 16 }}>Buscando…</div>
          ) : !rows.length ? (
            <div style={{ color: '#64748b', fontSize: '0.85rem', padding: 16 }}>No hay nada trasladado.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Agente</th>
                  <th style={{ padding: '8px 10px' }}>Documento</th>
                  <th style={{ padding: '8px 10px' }}>Archivo</th>
                  <th style={{ padding: '8px 10px' }}>Sacado</th>
                  <th style={{ padding: '8px 10px' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sel = preview?.row.dni === r.dni && preview?.row.rel === r.rel;
                  return (
                    <tr key={`${r.dni}|${r.rel}`} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: sel ? 'rgba(124,58,237,0.18)' : 'transparent' }}>
                      <td style={{ padding: '6px 10px', color: '#e2e8f0' }}>
                        {nombrePorDni.get(r.dni) || '—'}<div style={{ color: '#64748b', fontSize: '0.7rem' }}>DNI {r.dni}</div>
                      </td>
                      <td style={{ padding: '6px 10px', color: '#a5b4fc' }}>{r.carpeta}</td>
                      <td style={{ padding: '6px 10px', color: '#cbd5e1', wordBreak: 'break-all' }}>{r.archivo}</td>
                      <td style={{ padding: '6px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtFecha(r.fecha)}</td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" style={btn} onClick={() => void ver(r)}>👁 Ver</button>{' '}
                        <button type="button" disabled={!!busy} onClick={() => void restaurar(r)}
                          style={{ ...btn, background: '#0f766e', color: '#fff', border: 'none', opacity: busy ? 0.5 : 1 }}>
                          {busy === r.rel + r.dni ? 'Restaurando…' : '♻️ Restaurar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ width: 480, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 10, overflow: 'auto', maxHeight: '75vh' }}>
          {!preview ? (
            <div style={{ color: '#64748b', fontSize: '0.82rem' }}>Elegí «Ver» para previsualizar.</div>
          ) : (
            <>
              <div style={{ color: '#cbd5e1', fontSize: '0.75rem', marginBottom: 8 }}>
                <strong style={{ color: '#a5b4fc' }}>{preview.row.carpeta}</strong> · {preview.row.archivo}
              </div>
              {preview.tipo === 'pdf' && preview.pdf
                ? Array.from({ length: preview.pdf.numPages }, (_, i) => (
                  <div key={i} style={{ marginBottom: 10 }}><PdfPage pdf={preview.pdf} n={i + 1} /></div>
                ))
                : preview.src
                  ? <img src={preview.src} alt={preview.row.archivo} style={{ width: '100%', borderRadius: 4, background: '#fff' }} />
                  : <div style={{ color: '#64748b', fontSize: '0.8rem' }}>Cargando… (los TIFF no tienen vista previa)</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// src/pages/TramitesDocumentalesPage/DocumentosAgenteTab.tsx
// Pestaña "🗂️ Documentos": elegís tanda → agente → un documento del orden y se ven
// SOLO las hojas de ese documento, con las mismas acciones que "Combinación de PDF":
// lupa, zoom, ampliar, rotar 90/180 (en el original), ✕ Extraer (→ Trasladados, se
// recupera en ♻️ Restaurar) y ⬆ Subir a otra carpeta (pasa la hoja a otro documento).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { pdfjsLib, PageCanvas, base64ToBytes } from './pdfVisor';
import type { TandaAgente, PageItem } from './pdfVisor';

type DocOrden = { documento: string; carpeta: string };

const sinTildes = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function DocumentosAgenteTab() {
  const toast = useToast();
  const [tandas, setTandas] = useState<string[]>([]);
  const [agentesPorTanda, setAgentesPorTanda] = useState<Map<string, TandaAgente[]>>(new Map());
  const [selectedTanda, setSelectedTanda] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [agente, setAgente] = useState<TandaAgente | null>(null);

  const [docs, setDocs] = useState<DocOrden[]>([]);
  const [docSel, setDocSel] = useState<string | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [allPages, setAllPages] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [oscMenu, setOscMenu] = useState<string | null>(null); // id de hoja (o '__doc__') con el menú ×1/×2/×3 abierto
  const [oscAvance, setOscAvance] = useState<{ hecho: number; total: number } | null>(null); // 🌑 Oscurecer todas
  const [zoom, setZoom] = useState(1);
  const [ampliado, setAmpliado] = useState(false);
  const [lupaIdx, setLupaIdx] = useState<number | null>(null);
  const [lupaZoom, setLupaZoom] = useState(1);
  const [subirDe, setSubirDe] = useState<PageItem | null>(null); // hoja que se está por subir a otra carpeta

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
  const agentesFiltrados = useMemo(() => {
    const q = busqueda.trim();
    if (!q) return agentesTanda;
    const dig = q.replace(/\D/g, '');
    if (dig && dig.length === q.replace(/[\s.]/g, '').length) return agentesTanda.filter((a) => String(a.dni).includes(dig));
    const palabras = sinTildes(q).split(/[\s,]+/).filter(Boolean);
    return agentesTanda.filter((a) => { const n = sinTildes(a.apellidoNombre || ''); return palabras.every((w) => n.includes(w)); });
  }, [agentesTanda, busqueda]);

  // Trae los documentos del orden + todas las hojas del agente (mismo combinado que usa
  // "Combinación de PDF"); después se filtra por documento sin volver a pedir.
  const cargarAgente = useCallback(async (a: TandaAgente, mantenerDoc?: string | null) => {
    setAgente(a); setLoading(true); setPdf(null); setAllPages([]); setLupaIdx(null);
    if (!mantenerDoc) setDocSel(null);
    try {
      const d = await apiFetch<{ ok: boolean; data: { docs: DocOrden[] } }>(`/tramites-documentales/documentos-agente?dni=${a.dni}`);
      setDocs(d.data.docs || []);
    } catch (e: any) { setDocs([]); toast.error('No se pudo leer el orden de documentos', e?.message || 'Error'); }
    try {
      const res = await apiFetch<{ ok: boolean; data: { pages: Omit<PageItem, 'origIdx'>[]; pdfBase64: string } }>(
        '/tramites-documentales/combinar-agente', { method: 'POST', body: JSON.stringify({ dni: a.dni }) });
      const doc = await pdfjsLib.getDocument({ data: base64ToBytes(res.data.pdfBase64) }).promise;
      setPdf(doc);
      setAllPages(res.data.pages.map((p, i) => ({ ...p, origIdx: i, rot: 0 })));
    } catch (e: any) {
      // sin archivos combinables: igual se listan los documentos (todos vacíos)
      if (!/no tiene archivos/i.test(e?.message || '')) toast.error('No se pudieron leer las hojas', e?.message || 'Error');
    } finally { setLoading(false); }
  }, [toast]);

  const hojasPorDoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of allPages) m.set(p.doc, (m.get(p.doc) || 0) + 1);
    return m;
  }, [allPages]);
  const pages = useMemo(() => allPages.filter((p) => p.doc === docSel), [allPages, docSel]);
  // ↕ Ordenar: copia local del orden mientras se acomoda; null = modo normal
  const [ordenando, setOrdenando] = useState<PageItem[] | null>(null);
  const [guardandoOrden, setGuardandoOrden] = useState(false);
  const dragOrden = useRef<number | null>(null);
  useEffect(() => { setOrdenando(null); }, [docSel, agente]);
  const vista = ordenando ?? pages;

  // Teclado: Esc cierra (primero la lupa), ← → cambian de hoja, + − zoom de la lupa.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (subirDe) { if (e.key === 'Escape') setSubirDe(null); return; }
      if (lupaIdx !== null) {
        if (e.key === 'Escape') setLupaIdx(null);
        else if (e.key === 'ArrowLeft') setLupaIdx((i) => (i !== null && i > 0 ? i - 1 : i));
        else if (e.key === 'ArrowRight') setLupaIdx((i) => (i !== null && i < pages.length - 1 ? i + 1 : i));
        else if (e.key === '+' || e.key === '=') setLupaZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
        else if (e.key === '-') setLupaZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
        else return;
        e.preventDefault();
      } else if (ampliado && e.key === 'Escape') setAmpliado(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lupaIdx, ampliado, pages.length, subirDe]);

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
  useEffect(() => {
    if (lupaIdx !== null && lupaIdx >= pages.length) setLupaIdx(pages.length ? pages.length - 1 : null);
  }, [pages.length, lupaIdx]);

  // Después de sacar/mover una hoja: el resto del mismo archivo corre una posición.
  function quitarDeLista(p: PageItem, modo: 'hoja' | 'archivo') {
    setAllPages((prev) => modo === 'archivo'
      ? prev.filter((x) => x.rel !== p.rel)
      : prev.filter((x) => x.id !== p.id).map((x) => (x.rel === p.rel && x.page > p.page ? { ...x, page: x.page - 1 } : x)));
  }

  async function extraer(p: PageItem) {
    if (!agente || busyId) return;
    setBusyId(p.id);
    try {
      const res = await apiFetch<{ ok: boolean; data: { modo: 'hoja' | 'archivo'; trasladado: string } }>(
        '/tramites-documentales/combinar-sacar', { method: 'POST', body: JSON.stringify({ dni: agente.dni, rel: p.rel, page: p.page }) });
      quitarDeLista(p, res.data.modo);
      toast.ok('Hoja extraída', `→ ${res.data.trasladado} (se recupera en ♻️ Restaurar)`);
    } catch (e: any) { toast.error('No se pudo extraer la hoja', e?.message || 'Error'); }
    finally { setBusyId(null); }
  }

  async function rotar(p: PageItem, delta: 90 | -90 | 180) {
    if (!agente || busyId) return;
    setBusyId(p.id);
    try {
      await apiFetch('/tramites-documentales/combinar-rotar',
        { method: 'POST', body: JSON.stringify({ dni: agente.dni, rel: p.rel, page: p.page, delta }) });
      setAllPages((prev) => prev.map((x) => (x.id === p.id ? { ...x, rot: x.rot + delta } : x)));
    } catch (e: any) { toast.error('No se pudo rotar', e?.message || 'Error'); }
    finally { setBusyId(null); }
  }

  async function subirA(p: PageItem, destino: string) {
    if (!agente || busyId) return;
    setSubirDe(null);
    setBusyId(p.id);
    try {
      const res = await apiFetch<{ ok: boolean; data: { modo: 'hoja' | 'archivo'; destino: string } }>(
        '/tramites-documentales/combinar-mover-hoja',
        { method: 'POST', body: JSON.stringify({ dni: agente.dni, rel: p.rel, page: p.page, destino }) });
      toast.ok('Hoja movida', `→ ${res.data.destino}`);
      // la hoja quedó en otro archivo: se recarga todo para que el destino la muestre
      setBusyId(null);
      await cargarAgente(agente, docSel);
      return;
    } catch (e: any) { toast.error('No se pudo mover la hoja', e?.message || 'Error'); }
    setBusyId(null);
  }

  // 📷 Re-escanear documento: abre Escaneo en otra pestaña con DNI, carpeta y máx. resolución.
  // Al guardar, Escaneo manda los archivos de antes a Trasladados y avisa por localStorage
  // ('reescaneo-hecho') → acá se recarga el agente solo.
  // modo 'reemplazar' = 📷 Re-escanear documento; 'agregar' = ➕ Agregar hoja (después de `despuesDe`,
  // o al final si es null): Escaneo guarda la hoja y el back la mete en su lugar (/combinar-insertar).
  function abrirEscaneo(modo: 'reemplazar' | 'agregar', despuesDe: PageItem | null = null) {
    if (!agente || !docSel) return;
    const carpeta = docs.find((d) => d.documento === docSel)?.carpeta || docSel;
    const rels = Array.from(new Set(pages.map((p) => p.rel)));
    const archivos = Array.from(new Set(pages.map((p) => p.archivo)));
    const payload = {
      id: `${Date.now()}`, modo, dni: agente.dni, documento: docSel, carpeta, rels, archivos,
      despuesDe: despuesDe ? { rel: despuesDe.rel, page: despuesDe.page, n: pages.indexOf(despuesDe) + 1 } : null,
    };
    const q = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
    window.open(`/app/escaneo?reescaneo=${q}`, '_blank');
  }
  const reescanear = () => abrirEscaneo('reemplazar');

  function moverOrden(i: number, j: number) {
    setOrdenando((prev) => {
      if (!prev || j < 0 || j >= prev.length || i === j) return prev;
      const n = prev.slice(); const [m] = n.splice(i, 1); n.splice(j, 0, m); return n;
    });
  }
  // Guarda el orden en la carpeta: fotos → se renumeran; un PDF → se reordenan sus páginas;
  // mezcla de archivos → hay que unirlos en un solo PDF (se pregunta antes).
  async function guardarOrden() {
    if (!agente || !docSel || !ordenando) return;
    const carpeta = docs.find((d) => d.documento === docSel)?.carpeta || docSel;
    const orden = ordenando.map((p) => ({ rel: p.rel, page: p.page }));
    const enviar = (unir: boolean) => apiFetch<{ ok: boolean; data: { modo: string; archivos: string[]; backup?: string } }>(
      '/tramites-documentales/combinar-reordenar',
      { method: 'POST', body: JSON.stringify({ dni: agente.dni, carpeta, orden, unir }) });
    setGuardandoOrden(true);
    try {
      let res;
      try { res = await enviar(false); } catch (e: any) {
        if (!/unirlos en un solo PDF/i.test(e?.message || '')) throw e;
        const ok = window.confirm(`${e.message}.\n\n¿Unir las hojas en un solo PDF con este orden? Los archivos de antes quedan en Trasladados (se recuperan en ♻️ Restaurar).`);
        if (!ok) return;
        res = await enviar(true);
      }
      const detalle = res.data.modo === 'fotos' ? `${res.data.archivos.length} foto(s) renumeradas`
        : res.data.modo === 'pdf' ? 'páginas reordenadas dentro del PDF (el anterior quedó en Trasladados)'
          : `unidas en ${res.data.archivos[0]} (los de antes quedaron en Trasladados)`;
      toast.ok('Orden guardado', detalle);
      setOrdenando(null);
      await cargarAgente(agente, docSel);
    } catch (e: any) {
      toast.error('No se pudo guardar el orden', e?.message || 'Error');
    } finally { setGuardandoOrden(false); }
  }

  // 🌑 Oscurecer: corrige el original (copia previa en Trasladados) y se vuelven a leer las hojas.
  //   ×1 suave · ×2 fuerte · ×3 muy fuerte (niveles 1-3 del back). Se acumula si se repite.
  async function oscurecer(p: PageItem, nivel: 1 | 2 | 3) {
    if (!agente || busyId) return;
    setOscMenu(null);
    setBusyId(p.id);
    try {
      const res = await apiFetch<{ ok: boolean; data: { backup: string } }>('/tramites-documentales/combinar-oscurecer',
        { method: 'POST', body: JSON.stringify({ dni: agente.dni, rel: p.rel, page: p.page, nivel }) });
      toast.ok(`Hoja oscurecida ×${nivel}`, `La anterior quedó en ${res.data.backup} (se recupera en ♻️ Restaurar)`);
      setBusyId(null);
      const idx = lupaIdx;
      await cargarAgente(agente, docSel);
      if (idx !== null) setLupaIdx(idx);
      return;
    } catch (e: any) { toast.error('No se pudo oscurecer', e?.message || 'Error'); }
    setBusyId(null);
  }
  // 🌑 Oscurecer todas: cada ARCHIVO del documento una sola vez (un PDF de varias hojas = 1 pasada y
  // 1 copia en Trasladados). Si uno falla sigue con los demás y avisa al final.
  async function oscurecerTodas(nivel: 1 | 2 | 3) {
    if (!agente || busyId || !pages.length) return;
    setOscMenu(null);
    const archivos = Array.from(new Map(pages.map((p) => [p.rel, p])).values());
    setBusyId('__doc__');
    setOscAvance({ hecho: 0, total: archivos.length });
    const fallaron: string[] = [];
    for (let i = 0; i < archivos.length; i += 1) {
      const p = archivos[i];
      try {
        await apiFetch('/tramites-documentales/combinar-oscurecer',
          { method: 'POST', body: JSON.stringify({ dni: agente.dni, rel: p.rel, page: 0, todas: true, nivel }) });
      } catch (e: any) { fallaron.push(`${p.archivo}: ${e?.message || 'error'}`); }
      setOscAvance({ hecho: i + 1, total: archivos.length });
    }
    setOscAvance(null);
    setBusyId(null);
    if (fallaron.length) toast.error(`No se pudieron oscurecer ${fallaron.length} de ${archivos.length}`, fallaron.join(' · '));
    else toast.ok(`Documento oscurecido ×${nivel}`, `${archivos.length} archivo(s) · los anteriores quedaron en Trasladados (se recuperan en ♻️ Restaurar)`);
    await cargarAgente(agente, docSel);
  }

  // Botón 🌑 + menú ×1/×2/×3 (por hoja, en la lupa, o '__doc__' para el documento entero)
  const NIVELES_OSC: Array<{ n: 1 | 2 | 3; t: string }> = [
    { n: 1, t: 'Suave: grises claros → gris medio' },
    { n: 2, t: 'Fuerte' },
    { n: 3, t: 'Muy fuerte: casi todo lo escrito → negro' },
  ];
  const menuOscurecer = (clave: string, aplicar: (n: 1 | 2 | 3) => void, etiqueta: string, titulo: string) => (
    <>
      <button type="button" style={{ ...off(iconBtn), ...(etiqueta.length > 2 ? { padding: '0 10px' } : {}), ...(oscMenu === clave ? { background: 'rgba(124,58,237,0.35)' } : {}) }}
        disabled={!!busyId} title={titulo} onClick={() => setOscMenu((m) => (m === clave ? null : clave))}>{etiqueta}</button>
      {oscMenu === clave && NIVELES_OSC.map((o) => (
        <button key={o.n} type="button" style={{ ...iconBtn, color: '#fde68a', fontWeight: 700 }} title={`×${o.n} — ${o.t}`}
          onClick={() => aplicar(o.n)}>×{o.n}</button>
      ))}
    </>
  );

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== 'reescaneo-hecho' || !e.newValue || !agente) return;
      try {
        const d = JSON.parse(e.newValue);
        if (Number(d?.dni) === Number(agente.dni)) void cargarAgente(agente, d?.documento || docSel);
      } catch { /* noop */ }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [agente, docSel, cargarAgente]);

  const chip: React.CSSProperties = { padding: '5px 14px', borderRadius: 999, fontSize: '0.78rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)' };
  const iconBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#cbd5e1', cursor: 'pointer', minWidth: 28, height: 26, fontSize: '0.8rem', padding: '0 4px' };
  const rojo: React.CSSProperties = { ...iconBtn, color: '#fca5a5', borderColor: 'rgba(248,113,113,0.4)' };
  const off = (b: React.CSSProperties) => ({ ...b, opacity: busyId ? 0.4 : 1 });

  // Botones de acción de una hoja (en la lista y en la lupa)
  const acciones = (p: PageItem) => (
    <>
      <button type="button" style={off(iconBtn)} disabled={!!busyId} title="Rotar 90° a la izquierda (corrige el original)" onClick={() => void rotar(p, -90)}>↺</button>
      <button type="button" style={off(iconBtn)} disabled={!!busyId} title="Rotar 90° a la derecha (corrige el original)" onClick={() => void rotar(p, 90)}>↻</button>
      <button type="button" style={off(iconBtn)} disabled={!!busyId} title="Rotar 180° (corrige el original)" onClick={() => void rotar(p, 180)}>⟲180</button>
      {menuOscurecer(p.id, (n) => void oscurecer(p, n), '🌑',
        'Oscurecer esta hoja: elegí ×1 suave, ×2 fuerte o ×3 muy fuerte (corrige el original; la anterior queda en Trasladados)')}
      <button type="button" style={off(iconBtn)} disabled={!!busyId} title="Agregar una hoja escaneada DESPUÉS de esta (la que se comió el escáner)" onClick={() => abrirEscaneo('agregar', p)}>➕</button>
      <button type="button" style={off(iconBtn)} disabled={!!busyId} title="Subir a otra carpeta (pasar la hoja a otro documento)" onClick={() => setSubirDe(p)}>⬆</button>
      <button type="button" style={off(rojo)} disabled={!!busyId} title="Extraer la hoja → Trasladados (se recupera en ♻️ Restaurar)" onClick={() => void extraer(p)}>{busyId === p.id ? '…' : '✕'}</button>
    </>
  );

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 480 }}>
      {/* Izquierda: tandas + agentes, o documentos del agente elegido */}
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!agente ? (
          <>
            <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>Tandas</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tandas.map((t) => (
                <button key={t} type="button" onClick={() => setSelectedTanda(t)}
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
                <div key={a.id} onClick={() => void cargarAgente(a)}
                  style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ color: '#e2e8f0', fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.apellidoNombre || `DNI ${a.dni}`}</div>
                  <div style={{ color: '#64748b', fontSize: '0.72rem' }}>DNI {a.dni}</div>
                </div>
              ))}
              {selectedTanda && !!agentesTanda.length && !agentesFiltrados.length && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Nadie coincide con «{busqueda}».</div>}
              {selectedTanda && !agentesTanda.length && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Tanda vacía.</div>}
              {!selectedTanda && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Elegí una tanda.</div>}
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { setAgente(null); setDocs([]); setDocSel(null); setPdf(null); setAllPages([]); }}
              style={{ ...iconBtn, alignSelf: 'flex-start', padding: '0 10px' }}>← Agentes</button>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem' }}>{agente.apellidoNombre || `DNI ${agente.dni}`}</div>
              <div style={{ color: '#64748b', fontSize: '0.75rem' }}>DNI {agente.dni} · {allPages.length} hoja(s) en total</div>
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>Documentos</div>
            <div style={{ flex: 1, overflow: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
              {loading && <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: 10 }}>Cargando…</div>}
              {!loading && docs.map((d, i) => {
                const n = hojasPorDoc.get(d.documento) || 0;
                return (
                  <div key={d.documento} onClick={() => { setDocSel(d.documento); setLupaIdx(null); }}
                    style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8, alignItems: 'baseline',
                      background: docSel === d.documento ? 'rgba(124,58,237,0.22)' : 'transparent' }}>
                    <span style={{ color: '#64748b', fontSize: '0.72rem', width: 20, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ flex: 1, color: n ? '#e2e8f0' : '#fca5a5', fontSize: '0.8rem' }}>{d.documento}</span>
                    <span style={{ color: n ? '#94a3b8' : '#f87171', fontSize: '0.72rem', flexShrink: 0 }}>{n ? `${n} hoja${n > 1 ? 's' : ''}` : 'vacío'}</span>
                  </div>
                );
              })}
              {!loading && !docs.length && <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Sin orden de documentos para la ley del agente.</div>}
            </div>
          </>
        )}
      </div>

      {/* Derecha: hojas del documento elegido */}
      <div style={ampliado
        ? { position: 'fixed', inset: 10, zIndex: 1000, background: '#0b1220', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10,
            padding: 12, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }
        : { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!agente ? (
          <div style={{ color: '#64748b', fontSize: '0.85rem', margin: 'auto' }}>Elegí un agente de la tanda.</div>
        ) : !docSel ? (
          <div style={{ color: '#64748b', fontSize: '0.85rem', margin: 'auto' }}>{loading ? 'Cargando hojas…' : 'Elegí un documento de la lista.'}</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
              <strong style={{ color: '#a5b4fc', fontSize: '0.9rem' }}>{docSel}</strong>
              <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{pages.length} hoja(s)</span>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={reescanear} disabled={loading}
                title="Re-escanear el documento completo a máxima resolución. Al guardar, las hojas actuales pasan a Trasladados (se recuperan en ♻️ Restaurar)."
                style={{ ...iconBtn, padding: '0 10px', color: '#fde68a', borderColor: 'rgba(250,204,21,0.45)' }}>📷 Re-escanear documento</button>
              {ordenando ? (
                <>
                  <span style={{ color: '#a5b4fc', fontSize: '0.78rem' }}>↕ Arrastrá las hojas o usá ▲▼</span>
                  <button type="button" onClick={() => void guardarOrden()} disabled={guardandoOrden}
                    style={{ ...iconBtn, padding: '0 10px', color: '#86efac', borderColor: 'rgba(134,239,172,0.45)' }}>{guardandoOrden ? 'Guardando…' : '💾 Guardar orden'}</button>
                  <button type="button" onClick={() => setOrdenando(null)} disabled={guardandoOrden} style={{ ...iconBtn, padding: '0 10px' }}>Cancelar</button>
                </>
              ) : (
                <button type="button" onClick={() => setOrdenando(pages.slice())} disabled={loading || !!busyId || pages.length < 2}
                  title="Cambiar el orden de las hojas de este documento (queda guardado en la carpeta)"
                  style={{ ...iconBtn, padding: '0 10px' }}>↕ Ordenar</button>
              )}
              {oscAvance
                ? <span style={{ color: '#fde68a', fontSize: '0.78rem' }}>🌑 Oscureciendo {oscAvance.hecho} de {oscAvance.total}…</span>
                : menuOscurecer('__doc__', (n) => void oscurecerTodas(n), '🌑 Oscurecer todas',
                  'Oscurecer TODAS las hojas de este documento (×1 suave, ×2 fuerte, ×3 muy fuerte). Los originales quedan en Trasladados.')}
              <button type="button" onClick={() => abrirEscaneo('agregar', null)} disabled={loading}
                title="Escanear una hoja más y agregarla al FINAL del documento (para meterla en el medio, usá ➕ en la hoja de antes)"
                style={{ ...iconBtn, padding: '0 10px' }}>➕ Agregar hoja</button>
              <button type="button" onClick={() => agente && void cargarAgente(agente, docSel)} disabled={loading}
                title="Volver a leer las hojas del agente" style={{ ...iconBtn, padding: '0 8px' }}>🔄</button>
              <button type="button" style={iconBtn} onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}>−</button>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', width: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <button type="button" style={iconBtn} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}>+</button>
              <button type="button" onClick={() => setAmpliado((a) => !a)} title={ampliado ? 'Volver (Esc)' : 'Ver a pantalla completa'}
                style={{ ...iconBtn, padding: '0 10px' }}>{ampliado ? '✕ Cerrar' : '⛶ Ampliar'}</button>
            </div>
            {loading ? (
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: 20 }}>Cargando hojas…</div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: 4 }}>
                {vista.map((p, idx) => (
                  <div key={p.id}
                    draggable={!!ordenando}
                    onDragStart={() => { dragOrden.current = idx; }}
                    onDragOver={(e) => { if (ordenando) e.preventDefault(); }}
                    onDrop={() => { if (ordenando && dragOrden.current !== null) moverOrden(dragOrden.current, idx); dragOrden.current = null; }}
                    style={{ display: 'flex', gap: 10, border: `1px solid ${ordenando ? 'rgba(165,180,252,0.45)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 8, padding: 8,
                      background: 'rgba(255,255,255,0.03)', cursor: ordenando ? 'grab' : undefined }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ color: '#64748b', fontSize: '0.72rem' }}>#{idx + 1}</span>
                      {ordenando ? (
                        <>
                          <span title="Arrastrar" style={{ color: '#a5b4fc', fontSize: '1rem' }}>⠿</span>
                          <button type="button" style={{ ...iconBtn, opacity: idx === 0 ? 0.3 : 1 }} disabled={idx === 0} title="Subir una posición" onClick={() => moverOrden(idx, idx - 1)}>▲</button>
                          <button type="button" style={{ ...iconBtn, opacity: idx === vista.length - 1 ? 0.3 : 1 }} disabled={idx === vista.length - 1} title="Bajar una posición" onClick={() => moverOrden(idx, idx + 1)}>▼</button>
                        </>
                      ) : (
                        <>
                          <button type="button" title="Lupa: ver esta hoja grande" style={iconBtn} onClick={() => { setLupaIdx(idx); setLupaZoom(1); }}>🔍</button>
                          {acciones(p)}
                        </>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#cbd5e1', fontSize: '0.75rem', marginBottom: 4 }}>{p.archivo}{p.page > 0 ? ` (pág ${p.page + 1})` : ''}</div>
                      <div style={{ maxWidth: (ampliado ? 900 : 640) * zoom, cursor: 'zoom-in' }}
                        onDoubleClick={() => { if (!ordenando) { setLupaIdx(idx); setLupaZoom(1); } }} title={ordenando ? 'Arrastrá para cambiar el orden' : 'Doble clic: lupa'}>
                        {pdf && <PageCanvas pdf={pdf} origIdx={p.origIdx} rot={p.rot} />}
                      </div>
                    </div>
                  </div>
                ))}
                {!pages.length && <div style={{ color: '#64748b', fontSize: '0.85rem', padding: 20 }}>Este documento no tiene hojas.</div>}
              </div>
            )}
          </>
        )}
      </div>

      {/* Lupa */}
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
                <button type="button" style={{ ...iconBtn, opacity: lupaIdx === 0 ? 0.3 : 1 }} disabled={lupaIdx === 0} title="Hoja anterior (←)" onClick={() => setLupaIdx(lupaIdx - 1)}>‹</button>
                <button type="button" style={{ ...iconBtn, opacity: lupaIdx === pages.length - 1 ? 0.3 : 1 }} disabled={lupaIdx === pages.length - 1} title="Hoja siguiente (→)" onClick={() => setLupaIdx(lupaIdx + 1)}>›</button>
                <span style={{ width: 8 }} />
                <button type="button" style={iconBtn} title="Alejar (−)" onClick={() => setLupaZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
                <span style={{ color: '#94a3b8', fontSize: '0.75rem', width: 44, textAlign: 'center' }}>{Math.round(lupaZoom * 100)}%</span>
                <button type="button" style={iconBtn} title="Acercar (+)" onClick={() => setLupaZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
                <button type="button" style={{ ...iconBtn, padding: '0 8px' }} title="Ajustar al ancho" onClick={() => setLupaZoom(1)}>Ajustar</button>
                <span style={{ width: 8 }} />
                {acciones(p)}
                <span style={{ width: 8 }} />
                <button type="button" style={{ ...iconBtn, padding: '0 10px' }} title="Cerrar (Esc)" onClick={() => setLupaIdx(null)}>Cerrar</button>
              </div>
              <div ref={lupaScrollRef} style={{ flex: 1, overflow: 'auto', padding: 16, background: '#111827' }}>
                <div style={{ width: `${lupaZoom * 100}%`, margin: lupaZoom <= 1 ? '0 auto' : 0 }}>
                  <PageCanvas key={`${p.id}-${p.rot}`} pdf={pdf} origIdx={p.origIdx} rot={p.rot} scale={3.5} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Subir a otra carpeta: elegir el documento destino */}
      {subirDe && (
        <div onClick={() => setSubirDe(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(2,6,23,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: '#0b1220', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem' }}>⬆ Subir la hoja a otra carpeta</div>
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: 2 }}>
                {subirDe.doc} · {subirDe.archivo}{subirDe.page > 0 ? ` (pág ${subirDe.page + 1})` : ''}
              </div>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {docs.filter((d) => d.documento !== subirDe.doc).map((d) => (
                <div key={d.documento} onClick={() => void subirA(subirDe, d.documento)}
                  style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{d.documento}</span>
                  <span style={{ color: '#64748b', fontSize: '0.72rem' }}>{hojasPorDoc.get(d.documento) ? `${hojasPorDoc.get(d.documento)} hoja(s)` : 'vacío'}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: 10, borderTop: '1px solid rgba(255,255,255,0.1)', textAlign: 'right' }}>
              <button type="button" style={{ ...iconBtn, padding: '0 12px' }} onClick={() => setSubirDe(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

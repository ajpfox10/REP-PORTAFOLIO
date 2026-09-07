// src/pages/TramitesDocumentalesPage/DocuBrowser.tsx
// Explorador de la carpeta DOCU\<dni> de un agente, embebible (p. ej. dentro de una
// tarjeta de agente). Izquierda: lista navegable del contenido de la carpeta actual.
// Derecha: visor del archivo (click). Doble click en una imagen la abre a tamaño real.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';
import { abrirCarpetaEnExplorador } from '../../utils/abrirCarpeta';

type DocuNode = { name: string; type: 'dir' | 'file'; path: string; ext?: string; bytes?: number; children?: DocuNode[] };

const ACCENT = '#7c3aed';
const BORDER = '1px solid rgba(255,255,255,0.1)';
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

function bytesLabel(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForNode(node: DocuNode) {
  if (node.type === 'dir') return '📁';
  const ext = node.ext || '';
  if (ext === 'pdf') return '📕';
  if (IMG_EXT.has(ext)) return '🖼️';
  if (ext === 'txt') return '📄';
  return '📎';
}

// Hijos directos de la carpeta `path` dentro del árbol ('' = raíz). null si no está.
function findFolderChildren(nodes: DocuNode[], path: string): DocuNode[] | null {
  if (path === '') return nodes;
  for (const n of nodes) {
    if (n.type !== 'dir') continue;
    if (n.path === path) return n.children || [];
    if (n.children) {
      const found = findFolderChildren(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

// Busca (recursivo) una carpeta por nombre y devuelve su path. null si no existe.
function findDirPathByName(nodes: DocuNode[], name: string): string | null {
  const objetivo = name.trim().toLowerCase();
  for (const n of nodes) {
    if (n.type !== 'dir') continue;
    if (n.name.trim().toLowerCase() === objetivo) return n.path;
    if (n.children) {
      const found = findDirPathByName(n.children, name);
      if (found) return found;
    }
  }
  return null;
}

export function DocuBrowser({ dni, target, targetNonce }: { dni: number; target?: string | null; targetNonce?: number }) {
  const toast = useToast();
  const [tree, setTree] = useState<DocuNode[]>([]);
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState(''); // carpeta actual (path relativo, '' = raíz)
  const [viewer, setViewer] = useState<{ url: string; name: string; ext: string; path: string } | null>(null);
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);
  const [targetMiss, setTargetMiss] = useState<string | null>(null); // subcarpeta pedida que no existe
  const urlRef = useRef<string | null>(null);

  function revoke() {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  }

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ ok: boolean; data: { exists: boolean; tree: DocuNode[] } }>(
          `/tramites-documentales/docu-tree?dni=${dni}`
        );
        if (!vivo) return;
        setExists(res.data.exists);
        setTree(res.data.tree || []);
      } catch (e: any) {
        if (!vivo) return;
        setExists(false);
        setTree([]);
        toast.error('No se pudo leer la carpeta DOCU', e?.message || 'Error');
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; revoke(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dni]);

  // Al pedir una subcarpeta puntual (chip de documento), saltar a ella cuando el árbol esté listo.
  // targetNonce está en las deps a propósito: permite volver a saltar al MISMO chip
  // después de haber navegado a otra carpeta a mano.
  useEffect(() => {
    if (loading) return;
    if (!target) { setTargetMiss(null); return; }
    const path = findDirPathByName(tree, target);
    if (path) { setFolder(path); setTargetMiss(null); }
    else { setFolder(''); setTargetMiss(target); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, target, targetNonce, loading]);

  // Cerrar el zoom con Esc.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  const contenido = useMemo(
    () => [...(findFolderChildren(tree, folder) || [])].sort((a, b) => (
      a.type === b.type ? a.name.localeCompare(b.name, 'es') : a.type === 'dir' ? -1 : 1
    )),
    [tree, folder]
  );

  // Migas de pan de la carpeta actual.
  const crumbs = folder ? folder.split('/') : [];

  // Abre la carpeta que se está viendo en el Explorador de Windows de ESTA PC
  // (vía el handler p5abrir:) y deja la ruta en el portapapeles como respaldo,
  // por si el handler no está instalado en esta máquina.
  async function abrirCarpeta() {
    try {
      // Va como `sub` (no como `doc`): la carpeta ya existe —la estás viendo—, así
      // que solo hay que apuntar ahí, sin crear nada. Además `sub` respeta los
      // niveles anidados, que `doc` colapsaría a su último tramo.
      const { unc, copiado } = await abrirCarpetaEnExplorador(dni, { sub: folder || null });
      toast.ok(
        copiado ? 'Abriendo carpeta (ruta copiada por las dudas)' : 'Abriendo carpeta',
        unc,
      );
    } catch (e: any) {
      toast.error('No se pudo abrir la carpeta', e?.message || 'Error');
    }
  }

  async function abrir(node: DocuNode, zoomImg = false) {
    try {
      const { blob } = await apiFetchBlobWithMeta(
        `/tramites-documentales/docu-file?dni=${dni}&path=${encodeURIComponent(node.path)}`
      );
      setZoom(null);
      revoke();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setViewer({ url, name: node.name, ext: node.ext || '', path: node.path });
      if (zoomImg && IMG_EXT.has(node.ext || '')) setZoom({ url, name: node.name });
    } catch (e: any) {
      toast.error('No se pudo abrir el archivo', e?.message || 'Error');
    }
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 10, minHeight: 260 }}>
      {/* Izquierda: navegación del contenido de la carpeta */}
      <div style={{ width: 300, flexShrink: 0, border: BORDER, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Migas de pan + copiar ruta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '8px 10px', borderBottom: BORDER, fontSize: '0.76rem' }}>
          <button type="button" onClick={() => setFolder('')} style={crumbBtn(folder === '')}>DOCU\{dni}</button>
          {crumbs.map((seg, i) => {
            const to = crumbs.slice(0, i + 1).join('/');
            return (
              <React.Fragment key={to}>
                <span style={{ color: '#64748b' }}>/</span>
                <button type="button" onClick={() => setFolder(to)} style={crumbBtn(i === crumbs.length - 1)}>{seg}</button>
              </React.Fragment>
            );
          })}
          <button type="button" onClick={() => void abrirCarpeta()}
            title="Abrir esta carpeta en el Explorador de Windows (la ruta queda copiada por las dudas)"
            style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', color: '#cbd5e1', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            📂 Abrir carpeta
          </button>
        </div>
        {/* Aviso: la subcarpeta pedida por el chip no existe todavía */}
        {targetMiss ? (
          <div style={{ padding: '6px 10px', borderBottom: BORDER, background: 'rgba(245,158,11,0.1)', color: '#fbbf24', fontSize: '0.72rem' }}>
            No existe la subcarpeta «{targetMiss}». Mostrando la raíz.
          </div>
        ) : null}
        {/* Lista */}
        <div style={{ overflow: 'auto', padding: 4, flex: 1 }}>
          {loading ? (
            <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 8 }}>Leyendo carpeta…</div>
          ) : !exists ? (
            <div style={{ color: '#f59e0b', fontSize: '0.8rem', padding: 8 }}>La carpeta del agente no existe en DOCU.</div>
          ) : !contenido.length ? (
            <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 8 }}>Carpeta vacía.</div>
          ) : contenido.map((child) => (
            <div
              key={child.path}
              title={IMG_EXT.has(child.ext || '') ? `${child.name} — doble click para verla en grande` : child.name}
              onClick={() => { if (child.type === 'dir') setFolder(child.path); else void abrir(child); }}
              onDoubleClick={() => { if (child.type === 'file' && IMG_EXT.has(child.ext || '')) void abrir(child, true); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderRadius: 6, fontSize: '0.8rem',
                background: viewer?.path === child.path ? 'rgba(124,58,237,0.25)' : 'transparent',
                color: child.type === 'dir' ? '#cbd5e1' : viewer?.path === child.path ? '#fff' : '#94a3b8',
              }}
            >
              <span>{iconForNode(child)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: child.type === 'dir' ? 600 : 400 }}>{child.name}</span>
              {child.bytes ? <small style={{ color: '#64748b' }}>{bytesLabel(child.bytes)}</small> : null}
            </div>
          ))}
        </div>
      </div>

      {/* Derecha: visor */}
      <div style={{ flex: 1, minWidth: 0, border: BORDER, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#0f0f17' }}>
        {!viewer ? (
          <div style={{ color: '#64748b', fontSize: '0.82rem', margin: 'auto', textAlign: 'center', padding: 16 }}>
            Click en un archivo para verlo.<br />Doble click en una imagen para verla a tamaño real.
          </div>
        ) : viewer.ext === 'pdf' ? (
          <iframe title={viewer.name} src={viewer.url} style={{ border: 'none', width: '100%', height: '100%', minHeight: 420 }} />
        ) : IMG_EXT.has(viewer.ext) ? (
          <div style={{ overflow: 'auto', padding: 12, textAlign: 'center' }}>
            <img
              src={viewer.url}
              alt={viewer.name}
              title="Doble click para verla en tamaño real"
              onDoubleClick={() => setZoom({ url: viewer.url, name: viewer.name })}
              style={{ maxWidth: '100%', cursor: 'zoom-in' }}
            />
          </div>
        ) : (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#cbd5e1', fontSize: '0.82rem' }}>
            <div style={{ marginBottom: 8 }}>No hay vista previa para <b>{viewer.name}</b>.</div>
            <a href={viewer.url} download={viewer.name} style={{ color: ACCENT }}>Descargar</a>
          </div>
        )}
      </div>

      {/* Imagen a pantalla completa */}
      {zoom ? (
        <div
          onClick={() => setZoom(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.88)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#cbd5e1', fontSize: '0.85rem', marginBottom: 10 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70vw' }}>{zoom.name}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); setZoom(null); }}
              style={{ background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 6, padding: '3px 8px', fontSize: '0.8rem', color: '#cbd5e1', cursor: 'pointer' }}>
              ✕ Cerrar (Esc)
            </button>
          </div>
          <img src={zoom.url} alt={zoom.name} onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '95vw', maxHeight: '85vh', objectFit: 'contain', boxShadow: '0 0 40px rgba(0,0,0,0.6)', borderRadius: 4 }} />
        </div>
      ) : null}
    </div>
  );
}

function crumbBtn(active: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer', fontSize: '0.76rem',
    color: active ? '#fff' : '#7dd3fc', fontWeight: active ? 700 : 500, textDecoration: active ? 'none' : 'underline',
  };
}

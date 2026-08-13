import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Flujo nuevo (2026-08): consulta de interinos 10430 por rango de años -> cuadro
// -> se agregan a una tanda (persistida en la base) -> al hacer click en un agente
// se muestra su carpeta D:\G\DOCU\<dni> (arbol + visor) y su ficha de la base.
// Con estado por agente (pendiente/hecho/aprobado) y drag&drop (mover/subir/mkdir).
// ─────────────────────────────────────────────────────────────────────────────

type InterinoRow = {
  dni: number;
  apellidoNombre: string;
  fechaIngresoExcel: string | null;
  ocupacionNombre?: string | null;
  ocupacionLey?: string | null;
  dependenciaNombre?: string | null;
  leyNombre?: string | null;
  plantaNombre?: string | null;
};

type TandaAgente = {
  id: number;
  tanda: string;
  dni: number;
  estado: string;
  creadoAt: string;
  apellidoNombre: string;
  fechaIngreso: string | null;
  ocupacionNombre?: string | null;
  ocupacionLey?: string | null;
  leyNombre?: string | null;
  plantaNombre?: string | null;
  estadoEmpleo?: string | null;
  dependenciaNombre?: string | null;
};

type DocuNode = {
  name: string;
  type: 'dir' | 'file';
  path: string;
  ext?: string;
  bytes?: number;
  children?: DocuNode[];
};

const ACCENT = '#7c3aed';
const CARD_BG = 'rgba(255,255,255,0.03)';
const BORDER = '1px solid rgba(255,255,255,0.1)';
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const currentYear = new Date().getFullYear();

const ESTADOS = ['pendiente', 'hecho', 'aprobado'] as const;
const ESTADO_COLOR: Record<string, string> = {
  pendiente: '#94a3b8',
  hecho: '#f59e0b',
  aprobado: '#22c55e',
};

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

// ── Arbol recursivo de la carpeta DOCU (con drag & drop) ──────────────────────
type TreeHandlers = {
  selectedPath: string | null;
  selectedFolder: string;
  onOpenFile: (node: DocuNode) => void;
  onSelectFolder: (path: string) => void;
  onMove: (fromPath: string, toFolder: string) => void;
  onUpload: (files: FileList, toFolder: string) => void;
  dragPathRef: React.MutableRefObject<string | null>;
};

function TreeView(props: { nodes: DocuNode[]; depth?: number; h: TreeHandlers }) {
  const { nodes, depth = 0, h } = props;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} depth={depth} h={h} />
      ))}
    </ul>
  );
}

function TreeNode(props: { node: DocuNode; depth: number; h: TreeHandlers }) {
  const { node, depth, h } = props;
  const [open, setOpen] = useState(depth < 1);
  const [dragOver, setDragOver] = useState(false);
  const isSelected = h.selectedPath === node.path;
  const isSelFolder = h.selectedFolder === node.path;
  const pad = 6 + depth * 14;

  if (node.type === 'dir') {
    return (
      <li>
        <div
          onClick={() => { setOpen((v) => !v); h.onSelectFolder(node.path); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'; setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation(); setDragOver(false);
            if (e.dataTransfer.files?.length) h.onUpload(e.dataTransfer.files, node.path);
            else if (h.dragPathRef.current) h.onMove(h.dragPathRef.current, node.path);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: `4px 6px 4px ${pad}px`,
            cursor: 'pointer', borderRadius: 6, fontSize: '0.82rem',
            color: isSelFolder ? '#fff' : '#cbd5e1',
            background: dragOver ? 'rgba(124,58,237,0.35)' : isSelFolder ? 'rgba(124,58,237,0.15)' : 'transparent',
            outline: dragOver ? `1px dashed ${ACCENT}` : 'none',
          }}
        >
          <span style={{ width: 12, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
          <span>{iconForNode(node)}</span>
          <span style={{ fontWeight: 600 }}>{node.name}</span>
        </div>
        {open && node.children?.length ? (
          <TreeView nodes={node.children} depth={depth + 1} h={h} />
        ) : null}
      </li>
    );
  }

  return (
    <li>
      <div
        draggable
        onDragStart={(e) => { h.dragPathRef.current = node.path; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.path); }}
        onDragEnd={() => { h.dragPathRef.current = null; }}
        onClick={() => h.onOpenFile(node)}
        title={node.path}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: `4px 6px 4px ${pad + 12}px`,
          cursor: 'pointer', borderRadius: 6, fontSize: '0.82rem',
          background: isSelected ? 'rgba(124,58,237,0.25)' : 'transparent',
          color: isSelected ? '#fff' : '#94a3b8',
        }}
      >
        <span>{iconForNode(node)}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        {node.bytes ? <small style={{ color: '#64748b' }}>{bytesLabel(node.bytes)}</small> : null}
      </div>
    </li>
  );
}

export function TramitesTab() {
  const toast = useToast();

  // Consulta
  const [anioDesde, setAnioDesde] = useState(String(currentYear));
  const [anioHasta, setAnioHasta] = useState(String(currentYear));
  const [consultaRows, setConsultaRows] = useState<InterinoRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loadingConsulta, setLoadingConsulta] = useState(false);
  const [tandaNombre, setTandaNombre] = useState('');

  // Tandas
  const [tandaRows, setTandaRows] = useState<TandaAgente[]>([]);
  const [tandas, setTandas] = useState<string[]>([]);
  const [selectedTanda, setSelectedTanda] = useState('');
  const [savingTanda, setSavingTanda] = useState(false);
  const [creandoSub, setCreandoSub] = useState(false);
  // Errores del último análisis de subcarpetas (dni -> motivo) y a qué tanda pertenecen,
  // para marcar en rojo al agente en la lista y mostrar el motivo al pasar el cursor.
  const [subErrores, setSubErrores] = useState<Map<number, string>>(new Map());
  const [subErroresTanda, setSubErroresTanda] = useState('');
  const [ordenando, setOrdenando] = useState(false);
  const [ordenProg, setOrdenProg] = useState<{ done: number; total: number } | null>(null);

  // Detalle de agente (carpeta DOCU + visor)
  const [agente, setAgente] = useState<TandaAgente | null>(null);
  const [docuTree, setDocuTree] = useState<DocuNode[]>([]);
  const [docuExists, setDocuExists] = useState(true);
  const [docuLoading, setDocuLoading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [rootDragOver, setRootDragOver] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; name: string; ext: string; path: string } | null>(null);
  const viewerUrlRef = useRef<string | null>(null);
  const dragPathRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function revokeViewer() {
    if (viewerUrlRef.current) {
      URL.revokeObjectURL(viewerUrlRef.current);
      viewerUrlRef.current = null;
    }
  }

  useEffect(() => {
    void refreshTandas();
    return () => revokeViewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentesPorTanda = useMemo(() => {
    const map = new Map<string, TandaAgente[]>();
    for (const row of tandaRows) {
      const list = map.get(row.tanda) || [];
      list.push(row);
      map.set(row.tanda, list);
    }
    return map;
  }, [tandaRows]);

  async function consultar() {
    const desde = Number(anioDesde);
    const hasta = Number(anioHasta);
    if (!Number.isInteger(desde) || !Number.isInteger(hasta)) {
      toast.warning('Rango invalido', 'Cargá año desde y año hasta.');
      return;
    }
    setLoadingConsulta(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: InterinoRow[]; total: number } }>(
        `/tramites-documentales/interinos-10430?anioDesde=${desde}&anioHasta=${hasta}`
      );
      const rows = res.data.rows || [];
      setConsultaRows(rows);
      setSelected(new Set());
      toast.ok('Consulta lista', `${rows.length} interino(s) 10430 activos`);
    } catch (e: any) {
      toast.error('No se pudo consultar', e?.message || 'Error');
    } finally {
      setLoadingConsulta(false);
    }
  }

  function toggleSelect(dni: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dni)) next.delete(dni);
      else next.add(dni);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (
      prev.size === consultaRows.length ? new Set() : new Set(consultaRows.map((r) => r.dni))
    ));
  }

  async function refreshTandas(keepTanda?: string) {
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: TandaAgente[]; tandas: string[] } }>(
        '/tramites-documentales/tandas'
      );
      const rows = res.data.rows || [];
      const nombres = res.data.tandas || [];
      setTandaRows(rows);
      setTandas(nombres);
      setSelectedTanda((current) => {
        const target = keepTanda || current;
        return target && nombres.includes(target) ? target : nombres[0] || '';
      });
    } catch (e: any) {
      toast.error('No se pudieron cargar tandas', e?.message || 'Error');
    }
  }

  async function agregarATanda() {
    const nombre = tandaNombre.trim();
    if (!nombre) {
      toast.warning('Falta la tanda', 'Escribí el nombre de la tanda.');
      return;
    }
    if (!selected.size) {
      toast.warning('Sin selección', 'Tildá al menos un interino del cuadro.');
      return;
    }
    setSavingTanda(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { agregados: number } }>('/tramites-documentales/tandas', {
        method: 'POST',
        body: JSON.stringify({ tanda: nombre, dnis: Array.from(selected) }),
      });
      toast.ok('Agregados a la tanda', `${res.data.agregados} agente(s) en "${nombre}"`);
      setSelected(new Set());
      await refreshTandas(nombre);
    } catch (e: any) {
      toast.error('No se pudo guardar la tanda', e?.message || 'Error');
    } finally {
      setSavingTanda(false);
    }
  }

  async function quitarDeTanda(tanda: string, dni: number) {
    try {
      await apiFetch(`/tramites-documentales/tandas?tanda=${encodeURIComponent(tanda)}&dni=${dni}`, {
        method: 'DELETE',
      });
      if (agente?.dni === dni && agente?.tanda === tanda) setAgente(null);
      await refreshTandas(tanda);
    } catch (e: any) {
      toast.error('No se pudo quitar', e?.message || 'Error');
    }
  }

  async function cambiarEstado(row: TandaAgente, estado: string) {
    try {
      await apiFetch('/tramites-documentales/tandas/estado', {
        method: 'POST',
        body: JSON.stringify({ tanda: row.tanda, dni: row.dni, estado }),
      });
      setTandaRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, estado } : r)));
      setAgente((a) => (a && a.id === row.id ? { ...a, estado } : a));
    } catch (e: any) {
      toast.error('No se pudo cambiar el estado', e?.message || 'Error');
    }
  }

  // Crea en DOCU\<dni> las subcarpetas por documento (nombre = documento del orden)
  // para todos los agentes de la tanda elegida. Analiza primero (dry-run) y confirma.
  async function crearSubcarpetas() {
    if (!selectedTanda) {
      toast.warning('Elegí una tanda', 'Seleccioná una tanda arriba.');
      return;
    }
    setCreandoSub(true);
    try {
      type Persona = { dni: number; nombre: string };
      type Resp = { ok: boolean; data: {
        totales: { agentes: number; creadas: number; existentes: number; sinLey: number; sinCarpeta: number };
        sinLey: Persona[]; sinCarpeta: Persona[];
      } };
      // Marca en rojo (en la lista) a los agentes que no se pudieron procesar.
      const marcarErrores = (data: Resp['data']) => {
        const m = new Map<number, string>();
        for (const p of data.sinCarpeta || []) m.set(p.dni, 'No existe la carpeta del agente en DOCU');
        for (const p of data.sinLey || []) m.set(p.dni, 'Sin ley 10430/10471 detectada');
        setSubErrores(m);
        setSubErroresTanda(selectedTanda);
      };

      const prev = await apiFetch<Resp>('/tramites-documentales/tandas/crear-subcarpetas', {
        method: 'POST',
        body: JSON.stringify({ tanda: selectedTanda, dryRun: true }),
      });
      marcarErrores(prev.data); // ya deja marcados los problemáticos aunque canceles
      const t = prev.data.totales;
      if (!t.creadas) {
        toast.ok('Nada para crear', `Todas las subcarpetas ya existen (${t.existentes} en ${t.agentes} agentes).`
          + (t.sinLey || t.sinCarpeta ? ` ${t.sinLey + t.sinCarpeta} con problemas (en rojo).` : ''));
        return;
      }
      const aviso = `Tanda "${selectedTanda}": se crearán ${t.creadas} subcarpeta(s) en ${t.agentes} agente(s).`
        + `\n${t.existentes} ya existen y se saltean.`
        + (t.sinLey ? `\n${t.sinLey} sin ley detectada (se omiten, en rojo).` : '')
        + (t.sinCarpeta ? `\n${t.sinCarpeta} sin carpeta en DOCU (se omiten, en rojo).` : '')
        + `\n\n¿Confirmás la creación?`;
      if (!window.confirm(aviso)) return;

      const real = await apiFetch<Resp>('/tramites-documentales/tandas/crear-subcarpetas', {
        method: 'POST',
        body: JSON.stringify({ tanda: selectedTanda, dryRun: false }),
      });
      marcarErrores(real.data);
      const r = real.data.totales;
      toast.ok('Subcarpetas creadas', `${r.creadas} creada(s), ${r.existentes} ya existían.`
        + (r.sinLey || r.sinCarpeta ? ` Omitidos: ${r.sinLey} sin ley, ${r.sinCarpeta} sin carpeta (en rojo).` : ''));
      if (agente) void loadDocu(agente.dni);
    } catch (e: any) {
      toast.error('No se pudieron crear las subcarpetas', e?.message || 'Error');
    } finally {
      setCreandoSub(false);
    }
  }

  // Clasifica y MUEVE los archivos sueltos de cada agente de la tanda a sus
  // subcarpetas (DNI/CUIL/Título/Matrícula/Ético). Va agente por agente (OCR lento)
  // mostrando progreso y marcando en rojo a los que fallan.
  async function ordenarArchivos() {
    if (!selectedTanda) { toast.warning('Elegí una tanda', 'Seleccioná una tanda arriba.'); return; }
    const agentes = tandaRows.filter((r) => r.tanda === selectedTanda);
    if (!agentes.length) { toast.warning('Tanda vacía', 'No hay agentes en la tanda.'); return; }
    if (!window.confirm(
      `Voy a clasificar y MOVER los archivos de ${agentes.length} agente(s) de "${selectedTanda}" a sus subcarpetas `
      + `(DNI / CUIL / Título / Matrícula / Ético).\nEs lento por el OCR y mueve archivos. ¿Confirmás?`
    )) return;

    setOrdenando(true);
    setOrdenProg({ done: 0, total: agentes.length });
    const errores = new Map<number, string>();
    let totMovidos = 0;
    try {
      for (let i = 0; i < agentes.length; i += 1) {
        const a = agentes[i];
        try {
          const res = await apiFetch<{ ok: boolean; data: { movidos: number; sinCarpeta?: boolean } }>(
            '/tramites-documentales/ordenar-archivos-agente',
            { method: 'POST', body: JSON.stringify({ dni: a.dni, dryRun: false }) }
          );
          totMovidos += res.data.movidos || 0;
          if (res.data.sinCarpeta) errores.set(a.dni, 'No existe la carpeta del agente en DOCU');
        } catch (e: any) {
          errores.set(a.dni, e?.message || 'Error al ordenar archivos');
        }
        setOrdenProg({ done: i + 1, total: agentes.length });
        setSubErrores(new Map(errores));
        setSubErroresTanda(selectedTanda);
      }
      toast.ok('Archivos ordenados', `${totMovidos} archivo(s) movido(s).`
        + (errores.size ? ` ${errores.size} agente(s) con problema (en rojo).` : ''));
      if (agente) void loadDocu(agente.dni);
    } finally {
      setOrdenando(false);
      setOrdenProg(null);
    }
  }

  async function loadDocu(dni: number) {
    setDocuLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { exists: boolean; tree: DocuNode[] } }>(
        `/tramites-documentales/docu-tree?dni=${dni}`
      );
      setDocuExists(res.data.exists);
      setDocuTree(res.data.tree || []);
    } catch (e: any) {
      setDocuExists(false);
      setDocuTree([]);
      toast.error('No se pudo leer la carpeta DOCU', e?.message || 'Error');
    } finally {
      setDocuLoading(false);
    }
  }

  async function abrirAgente(a: TandaAgente) {
    setAgente(a);
    revokeViewer();
    setViewer(null);
    setSelectedFolder('');
    await loadDocu(a.dni);
  }

  async function abrirArchivo(node: DocuNode) {
    if (!agente) return;
    try {
      const { blob } = await apiFetchBlobWithMeta(
        `/tramites-documentales/docu-file?dni=${agente.dni}&path=${encodeURIComponent(node.path)}`
      );
      revokeViewer();
      const url = URL.createObjectURL(blob);
      viewerUrlRef.current = url;
      setViewer({ url, name: node.name, ext: node.ext || '', path: node.path });
    } catch (e: any) {
      toast.error('No se pudo abrir el archivo', e?.message || 'Error');
    }
  }

  async function moverArchivo(fromPath: string, toFolder: string) {
    if (!agente) return;
    try {
      await apiFetch('/tramites-documentales/docu-move', {
        method: 'POST',
        body: JSON.stringify({ dni: agente.dni, from: fromPath, to: toFolder }),
      });
      toast.ok('Movido', `→ ${toFolder || 'raíz'}`);
      await loadDocu(agente.dni);
    } catch (e: any) {
      toast.error('No se pudo mover', e?.message || 'Error');
    }
  }

  async function subirArchivos(files: FileList, toFolder: string) {
    if (!agente || !files.length) return;
    const fd = new FormData();
    fd.append('dni', String(agente.dni));
    fd.append('path', toFolder);
    Array.from(files).forEach((f) => fd.append('files', f));
    try {
      const res = await apiFetch<{ ok: boolean; data: { total: number } }>('/tramites-documentales/docu-upload', {
        method: 'POST',
        body: fd,
      });
      toast.ok('Subido', `${res.data.total} archivo(s) → ${toFolder || 'raíz'}`);
      await loadDocu(agente.dni);
    } catch (e: any) {
      toast.error('No se pudieron subir', e?.message || 'Error');
    }
  }

  async function crearCarpeta() {
    if (!agente) return;
    const name = window.prompt(`Nueva carpeta dentro de "${selectedFolder || 'raíz'}":`, '');
    if (!name || !name.trim()) return;
    try {
      await apiFetch('/tramites-documentales/docu-mkdir', {
        method: 'POST',
        body: JSON.stringify({ dni: agente.dni, path: selectedFolder, name: name.trim() }),
      });
      toast.ok('Carpeta creada', name.trim());
      await loadDocu(agente.dni);
    } catch (e: any) {
      toast.error('No se pudo crear la carpeta', e?.message || 'Error');
    }
  }

  const allSelected = consultaRows.length > 0 && selected.size === consultaRows.length;
  const agentesTandaActual = agentesPorTanda.get(selectedTanda) || [];
  const treeHandlers: TreeHandlers = {
    selectedPath: viewer?.path || null,
    selectedFolder,
    onOpenFile: abrirArchivo,
    onSelectFolder: setSelectedFolder,
    onMove: moverArchivo,
    onUpload: subirArchivos,
    dragPathRef,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Consulta de interinos ─────────────────────────────────────────── */}
      <section style={{ background: CARD_BG, border: BORDER, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={labelStyle}>Año desde</div>
            <input value={anioDesde} onChange={(e) => setAnioDesde(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric" style={{ ...inputStyle, width: 90 }} />
          </div>
          <div>
            <div style={labelStyle}>Año hasta</div>
            <input value={anioHasta} onChange={(e) => setAnioHasta(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric" style={{ ...inputStyle, width: 90 }} />
          </div>
          <button type="button" onClick={consultar} disabled={loadingConsulta} style={primaryBtn}>
            {loadingConsulta ? 'Consultando…' : 'Consultar interinos 10430'}
          </button>
          {consultaRows.length ? (
            <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{consultaRows.length} resultado(s)</span>
          ) : null}
        </div>

        {consultaRows.length ? (
          <>
            <div style={{ maxHeight: 300, overflow: 'auto', marginTop: 12, border: BORDER, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: '#1e1b2e', zIndex: 1 }}>
                    <th style={{ ...thStyle, width: 34 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                    </th>
                    <th style={thStyle}>Apellido y nombre</th>
                    <th style={thStyle}>DNI</th>
                    <th style={thStyle}>Ingreso</th>
                    <th style={thStyle}>Ocupación</th>
                    <th style={thStyle}>Dependencia</th>
                  </tr>
                </thead>
                <tbody>
                  {consultaRows.map((row) => (
                    <tr key={row.dni} style={{ borderTop: BORDER, background: selected.has(row.dni) ? 'rgba(124,58,237,0.12)' : 'transparent' }}>
                      <td style={tdStyle}>
                        <input type="checkbox" checked={selected.has(row.dni)} onChange={() => toggleSelect(row.dni)} />
                      </td>
                      <td style={tdStyle}>{row.apellidoNombre}</td>
                      <td style={tdStyle}>{row.dni}</td>
                      <td style={tdStyle}>{row.fechaIngresoExcel || '-'}</td>
                      <td style={tdStyle}>{row.ocupacionNombre || '-'}</td>
                      <td style={tdStyle}>{row.dependenciaNombre || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={labelStyle}>Nombre de tanda</div>
                <input value={tandaNombre} onChange={(e) => setTandaNombre(e.target.value)}
                  placeholder="Ej: Interinos 2020-2021" style={{ ...inputStyle, width: 240 }} />
              </div>
              <button type="button" onClick={agregarATanda} disabled={savingTanda || !selected.size} style={primaryBtn}>
                {savingTanda ? 'Agregando…' : `Agregar ${selected.size || ''} a tanda`}
              </button>
            </div>
          </>
        ) : null}
      </section>

      {/* ── Tandas + detalle del agente ───────────────────────────────────── */}
      <section style={{ background: CARD_BG, border: BORDER, borderRadius: 12, padding: 16, display: 'flex', gap: 16, minHeight: 460 }}>
        {/* Columna izquierda: tandas + agentes */}
        <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={eyebrowStyle}>Tandas</div>
          {tandas.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tandas.map((t) => (
                <button key={t} type="button" onClick={() => setSelectedTanda(t)}
                  style={{
                    ...chipBtn,
                    background: selectedTanda === t ? ACCENT : 'rgba(255,255,255,0.05)',
                    color: selectedTanda === t ? '#fff' : '#cbd5e1',
                  }}>
                  {t} <span style={{ opacity: 0.7 }}>({agentesPorTanda.get(t)?.length || 0})</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ color: '#64748b', fontSize: '0.82rem' }}>Todavía no hay tandas. Consultá arriba y agregá agentes.</div>
          )}

          {selectedTanda ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button type="button" onClick={() => void crearSubcarpetas()} disabled={creandoSub || ordenando}
                title="Crea en DOCU\<dni> una subcarpeta por cada documento del orden (según la ley del agente), sin duplicar"
                style={{ ...primaryBtn, background: creandoSub ? 'rgba(255,255,255,0.08)' : ACCENT, cursor: creandoSub || ordenando ? 'default' : 'pointer', fontSize: '0.78rem', padding: '8px 12px' }}>
                {creandoSub ? 'Analizando…' : `📁 Crear subcarpetas en "${selectedTanda}"`}
              </button>
              <button type="button" onClick={() => void ordenarArchivos()} disabled={ordenando || creandoSub}
                title="Clasifica los archivos sueltos de cada agente (nombre + OCR) y los mueve a la subcarpeta DNI/CUIL/Título/Matrícula/Ético"
                style={{ ...primaryBtn, background: ordenando ? 'rgba(255,255,255,0.08)' : '#0f766e', cursor: ordenando || creandoSub ? 'default' : 'pointer', fontSize: '0.78rem', padding: '8px 12px' }}>
                {ordenando && ordenProg ? `Ordenando ${ordenProg.done}/${ordenProg.total}…` : `🗂️ Ordenar archivos de "${selectedTanda}"`}
              </button>
            </div>
          ) : null}

          <div style={{ flex: 1, overflow: 'auto', border: BORDER, borderRadius: 8 }}>
            {agentesTandaActual.map((a) => {
              const err = subErroresTanda === selectedTanda ? subErrores.get(a.dni) : undefined;
              return (
              <div key={a.id}
                onClick={() => abrirAgente(a)}
                title={err || undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer',
                  borderBottom: BORDER,
                  background: agente?.id === a.id ? 'rgba(124,58,237,0.22)' : err ? 'rgba(239,68,68,0.12)' : 'transparent',
                  borderLeft: `3px solid ${err ? '#ef4444' : ESTADO_COLOR[a.estado] || 'transparent'}`,
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: err ? '#fca5a5' : '#e2e8f0', fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {err ? '⚠ ' : ''}{a.apellidoNombre || `DNI ${a.dni}`}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.72rem' }}>DNI {a.dni}</div>
                </div>
                <select value={a.estado} onClick={(e) => e.stopPropagation()} onChange={(e) => cambiarEstado(a, e.target.value)}
                  style={{
                    background: 'rgba(255,255,255,0.05)', border: BORDER, borderRadius: 6, padding: '3px 4px',
                    color: ESTADO_COLOR[a.estado] || '#cbd5e1', fontSize: '0.72rem', cursor: 'pointer',
                  }}>
                  {ESTADOS.map((es) => <option key={es} value={es} style={{ color: '#111' }}>{es}</option>)}
                </select>
                <button type="button" title="Quitar de la tanda"
                  onClick={(e) => { e.stopPropagation(); void quitarDeTanda(a.tanda, a.dni); }}
                  style={xBtn}>✕</button>
              </div>
              );
            })}
            {selectedTanda && !agentesTandaActual.length ? (
              <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Tanda vacía.</div>
            ) : null}
          </div>
        </div>

        {/* Columna derecha: ficha + carpeta DOCU + visor */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!agente ? (
            <div style={{ color: '#64748b', fontSize: '0.85rem', margin: 'auto' }}>
              Elegí un agente de la tanda para ver su carpeta DOCU y sus datos.
            </div>
          ) : (
            <>
              {/* Ficha del agente (datos de la base) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', padding: '10px 12px', border: BORDER, borderRadius: 8, alignItems: 'center' }}>
                <strong style={{ color: '#fff', fontSize: '0.9rem' }}>{agente.apellidoNombre || `DNI ${agente.dni}`}</strong>
                <Ficha k="DNI" v={String(agente.dni)} />
                <Ficha k="Ingreso" v={agente.fechaIngreso || '-'} />
                <Ficha k="Ocupación" v={agente.ocupacionNombre || '-'} />
                <Ficha k="Ley" v={agente.ocupacionLey || agente.leyNombre || '-'} />
                <Ficha k="Planta" v={agente.plantaNombre || '-'} />
                <Ficha k="Dependencia" v={agente.dependenciaNombre || '-'} />
                <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: ESTADO_COLOR[agente.estado], fontWeight: 700, textTransform: 'uppercase' }}>
                  ● {agente.estado}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
                {/* Arbol DOCU */}
                <div
                  style={{ width: 300, flexShrink: 0, border: rootDragOver ? `1px dashed ${ACCENT}` : BORDER, borderRadius: 8, overflow: 'auto', padding: 6, background: rootDragOver ? 'rgba(124,58,237,0.08)' : 'transparent' }}
                  onDragOver={(e) => { e.preventDefault(); setRootDragOver(true); }}
                  onDragLeave={() => setRootDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault(); setRootDragOver(false);
                    if (e.dataTransfer.files?.length) void subirArchivos(e.dataTransfer.files, selectedFolder);
                    else if (dragPathRef.current) void moverArchivo(dragPathRef.current, '');
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <div style={{ ...eyebrowStyle, flex: 1 }}>DOCU\{agente.dni}</div>
                    <button type="button" title="Subir archivos" onClick={() => fileInputRef.current?.click()} style={miniBtn}>⬆ Subir</button>
                    <button type="button" title="Nueva carpeta" onClick={crearCarpeta} style={miniBtn}>＋ Carpeta</button>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 6 }}>
                    Destino: <b style={{ color: '#94a3b8' }}>{selectedFolder || 'raíz'}</b>
                    {selectedFolder ? <button type="button" onClick={() => setSelectedFolder('')} style={{ ...xBtn, fontSize: '0.7rem' }}>(raíz)</button> : null}
                  </div>
                  <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
                    onChange={(e) => { if (e.target.files?.length) void subirArchivos(e.target.files, selectedFolder); e.target.value = ''; }} />

                  {docuLoading ? (
                    <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 6 }}>Leyendo carpeta…</div>
                  ) : !docuExists ? (
                    <div style={{ color: '#f59e0b', fontSize: '0.8rem', padding: 6 }}>La carpeta no existe todavía. Subí un archivo o creá una carpeta para armarla.</div>
                  ) : !docuTree.length ? (
                    <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 6 }}>Carpeta vacía.</div>
                  ) : (
                    <TreeView nodes={docuTree} h={treeHandlers} />
                  )}
                </div>

                {/* Visor */}
                <div style={{ flex: 1, minWidth: 0, border: BORDER, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#0f0f17' }}>
                  {!viewer ? (
                    <div style={{ color: '#64748b', fontSize: '0.85rem', margin: 'auto', textAlign: 'center', padding: 16 }}>
                      Click en un archivo para verlo.<br />Arrastrá archivos acá (o a una carpeta) para subirlos, o arrastrá un archivo del árbol a una carpeta para moverlo.
                    </div>
                  ) : viewer.ext === 'pdf' ? (
                    <iframe title={viewer.name} src={viewer.url} style={{ border: 'none', width: '100%', height: '100%', minHeight: 480 }} />
                  ) : IMG_EXT.has(viewer.ext) ? (
                    <div style={{ overflow: 'auto', padding: 12, textAlign: 'center' }}>
                      <img src={viewer.url} alt={viewer.name} style={{ maxWidth: '100%' }} />
                    </div>
                  ) : (
                    <div style={{ margin: 'auto', textAlign: 'center', color: '#cbd5e1', fontSize: '0.85rem' }}>
                      <div style={{ marginBottom: 8 }}>No hay vista previa para <b>{viewer.name}</b>.</div>
                      <a href={viewer.url} download={viewer.name} style={{ color: ACCENT }}>Descargar</a>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Ficha({ k, v }: { k: string; v: string }) {
  return (
    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
      <span style={{ color: '#64748b' }}>{k}:</span> <span style={{ color: '#cbd5e1' }}>{v}</span>
    </span>
  );
}

const labelStyle: React.CSSProperties = { color: '#64748b', fontSize: '0.72rem', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
const eyebrowStyle: React.CSSProperties = { color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 };
const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: BORDER, borderRadius: 8, padding: '7px 10px', color: '#fff', fontSize: '0.85rem' };
const primaryBtn: React.CSSProperties = { background: ACCENT, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' };
const chipBtn: React.CSSProperties = { border: BORDER, borderRadius: 20, padding: '4px 12px', fontSize: '0.78rem', cursor: 'pointer' };
const miniBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', color: '#cbd5e1', cursor: 'pointer' };
const xBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem', padding: 4 };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', color: '#94a3b8', fontWeight: 600, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: 0.3 };
const tdStyle: React.CSSProperties = { padding: '6px 10px', color: '#cbd5e1' };

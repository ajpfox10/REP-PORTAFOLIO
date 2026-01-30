import React, { useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "../components/Layout";
import { useToast } from "../ui/toast";
import { apiFetch, apiFetchBlob, apiFetchBlobWithMeta } from "../api/http";
import { exportToExcel, exportToPdf, exportToWord, printTable } from "../utils/export";
import { trackAction } from "../logging/track";
import { loadSession } from "../auth/session";

// 🎨 CSS de esta ruta (NO global): /src/pages/styles/GestionPage.css
import "./styles/GestionPage.css";

export function GestionPage() {
  const toast = useToast();

  const [dni, setDni] = useState("");
  const [fullName, setFullName] = useState("");
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<any>(null);

  // ✅ el back trabaja por ID (PK). El usuario busca por DNI -> resolvemos ID y recién ahí pedimos /agentes/:id
  async function resolveAgenteIdByDni(dniValue: string) {
    const clean = String(dniValue).replace(/\D/g, "");
    if (!clean) throw new Error("DNI inválido");

    // 🔎 Back no filtra por query en el CRUD genérico, así que escaneamos páginas de la VIEW agentexdni1
    // (límite y páginas acotadas para no matar performance)
    const limit = 200;
    const maxPages = 10;

    for (let page = 1; page <= maxPages; page++) {
      const res = await apiFetch<any>(`/agentexdni1?page=${page}&limit=${limit}`);
      const rows = Array.isArray(res?.data) ? res.data : [];

      const hit = rows.find((r: any) => String(r?.dni ?? "").replace(/\D/g, "") === clean);
      if (hit) {
        const agenteId = hit?.agente_id ?? hit?.id;
        if (!agenteId) throw new Error("No encontrado");
        return String(agenteId);
      }

      // si ya no hay más filas, cortamos
      if (!rows.length || rows.length < limit) break;
    }

    throw new Error("No encontrado");
  }

  // ✅ módulos por DNI (se activan DESPUÉS del Enter)
  // Queremos abrir VARIOS a la vez (stack de cards abajo), sin tocar endpoints.
  // ⚠️ NO tocamos endpoints del back. Solo agregamos un módulo nuevo que consume una tabla existente.
  // El módulo "documentos" apunta a la tabla "tblarchivos" (como en tu screenshot de HeidiSQL).
  type ModuleKey = "consultas" | "pedidos" | "documentos";
  type ModuleState = {
    open: boolean;
    rows: any[];
    selectedIndex: number;
    loading: boolean;
    scanned: { pages: number; totalPages: number; total: number } | null;
    // Performance: no renderizamos 1000 filas de golpe.
    tablePage: number; // 1-based
    tablePageSize: number;
  };

  const [modules, setModules] = useState<Record<ModuleKey, ModuleState>>({
    consultas: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
    pedidos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
    documentos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
  });

  // ✅ Modal para ampliar celdas (compartido)
  const [cellModal, setCellModal] = useState<{ module: ModuleKey; col: string; value: string; rowIndex: number } | null>(null);

  // 🧾 Alta/Baja de pedidos (UI)
  // 🧾 Alta/Baja de pedidos (UI)
const [pedidoModal, setPedidoModal] = useState<{
  open: boolean;
  lugar: string;
  estado: "pendiente" | "hecho";
  tipos: Record<string, boolean>;
  custom: string;
  caracteristicas: string; // ✅ NUEVO
  saving: boolean;
}>({
  open: false,
  lugar: "",
  estado: "pendiente",
  tipos: {
    "Certificado de trabajo": false,
    "Certificado de trabajo (con características)": false,
    "IOMA": false,
    "Copia de resoluciones": false,
    "Copia de recibos": false,
    "Constancia de servicios": false,
  },
  custom: "",
  caracteristicas: "", // ✅ NUEVO
  saving: false,
});


  // 📎 Visor de documentos (cuando doble click en ruta)
  const [docViewer, setDocViewer] = useState<{
    open: boolean;
    route: string;
    row: any | null;
    objectUrl: string | null;
    meta: { contentType: string; filename: string | null } | null;
    loading: boolean;
    error: string | null;
  }>({ open: false, route: '', row: null, objectUrl: null, meta: null, loading: false, error: null });

  // 🧼 Normaliza la ruta guardada en DB para usarla como path de API.
  // - Si ya viene con http(s), la tratamos como URL externa.
  // - Si viene como "uploads/..", le anteponemos '/'.
  function normalizeDocRoute(route: string): { kind: 'absolute' | 'api'; value: string } {
    const r = String(route || '').trim();
    if (!r) return { kind: 'api', value: '/' };
    if (/^https?:\/\//i.test(r)) return { kind: 'absolute', value: r };
    return { kind: 'api', value: r.startsWith('/') ? r : `/${r}` };
  }

  async function openDocViewer(route: string, rowRef: any) {
    const norm = normalizeDocRoute(route);
    trackAction('gestion_document_open', { dni: Number(cleanDni), route, kind: norm.kind });

    // cerramos y limpiamos anterior
    setDocViewer((prev) => {
      if (prev.objectUrl && prev.objectUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(prev.objectUrl); } catch { /* noop */ }
      }
      return { open: true, route, row: rowRef ?? null, objectUrl: null, meta: null, loading: true, error: null };
    });

    // URL absoluta: no podemos garantizar auth, así que la embebemos directo.
    if (norm.kind === 'absolute') {
      setDocViewer((prev) => ({ ...prev, objectUrl: norm.value, loading: false, meta: { contentType: '', filename: (route.split('/').pop() || null) } }));
      return;
    }

    try {
      const { blob, contentType, filename } = await apiFetchBlobWithMeta(norm.value);
      const url = URL.createObjectURL(blob);
      setDocViewer((prev) => ({ ...prev, objectUrl: url, loading: false, meta: { contentType, filename: filename || (route.split('/').pop() || null) }, error: null }));
    } catch (e: any) {
      setDocViewer((prev) => ({ ...prev, loading: false, error: e?.message || 'No se pudo abrir el archivo' }));
      toast.error('No se pudo abrir el archivo', e?.message || 'Error');
      trackAction('gestion_document_open_error', { dni: Number(cleanDni), route, message: e?.message });
    }
  }

  function closeDocViewer() {
    setDocViewer((prev) => {
      if (prev.objectUrl && prev.objectUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(prev.objectUrl); } catch { /* noop */ }
      }
      return { open: false, route: '', row: null, objectUrl: null, meta: null, loading: false, error: null };
    });
  }

  // ✅ Foto privada (blob url)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const lastObjectUrlRef = useRef<string | null>(null);

  function revokeLastObjectUrl() {
    if (lastObjectUrlRef.current) {
      URL.revokeObjectURL(lastObjectUrlRef.current);
      lastObjectUrlRef.current = null;
    }
  }

  // 📸 Foto credencial: el endpoint trabaja por DNI (recurso en carpeta), no por PK id.
  async function fetchFotoPrivada(dniValue: string) {
    revokeLastObjectUrl();
    setFotoUrl(null);

    const clean = String(dniValue).replace(/\D/g, "");
    const blob = await apiFetchBlob(`/agentes/${clean}/foto`);
    const objUrl = URL.createObjectURL(blob);
    lastObjectUrlRef.current = objUrl;
    setFotoUrl(objUrl);
  }

  // ✅ Cuando cambia el agente, levantamos la foto (privada)
  useEffect(() => {
    const d = row?.dni ? String(row.dni).replace(/\D/g, "") : "";
    if (!d) {
      revokeLastObjectUrl();
      setFotoUrl(null);
      return;
    }

    fetchFotoPrivada(d).catch((err) => {
      console.log("❌ Error cargando foto:", err?.message || err);
      setFotoUrl(null);
    });

    return () => {
      revokeLastObjectUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.dni]);

  async function onSearch() {
    const clean = dni.replace(/\D/g, "");
    if (!clean) {
      toast.error("DNI inválido", "Ingresá un DNI válido");
      return;
    }

    try {
      setLoading(true);
      setRow(null);
      setMatches([]);
      setModules({
        consultas: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
        pedidos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
        documentos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
      });
      revokeLastObjectUrl();
      setFotoUrl(null);

      const agenteId = await resolveAgenteIdByDni(clean);
      const res = await apiFetch<any>(`/agentes/${agenteId}`);
      setRow(res.data);
      toast.ok("Agente cargado");
      trackAction('gestion_load_agente_by_dni', { dni: clean, agenteId });
    } catch (e: any) {
      toast.error("No se pudo cargar el agente", e?.message || "Error");
      trackAction('gestion_load_agente_by_dni_error', { dni: clean, message: e?.message });
    } finally {
      setLoading(false);
    }
  }

  async function onSearchByName() {
    const q = fullName.trim();
    if (!q) {
      toast.error("Búsqueda inválida", "Ingresá apellido y/o nombre");
      return;
    }

    try {
      setLoading(true);
      setMatches([]);
      setRow(null);
      setModules({
        consultas: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
        pedidos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
        documentos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
      });
      revokeLastObjectUrl();
      setFotoUrl(null);

      // ✅ búsqueda enterprise: el back filtra (no filtramos en front)
      const res = await apiFetch<any>(
        `/personal/search?q=${encodeURIComponent(q)}&limit=20&page=1`
      );
      setMatches(res.data || []);
      toast.ok("Búsqueda lista");
    } catch (e: any) {
      toast.error("No se pudo buscar", e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  async function loadByDni(d: string) {
    const clean = String(d).replace(/\D/g, "");
    setDni(clean);

    try {
      setLoading(true);
      setRow(null);
      setMatches([]);
      setModules({
        consultas: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
        pedidos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
        documentos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
      });
      revokeLastObjectUrl();
      setFotoUrl(null);

      const agenteId = await resolveAgenteIdByDni(clean);
      const res = await apiFetch<any>(`/agentes/${agenteId}`);
      setRow(res.data);
      toast.ok("Agente cargado");
      trackAction('gestion_agente_loaded', { by: 'dni', dni: clean, agenteId });
    } catch (e: any) {
      toast.error("No se pudo cargar el agente", e?.message || "Error");
      trackAction('gestion_agente_load_error', { by: 'dni', dni: clean, message: e?.message });
    } finally {
      setLoading(false);
    }
  }

  const cleanDni = useMemo(() => {
    const d = row?.dni ? String(row.dni).replace(/\D/g, "") : "";
    return d;
  }, [row?.dni]);

  // 👤 Actor (usuario logueado) para auditoría (created_by / updated_by)
  // No tocamos endpoints: solo mandamos el campo si el back lo acepta.
  function getActor() {
    const s = loadSession();
    const u: any = s?.user || {};
    return (
      u?.username ||
      u?.user ||
      u?.name ||
      u?.email ||
      u?.id ||
      'anon'
    );
  }

  // ✅ Carga (o recarga) un módulo sin tocar endpoints.
  // Abre el módulo en el stack de abajo. Permite varios abiertos a la vez.
  async function loadModule(table: ModuleKey, opts?: { forceReload?: boolean }) {
    if (!cleanDni) return;

    const current = modules[table];
    if (current.loading) return;

    // 1) Toggle open (si estaba cerrado lo abrimos). Si estaba abierto y NO pedimos reload, no tocamos.
    setModules((prev) => ({
      ...prev,
      [table]: {
        ...prev[table],
        open: true,
      },
    }));

    trackAction('gestion_module_open', { module: table, dni: Number(cleanDni), forceReload: !!opts?.forceReload });

    if (current.rows.length && !opts?.forceReload) {
      // ya está cargado, solo lo dejamos abierto
      return;
    }

    try {
      setModules((prev) => ({
        ...prev,
        [table]: { ...prev[table], loading: true, rows: [], selectedIndex: 0, scanned: null, tablePage: 1 },
      }));

      // ✅ Endpoints (NO tocamos el back):
      // - consultas  -> /consultas
      // - pedidos    -> /pedidos
      // - documentos -> /tblarchivos (tabla del screenshot)
      const endpoint = table === 'documentos' ? '/tblarchivos' : `/${encodeURIComponent(table)}`;
      const res = await apiFetch<any>(endpoint);
      const rows = Array.isArray(res?.data) ? res.data : [];

      // filtrado por DNI en front (porque el back trae todo)
      const acc0 = rows.filter((r: any) => String(r?.dni ?? "").replace(/\D/g, "") === cleanDni);

      // Si ya vino todo en la primera respuesta, dejamos acá
      if (!res?.meta) {
        setModules((prev) => ({
          ...prev,
          [table]: { ...prev[table], loading: false, rows: acc0, selectedIndex: 0, scanned: null, tablePage: 1 },
        }));
        if (!acc0.length) toast.ok("Sin resultados", `No hay ${table} para DNI ${cleanDni}`);
        else toast.ok("Listo", `${table}: ${acc0.length} registro/s para DNI ${cleanDni}`);
        return;
      }

      // 2) Fallback: CRUD genérico paginado (como lo tenías antes)
      const limit = 200;
      const maxPages = 10;
      const maxRows = 1000;

      let page = 1;
      let totalPages = 1;
      let total = 0;
      const acc: any[] = [];

      while (page <= totalPages && page <= maxPages && acc.length < maxRows) {
        const res2 = await apiFetch<any>(`${endpoint}?page=${page}&limit=${limit}`);
        const rows2 = Array.isArray(res2?.data) ? res2.data : [];
        const meta2 = res2?.meta;

        if (meta2 && Number.isFinite(Number(meta2.total)) && Number.isFinite(Number(meta2.limit))) {
          total = Number(meta2.total);
          totalPages = Math.max(1, Math.ceil(Number(meta2.total) / Number(meta2.limit)));
        }

        for (const r of rows2) {
          const rdni = r?.dni != null ? String(r.dni).replace(/\D/g, "") : "";
          if (rdni === cleanDni) acc.push(r);
          if (acc.length >= maxRows) break;
        }

        page += 1;
        if (!meta2) break;
      }

      setModules((prev) => ({
        ...prev,
        [table]: {
          ...prev[table],
          loading: false,
          rows: acc,
          selectedIndex: 0,
          tablePage: 1,
          scanned: { pages: Math.min(page - 1, totalPages), totalPages, total },
        },
      }));

      if (!acc.length) toast.ok("Sin resultados", `No hay ${table} para DNI ${cleanDni}`);
      else toast.ok("Listo", `${table}: ${acc.length} registro/s (fallback CRUD)`);
    } catch (e: any) {
      setModules((prev) => ({
        ...prev,
        [table]: { ...prev[table], loading: false },
      }));
      toast.error("No se pudo cargar módulo", e?.message || "Error");
    }
  }

  function closeModule(table: ModuleKey) {
    trackAction('gestion_module_close', { module: table, dni: cleanDni });
    setModules((prev) => ({
      ...prev,
      [table]: { ...prev[table], open: false },
    }));
  }

  // =======================
  // 🧾 PEDIDOS: alta / baja / estado (sin tocar endpoints)
  // =======================
  function openPedidoModal() {
    if (!cleanDni) {
      toast.error('Primero cargá un DNI', 'Enter primero, después módulos');
      return;
    }
    setPedidoModal((prev) => ({
  ...prev,
  open: true,
  saving: false,
  lugar: prev.lugar || "",
  estado: "pendiente",
  custom: "",
  caracteristicas: "", // ✅ NUEVO
  tipos: Object.fromEntries(Object.keys(prev.tipos).map((k) => [k, false])) as Record<string, boolean>,
   }));
 }

  function closePedidoModal() {
    setPedidoModal((prev) => ({ ...prev, open: false, saving: false }));
  }

  async function createPedidosFromModal() {
  if (!cleanDni) return;
  const actor = getActor();

  const checked = Object.entries(pedidoModal.tipos)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const custom = (pedidoModal.custom || "").trim();
  if (custom) checked.push(custom);

  if (!checked.length) {
    toast.error("Seleccioná al menos un pedido", "Tildá un tipo o escribí uno personalizado");
    return;
  }

  try {
    setPedidoModal((prev) => ({ ...prev, saving: true }));
    trackAction("gestion_pedido_create_attempt", {
      dni: Number(cleanDni),
      count: checked.length,
      estado: pedidoModal.estado,
      actor,
    });

    // ✅ Características: safe (no explota si está undefined)
    const car = (pedidoModal.caracteristicas || "").trim();

    // Creamos 1 registro por tipo tildado
    for (const tipo of checked) {
      // ✅ concatena características a TODOS los tildados si hay texto
      const pedidoFinal = car ? `${tipo} (Características: ${car})` : tipo;

      const payload: any = {
        dni: Number(cleanDni),
        pedido: pedidoFinal,
        lugar: pedidoModal.lugar || "",
        fecha: new Date().toISOString(),
        estado: pedidoModal.estado,
        created_by: actor,
        updated_by: actor,
      };

      await apiFetch<any>("/pedidos", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    // ✅ tu toast NO tiene success
    toast.ok("Pedido cargado", `${checked.length} pedido(s) agregado(s)`);
    closePedidoModal();

    await loadModule("pedidos", { forceReload: true });
    trackAction("gestion_pedido_create_ok", { dni: Number(cleanDni), count: checked.length, actor });
  } catch (e: any) {
    toast.error("No se pudo cargar el pedido", e?.message || "Error");
    trackAction("gestion_pedido_create_error", { dni: Number(cleanDni), message: e?.message });
    setPedidoModal((prev) => ({ ...prev, saving: false }));
  }
}
  async function patchPedido(id: any, changes: any) {
    const pid = String(id);
    // Algunos backends aceptan PATCH, otros PUT. Probamos PATCH y si falla, PUT.
    try {
      return await apiFetch<any>(`/pedidos/${encodeURIComponent(pid)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
    } catch (e: any) {
      return await apiFetch<any>(`/pedidos/${encodeURIComponent(pid)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...changes, id: pid }),
      });
    }
  }

  async function bajaPedidoSelected() {
    if (!cleanDni) return;
    const mod = modules.pedidos;
    const selected = mod.rows[mod.selectedIndex];
    if (!selected) {
      toast.error('Seleccioná un pedido', 'Elegí una fila o un item en navegación');
      return;
    }

    const actor = getActor();
    const nowIso = new Date().toISOString();
    const id = selected?.id;
    if (!id) {
      toast.error('Pedido inválido', 'No tiene id');
      return;
    }

    try {
      trackAction('gestion_pedido_baja_attempt', { dni: Number(cleanDni), id, actor });
      await patchPedido(id, {
        estado: 'baja',
        deleted_at: nowIso,
        updated_at: nowIso,
        updated_by: actor,
      });
      toast.ok('Pedido dado de baja', `Pedido #${id}`);
      await loadModule('pedidos', { forceReload: true });
      trackAction('gestion_pedido_baja_ok', { dni: Number(cleanDni), id, actor });
    } catch (e: any) {
      toast.error('No se pudo dar de baja', e?.message || 'Error');
      trackAction('gestion_pedido_baja_error', { dni: Number(cleanDni), id, message: e?.message });
    }
  }

  async function marcarPedidoEstado(next: 'pendiente' | 'hecho') {
    if (!cleanDni) return;
    const mod = modules.pedidos;
    const selected = mod.rows[mod.selectedIndex];
    if (!selected) {
      toast.error('Seleccioná un pedido', 'Elegí una fila o un item en navegación');
      return;
    }
    const actor = getActor();
    const nowIso = new Date().toISOString();
    const id = selected?.id;
    if (!id) return;

    try {
      trackAction('gestion_pedido_estado_attempt', { dni: Number(cleanDni), id, next, actor });
      await patchPedido(id, {
        estado: next,
        updated_at: nowIso,
        updated_by: actor,
      });
      toast.ok('Actualizado', `Pedido #${id} -> ${next}`);
      await loadModule('pedidos', { forceReload: true });
      trackAction('gestion_pedido_estado_ok', { dni: Number(cleanDni), id, next, actor });
    } catch (e: any) {
      toast.error('No se pudo actualizar', e?.message || 'Error');
      trackAction('gestion_pedido_estado_error', { dni: Number(cleanDni), id, next, message: e?.message });
    }
  }

  // ========= Helpers por módulo (porque ahora puede haber varios abiertos) =========
  function getModuleTitle(key: ModuleKey) {
    if (key === 'pedidos') return 'Pedidos';
    if (key === 'documentos') return 'Documentos';
    return 'Consultas';
  }

  // ✅ Orden de columnas: en Consultas queremos "motivo_consulta" antes de "explicacion".
  // También dejamos primero id/dni si existen.
  function getModuleCols(key: ModuleKey, rows: any[]) {
    if (!rows.length) return [] as string[];
    const cols = Object.keys(rows[0]);
    const preferred: Record<ModuleKey, string[]> = {
      consultas: ["id", "dni", "motivo_consulta", "explicacion"],
      pedidos: ["id", "dni"],
      // ✅ tabla tblarchivos (HeidiSQL): orden humano y útil
      documentos: [
        "id",
        "dni",
        "ruta",
        "nombre",
        "numero",
        "tipo",
        "tamano",
        "fecha",
        "descripcion_archivo",
        "nombre_archivo_original",
      ],
    };
    const pref = preferred[key] || [];
    const out: string[] = [];
    for (const p of pref) if (cols.includes(p)) out.push(p);
    for (const c of cols) if (!out.includes(c)) out.push(c);
    return out;
  }

  function getSelectedRow(key: ModuleKey) {
    const st = modules[key];
    if (!st.rows.length) return null;
    const idx = Math.min(Math.max(0, st.selectedIndex), st.rows.length - 1);
    return st.rows[idx];
  }

  function renderExportActions(key: ModuleKey) {
    const st = modules[key];
    const title = `${getModuleTitle(key)} (DNI ${cleanDni})`;
    const file = `${key}_dni_${cleanDni}`;
    return (
      <div className="row gp-export-actions">
        <button
          className="btn"
          type="button"
          onClick={() => {
            trackAction('export_print', { module: key, dni: Number(cleanDni), rows: st.rows.length });
            printTable(title, st.rows);
          }}
          disabled={!st.rows.length}
        >
          Imprimir
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            trackAction('export_excel', { module: key, dni: Number(cleanDni), rows: st.rows.length });
            exportToExcel(`${file}.xlsx`, st.rows);
          }}
          disabled={!st.rows.length}
        >
          Excel
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            trackAction('export_pdf', { module: key, dni: Number(cleanDni), rows: st.rows.length });
            exportToPdf(title, st.rows);
          }}
          disabled={!st.rows.length}
        >
          PDF
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            trackAction('export_word', { module: key, dni: Number(cleanDni), rows: st.rows.length });
            exportToWord(title, st.rows);
          }}
          disabled={!st.rows.length}
        >
          Word
        </button>
      </div>
    );
  }

  return (
    <Layout title="Gestión" showBack>
      <>
      <div className="gestion-layout">
        <div className="gp-topgrid">
        {/* IZQUIERDA */}
        <div className="gp-col gp-left">
          <div className="card gp-card-14">
            <div className="search-row">
              <div className="search-field">
                <label className="label">DNI</label>
                <input
                  className="input"
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSearch()}
                  placeholder="Enter para buscar"
                />
              </div>

              <div className="search-field">
                <label className="label">Nombre</label>
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSearchByName()}
                  placeholder="Apellido Nombre (Enter)"
                />
              </div>
            </div>

            <div className="muted gp-mt-10">
              Buscá por DNI o por Apellido/Nombre. Enter y a otra cosa 😎
            </div>
          </div>

          {loading && (
            <div className="card gp-card-14">
              Cargando…
            </div>
          )}

          {row && (
            <div className="card gp-card-14">
              <h3 className="gp-h3-top0">
                {row.apellido}, {row.nombre}
              </h3>

              <p><b>DNI:</b> {row.dni}</p>
              <p><b>CUIL:</b> {row.cuil || "-"}</p>
              <p><b>Ley:</b> {row.ley_nombre || row.ley_id}</p>
              <p><b>Dependencia:</b> {row.dependencia_nombre || "-"}</p>
              <p><b>Servicio:</b> {row.servicio_nombre || "-"}</p>
              <p><b>Desde:</b> {row.fecha_desde || "-"}</p>
              <p><b>Hasta:</b> {row.fecha_hasta ?? "Actual"}</p>
            </div>
          )}
        <>
          {/* ✅ MÓDULOS: solo aparecen cuando YA se buscó por DNI (Enter) */}
          {row?.dni ? (
            <div className="card gp-card-14">
              <div className="row gp-row-between-baseline">
                <div>
                  <h3 className="gp-h3-top0-bot6">Gestión por DNI</h3>
                  <div className="muted">Enter primero. Después habilitamos los módulos, sin humo ni duplicados.</div>
                </div>
                <div className="badge">DNI {cleanDni}</div>
              </div>

              <div className="sep" />

              <div className="grid gp-mod-grid">
                <div className="card gp-card-12">
                  <div className="row gp-row-between-center">
                    <b>Consultas</b>
                    <span className="badge">/consultas</span>
                  </div>
                  <p className="muted gp-mt-6">Atenciones, motivo y explicación.</p>
                  <div className="row gp-row-between-center">
                    <button
                      className="btn"
                      type="button"
                      onClick={() => (modules.consultas.open ? closeModule("consultas") : loadModule("consultas"))}
                      disabled={modules.consultas.loading}
                    >
                      {modules.consultas.loading ? "Cargando…" : modules.consultas.open ? "Cerrar" : "Ver"}
                    </button>
                    {modules.consultas.open ? <span className="badge">Activo</span> : null}
                  </div>
                </div>
            <>
                <div className="card gp-card-12">
                  <div className="row gp-row-between-center">
                    <b>Pedidos</b>
                    <span className="badge">/pedidos</span>
                  </div>
                  <p className="muted gp-mt-6">Pedidos, estado, lugar y fecha.</p>
                  <div className="row gp-row-between-center">
                    <button
                      className="btn"
                      type="button"
                      onClick={() => (modules.pedidos.open ? closeModule("pedidos") : loadModule("pedidos"))}
                      disabled={modules.pedidos.loading}
                    >
                      {modules.pedidos.loading ? "Cargando…" : modules.pedidos.open ? "Cerrar" : "Ver"}
                    </button>
                    {modules.pedidos.open ? <span className="badge">Activo</span> : null}
                  </div>
                </div>

                <div className="card gp-card-12">
                  <div className="row gp-row-between-center">
                    <b>Documentos</b>
                    <span className="badge">/tblarchivos</span>
                  </div>
                  <p className="muted gp-mt-6">Documentos, resoluciones y más (por DNI).</p>
                  <div className="row gp-row-between-center">
                    <button
                      className="btn"
                      type="button"
                      onClick={() => (modules.documentos.open ? closeModule("documentos") : loadModule("documentos"))}
                      disabled={modules.documentos.loading}
                    >
                      {modules.documentos.loading ? "Cargando…" : modules.documentos.open ? "Cerrar" : "Ver"}
                    </button>
                    {modules.documentos.open ? <span className="badge">Activo</span> : null}
                  </div>
                </div>

                {/* 🔥 Carga operativa de pedidos (sin tocar endpoints)
                    - Primero ves la lista en "Pedidos"
                    - Acá abrís el modal de alta y acciones rápidas */}
                <div className="card gp-card-12">
                  <div className="row gp-row-between-center">
                    <b>Carga</b>
                    <span className="badge">Pedidos</span>
                  </div>
                  <p className="muted gp-mt-6">Cargar, marcar o dar de baja pedidos (por DNI).</p>
                  <div className="row gp-row-between-center">
                    <button
                      className="btn"
                      type="button"
                      onClick={async () => {
                        // Abrimos pedidos (si no estaba) y luego el modal
                        if (!modules.pedidos.open) await loadModule('pedidos');
                        openPedidoModal();
                      }}
                      disabled={modules.pedidos.loading}
                    >
                      {modules.pedidos.loading ? 'Cargando…' : 'Cargar pedido'}
                    </button>
                    <button
                      className="btn danger"
                      type="button"
                      onClick={async () => {
                        if (!modules.pedidos.open) await loadModule('pedidos');
                        await bajaPedidoSelected();
                      }}
                      disabled={modules.pedidos.loading || !modules.pedidos.rows.length}
                    >
                      Baja
                    </button>
                  </div>
                </div>
              </div>

              {/*
                =========================
                MÓDULO EXPANDIBLE (dentro de la misma card)
                - Cuando tocás "Ver" en Consultas/Pedidos, ESTA card se estira.
                - No genera secciones nuevas abajo fuera de la card.
                - Incluye navegación (lista) porque puede haber cientos de registros.
                =========================
              */}
              
            </div>
          ) : null}

          {!!matches.length && (
            <div className="card gp-card-14">
              <h3 className="gp-h3-top0">Coincidencias</h3>
              <ul className="gp-match-list">
                {matches.map((m: any) => (
                  <li key={m.dni} className="gp-match-item">
                    <button className="btn" onClick={() => loadByDni(m.dni)}>
                      {m.apellido}, {m.nombre} (DNI {m.dni})
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>



        {/* DERECHA */}
        <div className="gp-col gp-right-panel">
          {/*
            NOTA UI:
            La foto credencial suele venir como una imagen tipo "tarjeta" (fondo blanco) y puede ser grande.
            Esta clase extra fuerza contención (overflow) para que NO se superponga a otras secciones.
          */}
          <div className="card gp-card-14 gp-photo-card">
            <h3 className="gp-h3-top0">Foto credencial</h3>

            {!row?.dni ? (
              <p className="muted">Buscá un agente.</p>
            ) : fotoUrl ? (
              <img src={fotoUrl} alt="Foto credencial" className="gp-photo" />
            ) : (
              <p className="muted">Sin foto (o no autorizado).</p>
            )}
          </div>

          <div className="card gp-card-14">
            <h3 className="gp-h3-top0">Panel derecho</h3>
            <p className="muted">Acá va historial, documentos, acciones, etc.</p>
          </div>
        </div>
        </div>

        <div className="gp-bottomstack">
          {(["consultas", "pedidos", "documentos"] as ModuleKey[])
            .filter((k) => modules[k].open)
            .map((k) => {
              const st = modules[k];
              const moduleTitle = getModuleTitle(k);
              const moduleCols = getModuleCols(k, st.rows);
              const selectedRow = getSelectedRow(k);
              // Performance: paginamos render de la tabla (export sigue usando st.rows completo)
              const pageSize = st.tablePageSize || 50;
              const totalPages = Math.max(1, Math.ceil(st.rows.length / pageSize));
              const curPage = Math.min(Math.max(st.tablePage || 1, 1), totalPages);
              const start = (curPage - 1) * pageSize;
              const pageRows = st.rows.slice(start, start + pageSize);

              return (
                <div key={k} className="card gp-card-14 gp-module-stack-card">
                            <div className="sep" />

                            <div className="row gp-row-between-wrap">
                              {renderExportActions(k)}
                              <div className="row gp-row-wrap">
                                <div className="badge">{st.loading ? "Cargando…" : `Filas: ${st.rows.length}`}</div>
                                {st.scanned ? (
                                  <div className="badge">
                                    Scan: {st.scanned.pages}/{st.scanned.totalPages} pág (total API {st.scanned.total})
                                  </div>
                                ) : null}
                                <button className="btn" type="button" onClick={() => closeModule(k)}>
                                  Cerrar
                                </button>
                              </div>
                            </div>

                            <div className="gp-module-body">
                              {/* Panel navegación (izquierda) */}
                              <div className="gp-nav">
                                <div className="row gp-row-between-center">
                                  <b>{moduleTitle}</b>
                                  <span className="badge">Navegación</span>
                                </div>

                                <div className="gp-nav-list" role="list">
                                  {st.rows.map((r, idx) => {
                                    const isActive = idx === st.selectedIndex;
                                    const label = k === "consultas"
                                      ? `${r?.id ?? idx + 1}. ${String(r?.motivo_consulta ?? "(sin motivo)").slice(0, 48)}`
                                      : k === 'documentos'
                                        ? `${r?.id ?? idx + 1}. ${String(r?.nombre ?? r?.nombre_archivo_original ?? "(sin nombre)").slice(0, 48)}`
                                        : `${r?.id ?? idx + 1}. ${String(r?.estado ?? "(sin estado)").slice(0, 48)}`;
                                    return (
                                      <button
                                        key={`${r?.id ?? idx}`}
                                        type="button"
                                        className={`gp-nav-item ${isActive ? "is-active" : ""}`}
                                        onClick={() =>
                                          setModules((prev) => ({
                                            ...prev,
                                            [k]: { ...prev[k], selectedIndex: idx },
                                          }))
                                        }
                                      >
                                        {label}
                                      </button>
                                    );
                                  })}
                                  {!st.rows.length && !st.loading ? (
                                    <div className="muted gp-mt-10">Sin registros para este DNI.</div>
                                  ) : null}
                                </div>
                              </div>

                              {/* Detalle (derecha) */}
                              <div className="gp-detail">
                                <div className="row gp-row-between-center">
                                  <b>Detalle</b>
                                  <span className="badge">Fila {st.rows.length ? st.selectedIndex + 1 : 0}</span>
                                </div>

                                {!selectedRow ? (
                                  <p className="muted gp-mt-10">Seleccioná un registro a la izquierda.</p>
                                ) : k === "consultas" ? (
                                  <div className="gp-detail-grid">
                                    {/* requisito: Motivo arriba de Explicación */}
                                    <div className="gp-field">
                                      <div className="gp-field-label">Motivo</div>
                                      <div className="gp-field-value">{String(selectedRow?.motivo_consulta ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Explicación</div>
                                      <div className="gp-field-value">{String(selectedRow?.explicacion ?? "-")}</div>
                                    </div>

                                    <div className="gp-field">
                                      <div className="gp-field-label">Atendido por</div>
                                      <div className="gp-field-value">{String(selectedRow?.atendido_por ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Hora atención</div>
                                      <div className="gp-field-value">{String(selectedRow?.hora_atencion ?? "-")}</div>
                                    </div>
                                  </div>
                                ) : k === 'documentos' ? (
                                  <div className="gp-detail-grid">
                                    <div className="gp-field">
                                      <div className="gp-field-label">Nombre</div>
                                      <div className="gp-field-value">{String(selectedRow?.nombre ?? selectedRow?.nombre_archivo_original ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Tipo</div>
                                      <div className="gp-field-value">{String(selectedRow?.tipo ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Número</div>
                                      <div className="gp-field-value">{String(selectedRow?.numero ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Fecha</div>
                                      <div className="gp-field-value">{String(selectedRow?.fecha ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Descripción</div>
                                      <div className="gp-field-value">{String(selectedRow?.descripcion_archivo ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Ruta</div>
                                      <div className="gp-field-value">
                                        <div className="row gp-row-wrap">
                                          <span className="badge" title={String(selectedRow?.ruta ?? '')}>{String(selectedRow?.ruta ?? "-")}</span>
                                          <button
                                            className="btn"
                                            type="button"
                                            onClick={() => openDocViewer(String(selectedRow?.ruta ?? ''), selectedRow)}
                                            disabled={!selectedRow?.ruta}
                                          >
                                            Abrir
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="gp-detail-grid">
                                    <div className="gp-field">
                                      <div className="gp-field-label">Estado</div>
                                      <div className="gp-field-value">{String(selectedRow?.estado ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Lugar</div>
                                      <div className="gp-field-value">{String(selectedRow?.lugar ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Fecha</div>
                                      <div className="gp-field-value">{String(selectedRow?.fecha ?? "-")}</div>
                                    </div>
                                    <div className="gp-field">
                                      <div className="gp-field-label">Observación</div>
                                      <div className="gp-field-value">{String(selectedRow?.observacion ?? "-")}</div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="sep" />

                            {/* =========================
                               PEDIDOS: acciones rápidas
                               - Ver primero (lista y detalle)
                               - Cargar pedido (modal)
                               - Marcar pendiente/hecho
                               - Dar de baja + auditoría (updated_by)
                               ========================= */}
                            {k === 'pedidos' ? (
                              <div className="row gp-pedidos-actions">
                                <div className="row gp-row-wrap">
                                  <button className="btn" type="button" onClick={openPedidoModal}>
                                    Cargar pedido
                                  </button>
                                  <button className="btn" type="button" onClick={() => marcarPedidoEstado('pendiente')} disabled={!st.rows.length}>
                                    Pendiente
                                  </button>
                                  <button className="btn" type="button" onClick={() => marcarPedidoEstado('hecho')} disabled={!st.rows.length}>
                                    Hecho
                                  </button>
                                </div>
                                <div className="row gp-row-wrap">
                                  <button className="btn danger" type="button" onClick={bajaPedidoSelected} disabled={!st.rows.length}>
                                    Dar de baja
                                  </button>
                                </div>
                              </div>
                            ) : null}

                            {/* Controles de paginado (solo UI, no toca API) */}
                            <div className="row gp-row-between-wrap gp-table-pager">
                              <div className="row gp-row-wrap">
                                <span className="badge">Página {curPage}/{totalPages}</span>
                                <span className="badge">Mostrando {st.rows.length ? `${start + 1}-${Math.min(start + pageSize, st.rows.length)}` : '0'} de {st.rows.length}</span>
                              </div>
                              <div className="row gp-row-wrap">
                                <label className="muted gp-pager-label">
                                  Filas
                                  <select
                                    className="input gp-pager-select"
                                    value={pageSize}
                                    onChange={(e) => {
                                      const v = Number(e.target.value) || 50;
                                      setModules((prev) => ({
                                        ...prev,
                                        [k]: { ...prev[k], tablePageSize: v, tablePage: 1 },
                                      }));
                                    }}
                                  >
                                    {[25, 50, 100, 200].map((n) => (
                                      <option key={n} value={n}>
                                        {n}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <button
                                  className="btn"
                                  type="button"
                                  disabled={curPage <= 1}
                                  onClick={() =>
                                    setModules((prev) => ({
                                      ...prev,
                                      [k]: { ...prev[k], tablePage: Math.max(1, (prev[k].tablePage || 1) - 1) },
                                    }))
                                  }
                                >
                                  ◀
                                </button>
                                <button
                                  className="btn"
                                  type="button"
                                  disabled={curPage >= totalPages}
                                  onClick={() =>
                                    setModules((prev) => ({
                                      ...prev,
                                      [k]: { ...prev[k], tablePage: Math.min(totalPages, (prev[k].tablePage || 1) + 1) },
                                    }))
                                  }
                                >
                                  ▶
                                </button>
                              </div>
                            </div>

                            {/* Tabla completa (sigue existiendo para exportar y para ver todo de una) */}
                            <div className="gp-tablewrap">
                              <table className="table">
                                <thead>
                                  <tr>
                                    {moduleCols.map((c) => (
                                      <th key={c}>{c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {pageRows.map((r, idxLocal) => {
                                    const idx = start + idxLocal;
                                    return (
                                    <tr key={idx} className={idx === st.selectedIndex ? "gp-row-active" : ""}>
                                      {moduleCols.map((c) => (
                                        <td
                                          key={c}
                                          className="cell"
                                          title="Click para ampliar"
                                          onClick={() => {
                                            setModules((prev) => ({
                                              ...prev,
                                              [k]: { ...prev[k], selectedIndex: idx },
                                            }));
                                            setCellModal({ module: k, col: c, value: String(r?.[c] ?? ""), rowIndex: idx });
                                          }}
                                          onDoubleClick={() => {
                                            // 📎 Atajo UX: doble click en "ruta" abre visor de documentos
                                            if (k === 'documentos' && c === 'ruta') {
                                              openDocViewer(String(r?.[c] ?? ''), r);
                                            }
                                          }}
                                        >
                                          {String(r?.[c] ?? "")}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            <div className="row gp-row-between-gap10 gp-accordion-foot">
                              <div>
                                <div className="row gp-row-baseline-gap10">
                                  <h3 className="gp-h3-0">{moduleTitle}</h3>
                                  <span className="badge">Exportación</span>
                                </div>
                                <p className="muted gp-mt-6">
                                  Tip: click en una celda abre el emergente. Para navegar rápido, usá la lista de la izquierda.
                                </p>
                              </div>
                              {renderExportActions(k)}
                            </div>
                </div>
              );
            })}
        </div>
      </div>

      {cellModal ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={() => setCellModal(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row gp-modal-head">
              <div>
                <div className="muted gp-muted-xs">Fila {cellModal.rowIndex + 1}</div>
                <h3 className="gp-h3-0">{cellModal.col}</h3>
              </div>
              <button className="btn" type="button" onClick={() => setCellModal(null)}>
                Cerrar
              </button>
            </div>

            <div className="sep" />

            <textarea className="textarea" readOnly value={cellModal.value} />

            <div className="row gp-modal-actions">
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(cellModal.value);
                    toast.ok("Copiado", "Se copió el contenido al portapapeles");
                  } catch {
                    toast.error("No se pudo copiar", "El navegador no permitió copiar.");
                  }
                }}
              >
                Copiar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pedidoModal.open ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={closePedidoModal}>
          <div className="modal gp-pedido-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row gp-modal-head">
              <div>
                <div className="muted gp-muted-xs">Pedidos · DNI {cleanDni}</div>
                <h3 className="gp-h3-0">Cargar pedido</h3>
              </div>
              <div className="row gp-row-wrap">
                <button className="btn" type="button" onClick={closePedidoModal} disabled={pedidoModal.saving}>
                  Cerrar
                </button>
              </div>
            </div>

            <div className="sep" />

            <div className="gp-pedido-form">
              <div className="row gp-row-between-wrap gp-pedido-form-row">
                <label className="gp-pedido-field">
                  <div className="muted">Lugar</div>
                  <input
                    className="input"
                    value={pedidoModal.lugar}
                    onChange={(e) => setPedidoModal((p) => ({ ...p, lugar: e.target.value }))}
                    placeholder="Ej: RRHH / Mesa de entradas"
                  />
                </label>

                <label className="gp-pedido-field">
                  <div className="muted">Estado inicial</div>
                  <select
                    className="input"
                    value={pedidoModal.estado}
                    onChange={(e) => setPedidoModal((p) => ({ ...p, estado: (e.target.value as any) }))}
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="hecho">Hecho</option>
                  </select>
                </label>
              </div>

              <div className="sep" />

              <div className="gp-pedido-types">
                <div className="row gp-row-between-center">
                  <b>Tipos de pedido</b>
                  <span className="badge">Tildá uno o varios</span>
                </div>

                <div className="gp-pedido-checkgrid">
                  {Object.keys(pedidoModal.tipos).map((k) => (
                    <label key={k} className="gp-check">
                      <input
                        type="checkbox"
                        checked={!!pedidoModal.tipos[k]}
                        onChange={(e) =>
                          setPedidoModal((p) => ({
                            ...p,
                            tipos: { ...p.tipos, [k]: e.target.checked },
                          }))
                        }
                      />
                      <span>{k}</span>
                    </label>
                  ))}
                </div>

                <label className="gp-pedido-custom">
                  <div className="muted">Características (opcional)</div>
                  <input
                    className="input"
                    value={pedidoModal.caracteristicas}
                    onChange={(e) => setPedidoModal((p) => ({ ...p, caracteristicas: e.target.value }))}
                    placeholder="Ej: con sello, con funciones, periodo 2020-2024…"
                  />
                </label>

                <label className="gp-pedido-custom">
                  <div className="muted">Otro (opcional)</div>
                  <input
                    className="input"
                    value={pedidoModal.custom}
                    onChange={(e) => setPedidoModal((p) => ({ ...p, custom: e.target.value }))}
                    placeholder="Escribí un tipo personalizado"
                  />
                </label>
              </div>
</div>

              <div className="row gp-row-between-wrap gp-pedido-actions">
                <div className="muted">Se guarda con usuario: <span className="badge">{getActor()}</span></div>
                <div className="row gp-row-wrap">
                  <button className="btn" type="button" onClick={() => setPedidoModal((p) => ({ ...p, open: false }))} disabled={pedidoModal.saving}>
                    Cancelar
                  </button>
                  <button className="btn primary" type="button" onClick={createPedidosFromModal} disabled={pedidoModal.saving}>
                    {pedidoModal.saving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {docViewer.open ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={closeDocViewer}>
          <div className="modal gp-doc-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row gp-modal-head">
              <div>
                <div className="muted gp-muted-xs">Documentos · DNI {cleanDni}</div>
                <h3 className="gp-h3-0">{docViewer.meta?.filename || 'Archivo'}</h3>
              </div>
              <div className="row gp-row-wrap">
                {docViewer.objectUrl ? (
                  <>
                    <a className="btn" href={docViewer.objectUrl} download={docViewer.meta?.filename || undefined}>Descargar</a>
                    <button className="btn" type="button" onClick={() => window.open(docViewer.objectUrl as string, '_blank')}>Abrir</button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        // Imprimir: para PDF/IMG funciona muy bien con una ventana nueva.
                        if (!docViewer.objectUrl) return;
                        const w = window.open(docViewer.objectUrl, '_blank');
                        if (!w) return;
                        const t = setInterval(() => {
                          try {
                            if (w.document?.readyState === 'complete') {
                              clearInterval(t);
                              w.focus();
                              w.print();
                            }
                          } catch {
                            /* noop */
                          }
                        }, 250);
                      }}
                    >
                      Imprimir
                    </button>
                  </>
                ) : null}
                <button className="btn" type="button" onClick={closeDocViewer}>Cerrar</button>
              </div>
            </div>

            <div className="sep" />

            {docViewer.loading ? (
              <div className="muted">Cargando archivo…</div>
            ) : docViewer.error ? (
              <div>
                <div className="badge">Error</div>
                <p className="muted">{docViewer.error}</p>
                <p className="muted">Ruta: {docViewer.route}</p>
              </div>
            ) : docViewer.objectUrl ? (
              <GestionDocumentPreview url={docViewer.objectUrl} meta={docViewer.meta} />
            ) : (
              <div className="muted">Sin archivo.</div>
            )}
          </div>
        </div>
      ) : null}
      </>
    </Layout>
  );
}

function GestionDocumentPreview({ url, meta }: { url: string; meta: { contentType: string; filename: string | null } | null }) {
  const ct = (meta?.contentType || '').toLowerCase();
  const name = (meta?.filename || '').toLowerCase();

  // PDF
  if (ct.includes('pdf') || name.endsWith('.pdf')) {
    return <iframe title="pdf" src={url} className="gp-doc-iframe" />;
  }

  // Imágenes
  if (ct.startsWith('image/') || name.match(/\.(png|jpe?g|webp|gif)$/)) {
    return (
      <div className="gp-doc-imgwrap">
        <img className="gp-doc-img" src={url} alt={meta?.filename || 'archivo'} />
      </div>
    );
  }

  // Texto
  if (ct.startsWith('text/') || name.match(/\.(txt|csv|log)$/)) {
    return <iframe title="text" src={url} className="gp-doc-iframe" />;
  }

  // Word/Excel/otros: preview limitada.
  return (
    <div className="gp-doc-generic">
      <div className="badge">Sin visor embebido</div>
      <p className="muted gp-mt-10">Descargalo y abrilo con tu aplicación (Word/Excel u otro).</p>
    </div>
  );
}

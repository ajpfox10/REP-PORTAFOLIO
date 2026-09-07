import { FormEvent, useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { apiFetch } from "../api/http";
import { useAuth } from "../auth/AuthProvider";

type HcRow = {
  id: number;
  dni: string;
  apellido_nombre: string;
  fecha_ultimo_movimiento: string;
  caja: string | null;
  comentarios: string | null;
  anios_sin_movimiento: number;
  criterio_anios: number | null;
};

type PedidoRow = {
  id: number;
  dni: string;
  apellido_nombre: string;
  fecha_ultimo_movimiento: string | null;
  comentarios: string | null;
  fecha_pedido: string;
  resuelto: number;
  fecha_resuelto: string | null;
  solicitado_por_usuario: string | null;
};

type PoolHcRow = {
  id: number;
  pedido_id: number | null;
  dni: string;
  apellido_nombre: string;
  fecha_ultimo_movimiento: string;
  anio_movimiento: number;
  caja: string | null;
  comentarios: string | null;
  fecha_carga: string;
  etiqueta_impresa: number;
  fecha_impresion: string | null;
  cargado_por_usuario: string | null;
  impreso_por_usuario: string | null;
  solicitado_por_usuario: string | null;
};

type HcConfig = {
  menor: number;
  mayor: number;
  etiqueta: {
    ancho_mm: number;
    alto_mm: number;
    fuente_pt: number;
  };
};

type Toast = {
  type: "success" | "error";
  title: string;
  detail: string;
};

type ProcessForm = {
  fecha_ultimo_movimiento: string;
  comentarios: string;
};

type PoolForm = {
  dni: string;
  apellido_nombre: string;
  fecha_ultimo_movimiento: string;
  caja: string;
  comentarios: string;
};

type SearchResult = {
  exists: boolean;
  data: PoolHcRow | null;
};

type CajaResult = {
  caja: string;
  total: number;
  data: PoolHcRow[];
};

const emptyHc = {
  dni: "",
  apellido_nombre: "",
  fecha_ultimo_movimiento: "",
  comentarios: "",
};

const emptyManualPedido = {
  dni: "",
  apellido_nombre: "",
  comentarios: "",
};

const emptySearchCreate = {
  dni: "",
  apellido_nombre: "",
  fecha_ultimo_movimiento: "",
  comentarios: "",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function yearFromDate(value: string) {
  return String(value).slice(0, 4);
}

function dateOnlyInput(value: string) {
  return String(value).slice(0, 10);
}

function BarcodeSvg({ value, heightMm }: { value: string; heightMm?: number }) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value, {
      format: "CODE128",
      displayValue: false,
      height: 42,
      margin: 0,
      width: 2,
      fontSize: 14,
    });
  }, [value]);

  return <svg ref={ref} aria-label={`Codigo de barras ${value}`} style={heightMm ? { height: `${heightMm}mm` } : undefined} />;
}

function barcodeValue(hc: Pick<PoolHcRow, "fecha_ultimo_movimiento" | "caja">) {
  return `FUM=${dateOnlyInput(hc.fecha_ultimo_movimiento)};CAJA=${hc.caja || "-"}`;
}

function cajaBarcodeValue(caja: string) {
  return `CAJA=${caja.trim()}`;
}

function extractCajaCode(value: string) {
  const raw = value.trim();
  const match = raw.match(/(?:^|;)CAJA=([^;]+)/i);
  return (match ? match[1] : raw.replace(/^CAJA=/i, "")).trim();
}

export function HistoriasClinicasPage() {
  const { hasPermission } = useAuth();
  const [historias, setHistorias] = useState<HcRow[]>([]);
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [poolHc, setPoolHc] = useState<PoolHcRow[]>([]);
  const [config, setConfig] = useState<HcConfig>({
    menor: 5,
    mayor: 10,
    etiqueta: { ancho_mm: 64, alto_mm: 36, fuente_pt: 8 },
  });
  const [newHc, setNewHc] = useState(emptyHc);
  const [manualPedido, setManualPedido] = useState(emptyManualPedido);
  const [pedidoComentarios, setPedidoComentarios] = useState<Record<number, string>>({});
  const [processForms, setProcessForms] = useState<Record<number, ProcessForm>>({});
  const [poolForms, setPoolForms] = useState<Record<number, PoolForm>>({});
  const [searchDni, setSearchDni] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchFecha, setSearchFecha] = useState("");
  const [searchCreate, setSearchCreate] = useState(emptySearchCreate);
  const [printQueue, setPrintQueue] = useState<PoolHcRow[]>([]);
  const [cajaScan, setCajaScan] = useState("");
  const [cajaResult, setCajaResult] = useState<CajaResult | null>(null);
  const [cajaPrintRows, setCajaPrintRows] = useState<PoolHcRow[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);

  const canCreate = hasPermission("hc:crear");
  const canAsk = hasPermission("hc:pedir");
  const canConfig = hasPermission("hc:configurar");
  const canResolve = hasPermission("pedidos_hc:resolver");

  const pedidosPendientes = pedidos.filter((pedido) => !pedido.resuelto);
  const etiquetasPendientes = poolHc.filter((hc) => !hc.etiqueta_impresa);
  const etiquetasAImprimir = printQueue.length ? printQueue : etiquetasPendientes;
  const labelBarcodeHeightMm = Math.max(8, Math.round(config.etiqueta.alto_mm * 0.35));

  function getErrorMessage(err: unknown, fallback: string) {
    return err instanceof Error && err.message ? err.message : fallback;
  }

  function showToast(type: Toast["type"], title: string, detail: string) {
    setToast({ type, title, detail });
  }

  function updateProcessForm(id: number, patch: Partial<ProcessForm>) {
    setProcessForms((current) => ({
      ...current,
      [id]: {
        fecha_ultimo_movimiento: current[id]?.fecha_ultimo_movimiento || "",
        comentarios: current[id]?.comentarios || "",
        ...patch,
      },
    }));
  }

  function poolFormFor(hc: PoolHcRow) {
    return poolForms[hc.id] || {
      dni: hc.dni,
      apellido_nombre: hc.apellido_nombre,
      fecha_ultimo_movimiento: dateOnlyInput(hc.fecha_ultimo_movimiento),
      caja: hc.caja || "",
      comentarios: hc.comentarios || "",
    };
  }

  function updatePoolForm(hc: PoolHcRow, patch: Partial<PoolForm>) {
    setPoolForms((current) => ({
      ...current,
      [hc.id]: {
        ...poolFormFor(hc),
        ...patch,
      },
    }));
  }

  function preparePrint(items: PoolHcRow[]) {
    setPrintQueue(items);
    window.setTimeout(() => window.print(), 50);
    window.setTimeout(() => setPrintQueue([]), 2000);
  }

  function printCajaResult() {
    if (!cajaResult?.data.length) {
      showToast("error", "Caja sin HC", "No hay historias clinicas para imprimir en esta caja.");
      return;
    }
    setCajaPrintRows(cajaResult.data);
    window.setTimeout(() => window.print(), 50);
    window.setTimeout(() => setCajaPrintRows([]), 2000);
  }

  function cajaForPrint(hc: PoolHcRow) {
    return poolFormFor(hc).caja.trim();
  }

  async function saveCajasForPrint(items: PoolHcRow[]) {
    const enriched: PoolHcRow[] = [];
    for (const hc of items) {
      const caja = cajaForPrint(hc);
      if (!caja) {
        showToast("error", "Falta caja", `Carga la caja de ${hc.apellido_nombre} antes de imprimir.`);
        return null;
      }
      enriched.push({ ...hc, caja });
    }

    await Promise.all(
      enriched
        .filter((hc) => hc.caja !== items.find((item) => item.id === hc.id)?.caja)
        .map((hc) =>
          apiFetch(`/hc/pool/${hc.id}/caja`, {
            method: "PATCH",
            body: JSON.stringify({ caja: hc.caja }),
          })
        )
    );
    setPoolHc((current) => current.map((hc) => enriched.find((item) => item.id === hc.id) || hc));
    return enriched;
  }

  async function loadData() {
    const hcRes = await apiFetch<{ ok: true; data: HcRow[]; config: HcConfig }>("/hc");
    setHistorias(hcRes.data);
    setConfig(hcRes.config);
    const pedidosRes = await apiFetch<{ ok: true; data: PedidoRow[] }>("/hc/pedidos");
    setPedidos(pedidosRes.data);
    if (canResolve) {
      const poolRes = await apiFetch<{ ok: true; data: PoolHcRow[] }>("/hc/pool");
      setPoolHc(poolRes.data);
    }
  }

  useEffect(() => {
    loadData().catch((err) => showToast("error", "No se pudo cargar HC", getErrorMessage(err, "No se pudo cargar HC")));
  }, [canResolve]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    try {
      const res = await apiFetch<{ ok: true; data: HcConfig }>("/hc/config", {
        method: "PATCH",
        body: JSON.stringify(config),
      });
      setConfig(res.data);
      showToast("success", "Criterios actualizados", "Los años sin movimiento se guardaron correctamente.");
      await loadData();
    } catch (err) {
      showToast("error", "No se pudo actualizar la configuracion", getErrorMessage(err, "Revisa los valores ingresados."));
    }
  }

  async function createHc(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/hc", { method: "POST", body: JSON.stringify(newHc) });
      setNewHc(emptyHc);
      showToast("success", "Historia clinica cargada", "La HC quedo disponible para el control del pasivo.");
      await loadData();
    } catch (err) {
      showToast("error", "No se pudo cargar la HC", getErrorMessage(err, "Revisa los datos obligatorios."));
    }
  }

  async function createPedido(hc: HcRow) {
    try {
      await apiFetch("/hc/pedidos", {
        method: "POST",
        body: JSON.stringify({ historiaClinicaId: hc.id, comentarios: pedidoComentarios[hc.id] || "" }),
      });
      setPedidoComentarios((current) => ({ ...current, [hc.id]: "" }));
      showToast("success", "Pedido generado", `Se solicito la HC de ${hc.apellido_nombre}.`);
      await loadData();
    } catch (err) {
      showToast("error", "No se pudo generar el pedido", getErrorMessage(err, "No se pudo crear el pedido."));
    }
  }

  async function createManualPedido(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/hc/pedidos/manual", {
        method: "POST",
        body: JSON.stringify(manualPedido),
      });
      setManualPedido(emptyManualPedido);
      showToast("success", "Pedido manual generado", `Se solicito la HC de ${manualPedido.apellido_nombre.trim()}.`);
      await loadData();
    } catch (err) {
      showToast("error", "No se pudo generar el pedido manual", getErrorMessage(err, "Revisa DNI y nombre."));
    }
  }

  async function searchHcByDni(event: FormEvent) {
    event.preventDefault();
    try {
      const res = await apiFetch<{ ok: true; exists: boolean; data: PoolHcRow | null }>(`/hc/pool/buscar?dni=${encodeURIComponent(searchDni.trim())}`);
      setSearchResult({ exists: res.exists, data: res.data });
      setSearchFecha(res.data ? dateOnlyInput(res.data.fecha_ultimo_movimiento) : "");
      setSearchCreate({
        dni: searchDni.trim(),
        apellido_nombre: "",
        fecha_ultimo_movimiento: "",
        comentarios: "",
      });
      showToast(res.exists ? "success" : "error", res.exists ? "HC encontrada" : "HC no encontrada", res.exists ? "Solo podes actualizar la fecha de ultimo movimiento." : "Podes cargar una HC nueva para ese DNI.");
    } catch (err) {
      showToast("error", "No se pudo buscar la HC", getErrorMessage(err, "Revisa el DNI ingresado."));
    }
  }

  async function updateSearchedFecha(event: FormEvent) {
    event.preventDefault();
    if (!searchResult?.data) return;
    try {
      await apiFetch(`/hc/pool/${searchResult.data.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fecha_ultimo_movimiento: searchFecha }),
      });
      showToast("success", "Fecha actualizada", "La etiqueta quedo pendiente para imprimir y el cambio fue auditado.");
      await loadData();
      await searchHcByDni(event);
    } catch (err) {
      showToast("error", "No se pudo actualizar la fecha", getErrorMessage(err, "Revisa la fecha ingresada."));
    }
  }

  async function createSearchedHc(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/hc/pool", {
        method: "POST",
        body: JSON.stringify(searchCreate),
      });
      showToast("success", "HC cargada", "La HC se agrego a la tabla y quedo pendiente de etiqueta.");
      await loadData();
      setSearchDni(searchCreate.dni);
      setSearchResult(null);
      setSearchCreate(emptySearchCreate);
    } catch (err) {
      showToast("error", "No se pudo cargar la HC", getErrorMessage(err, "Revisa los datos ingresados."));
    }
  }

  async function searchCaja(event: FormEvent) {
    event.preventDefault();
    const caja = extractCajaCode(cajaScan);
    if (!caja) {
      showToast("error", "Codigo invalido", "Escanea una etiqueta de caja o ingresa el numero de caja.");
      return;
    }
    try {
      const res = await apiFetch<CajaResult & { ok: true }>(`/hc/cajas/buscar?codigo=${encodeURIComponent(cajaScan.trim())}`);
      setCajaResult({ caja: res.caja, total: res.total, data: res.data });
      showToast(res.total ? "success" : "error", res.total ? "Caja encontrada" : "Caja sin HC", res.total ? `${res.total} HC asignadas a ${res.caja}.` : `No hay HC asignadas a ${res.caja}.`);
    } catch (err) {
      showToast("error", "No se pudo buscar la caja", getErrorMessage(err, "Revisa el codigo escaneado."));
    }
  }

  async function processPedido(event: FormEvent, pedido: PedidoRow) {
    event.preventDefault();
    const form = processForms[pedido.id];
    try {
      await apiFetch(`/hc/pedidos/${pedido.id}/procesar`, {
        method: "PATCH",
        body: JSON.stringify({
          fecha_ultimo_movimiento: form?.fecha_ultimo_movimiento || "",
          comentarios: form?.comentarios || "",
        }),
      });
      setProcessForms((current) => ({ ...current, [pedido.id]: { fecha_ultimo_movimiento: "", comentarios: "" } }));
      showToast("success", "Pedido resuelto", "La HC se cargo o actualizo en la tabla HC y el pedido cambio de estado.");
      await loadData();
    } catch (err) {
      showToast("error", "No se pudo resolver el pedido", getErrorMessage(err, "Carga la fecha de ultimo movimiento."));
    }
  }

  async function updatePoolHc(event: FormEvent, hc: PoolHcRow) {
    event.preventDefault();
    const form = poolFormFor(hc);
    try {
      await apiFetch(`/hc/pool/${hc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fecha_ultimo_movimiento: form.fecha_ultimo_movimiento }),
      });
      setPoolForms((current) => {
        const next = { ...current };
        delete next[hc.id];
        return next;
      });
      showToast("success", "Fecha actualizada", "El cambio quedo registrado en auditoria con tu usuario.");
      await loadData();
    } catch (err) {
      showToast("error", "No se pudo actualizar la HC", getErrorMessage(err, "Revisa los datos modificados."));
    }
  }

  async function toggleEtiquetaImpresa(hc: PoolHcRow) {
    const impresa = !Boolean(hc.etiqueta_impresa);
    try {
      if (impresa) {
        const items = await saveCajasForPrint([hc]);
        if (!items) return;
      }
      await apiFetch(`/hc/pool/${hc.id}/etiqueta`, {
        method: "PATCH",
        body: JSON.stringify({ impresa }),
      });
      showToast(
        "success",
        impresa ? "Etiqueta marcada como impresa" : "Etiqueta vuelta a pendiente",
        impresa ? "La HC ya no aparece como pendiente de impresion." : "La HC vuelve al listado de etiquetas sin imprimir."
      );
      await loadData();
    } catch (err) {
      showToast("error", "No se pudo actualizar la etiqueta", getErrorMessage(err, "No se pudo cambiar el estado de impresion."));
    }
  }

  async function printPendingLabels() {
    if (!etiquetasPendientes.length) {
      showToast("error", "Sin etiquetas pendientes", "No hay HC de la tabla pendientes de impresion.");
      return;
    }
    const items = await saveCajasForPrint(etiquetasPendientes);
    if (!items) return;
    preparePrint(items);
    showToast("success", "Impresion enviada", "Se guardo la caja. Marca como impresas solamente las etiquetas que salieron bien.");
    await loadData();
  }

  async function printSingleLabel(hc: PoolHcRow) {
    const items = await saveCajasForPrint([hc]);
    if (!items) return;
    preparePrint(items);
    showToast("success", "Etiqueta enviada", `Se guardo la caja y se envio la etiqueta de ${hc.dni}.`);
    await loadData();
  }

  return (
    <section className="page-content">
      {toast && (
        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          <div className={`app-toast ${toast.type}`} role="status">
            <div>
              <strong>{toast.title}</strong>
              <span>{toast.detail}</span>
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="Cerrar notificacion">x</button>
          </div>
        </div>
      )}

      <div className="page-title">
        <div>
          <h1>Historias clinicas</h1>
          <p>Legales genera pedidos. Archivo resuelve el pedido, carga o actualiza la tabla HC y controla la impresion de etiquetas.</p>
        </div>
      </div>

      <div className="summary-grid">
        <article className="summary-card"><span>Pedidos pendientes</span><strong>{pedidosPendientes.length}</strong><p>Sin resolver por Archivo.</p></article>
        <article className="summary-card"><span>Criterio menor</span><strong>{config.menor} años</strong><p>Sin movimiento.</p></article>
        <article className="summary-card"><span>Etiquetas sin imprimir</span><strong>{etiquetasPendientes.length}</strong><p>HC de la tabla sin imprimir.</p></article>
      </div>

      {canConfig && (
        <form className="panel hc-config" onSubmit={saveConfig}>
          <div className="panel-head"><h2>Criterios configurables</h2><span>Administracion</span></div>
          <label className="form-field">Años sin movimiento menor
            <input type="number" value={config.menor} onChange={(event) => setConfig({ ...config, menor: Number(event.target.value) })} />
          </label>
          <label className="form-field">Años sin movimiento mayor
            <input type="number" value={config.mayor} onChange={(event) => setConfig({ ...config, mayor: Number(event.target.value) })} />
          </label>
          <button className="primary-btn" type="submit">Guardar criterios</button>
        </form>
      )}

      {canAsk && (
        <form className="panel manual-pedido-panel" onSubmit={createManualPedido}>
          <div className="panel-head"><h2>Cargar pedido manual de HC</h2><span>Legales</span></div>
          <label className="form-field">DNI
            <input value={manualPedido.dni} onChange={(event) => setManualPedido({ ...manualPedido, dni: event.target.value })} />
          </label>
          <label className="form-field">Apellido y nombre
            <input value={manualPedido.apellido_nombre} onChange={(event) => setManualPedido({ ...manualPedido, apellido_nombre: event.target.value })} />
          </label>
          <label className="form-field">Comentarios
            <input value={manualPedido.comentarios} onChange={(event) => setManualPedido({ ...manualPedido, comentarios: event.target.value })} />
          </label>
          <button className="primary-btn" type="submit">Crear pedido manual</button>
        </form>
      )}

      {canResolve && (
        <div className="panel pedidos-panel hc-search-panel">
          <div className="panel-head"><h2>Buscar HC por DNI</h2><span>Archivo</span></div>
          <form className="hc-search-form" onSubmit={searchHcByDni}>
            <label className="form-field">DNI
              <input value={searchDni} onChange={(event) => setSearchDni(event.target.value)} />
            </label>
            <button className="primary-btn" type="submit">Buscar</button>
          </form>

          {searchResult?.exists && searchResult.data && (
            <form className="hc-search-result" onSubmit={updateSearchedFecha}>
              <div>
                <strong>{searchResult.data.apellido_nombre}</strong>
                <span>DNI {searchResult.data.dni}</span>
                <span>Fecha actual: {formatDate(searchResult.data.fecha_ultimo_movimiento)}</span>
                <span>Caja: {searchResult.data.caja || "-"}</span>
              </div>
              <label className="form-field">Nueva fecha ultimo movimiento
                <input type="date" value={searchFecha} onChange={(event) => setSearchFecha(event.target.value)} />
              </label>
              <button className="primary-btn" type="submit">Actualizar fecha</button>
            </form>
          )}

          {searchResult && !searchResult.exists && (
            <form className="hc-search-create" onSubmit={createSearchedHc}>
              <label className="form-field">DNI
                <input value={searchCreate.dni} onChange={(event) => setSearchCreate({ ...searchCreate, dni: event.target.value })} />
              </label>
              <label className="form-field">Apellido y nombre
                <input value={searchCreate.apellido_nombre} onChange={(event) => setSearchCreate({ ...searchCreate, apellido_nombre: event.target.value })} />
              </label>
              <label className="form-field">Fecha ultimo movimiento
                <input type="date" value={searchCreate.fecha_ultimo_movimiento} onChange={(event) => setSearchCreate({ ...searchCreate, fecha_ultimo_movimiento: event.target.value })} />
              </label>
              <label className="form-field">Comentarios
                <input value={searchCreate.comentarios} onChange={(event) => setSearchCreate({ ...searchCreate, comentarios: event.target.value })} />
              </label>
              <button className="primary-btn" type="submit">Cargar HC</button>
            </form>
          )}
        </div>
      )}

      {canResolve && (
        <div className="panel pedidos-panel caja-scan-panel">
          <div className="panel-head"><h2>Escanear caja</h2><span>{cajaResult ? `${cajaResult.total} HC` : "Archivo"}</span></div>
          <form className="caja-scan-form" onSubmit={searchCaja}>
            <label className="form-field">Codigo de caja
              <input
                value={cajaScan}
                placeholder="CAJA=123"
                onChange={(event) => setCajaScan(event.target.value)}
              />
            </label>
            <button className="primary-btn" type="submit">Buscar caja</button>
          </form>

          {cajaResult && (
            <div className="caja-result">
              <div className="caja-result-head">
                <div>
                  <strong>Caja {cajaResult.caja}</strong>
                  <span>{cajaResult.total} historias clinicas asignadas</span>
                </div>
                <div className="caja-barcode">
                  <BarcodeSvg value={cajaBarcodeValue(cajaResult.caja)} />
                </div>
                <button className="primary-btn" type="button" onClick={printCajaResult}>Imprimir listado</button>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>DNI</th><th>Apellido y nombre</th><th>Ultimo movimiento</th><th>Etiqueta</th></tr>
                  </thead>
                  <tbody>
                    {cajaResult.data.map((hc) => (
                      <tr key={hc.id}>
                        <td>{hc.dni}</td>
                        <td><strong>{hc.apellido_nombre}</strong><span>{hc.comentarios || ""}</span></td>
                        <td>{formatDate(hc.fecha_ultimo_movimiento)}</td>
                        <td>{hc.etiqueta_impresa ? "Impresa" : "Sin imprimir"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="panel pedidos-panel">
        <div className="panel-head"><h2>Pedidos de Legales</h2><span>{pedidos.length} registros</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>DNI</th><th>Apellido y nombre</th><th>Pedido</th><th>Estado</th><th>Archivo</th></tr>
            </thead>
            <tbody>
              {pedidos.map((pedido) => (
                <tr key={pedido.id}>
                  <td>{pedido.dni}</td>
                  <td><strong>{pedido.apellido_nombre}</strong><span>{pedido.comentarios || ""}</span></td>
                  <td><strong>{new Date(pedido.fecha_pedido).toLocaleString()}</strong><span>{pedido.solicitado_por_usuario || "-"}</span></td>
                  <td>
                    <span className={pedido.resuelto ? "status-pill ok" : "status-pill wait"}>
                      {pedido.resuelto ? `Resuelto ${formatDate(pedido.fecha_resuelto)}` : "Pendiente"}
                    </span>
                    <span>Ultimo mov.: {formatDate(pedido.fecha_ultimo_movimiento)}</span>
                  </td>
                  <td>
                    {canResolve && !pedido.resuelto ? (
                      <form className="process-pedido" onSubmit={(event) => processPedido(event, pedido)}>
                        <input
                          type="date"
                          value={processForms[pedido.id]?.fecha_ultimo_movimiento || ""}
                          onChange={(event) => updateProcessForm(pedido.id, { fecha_ultimo_movimiento: event.target.value })}
                        />
                        <input
                          placeholder="Comentario Archivo"
                          value={processForms[pedido.id]?.comentarios || ""}
                          onChange={(event) => updateProcessForm(pedido.id, { comentarios: event.target.value })}
                        />
                        <button type="submit">Resolver y guardar HC</button>
                      </form>
                    ) : (
                      <span>{pedido.resuelto ? "Guardado en HC" : "Sin accion"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canResolve && (
        <div className="panel pedidos-panel pool-panel">
          <div className="panel-head">
            <h2>Etiquetas a imprimir</h2>
            <button className="primary-btn" type="button" onClick={printPendingLabels}>Imprimir pendientes</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>DNI</th><th>Apellido y nombre</th><th>Ultimo movimiento</th><th>Actualizar fecha</th><th>Caja</th><th>Etiqueta</th><th>Impresion</th></tr>
              </thead>
              <tbody>
                {poolHc.map((hc) => {
                  const form = poolFormFor(hc);
                  return (
                    <tr key={hc.id}>
                      <td>{hc.dni}</td>
                      <td><strong>{hc.apellido_nombre}</strong><span>{hc.comentarios || ""}</span></td>
                      <td><strong>{formatDate(hc.fecha_ultimo_movimiento)}</strong><span>Año {yearFromDate(hc.fecha_ultimo_movimiento)}</span></td>
                      <td>
                        <form className="pool-edit-form" onSubmit={(event) => updatePoolHc(event, hc)}>
                          <input type="date" value={form.fecha_ultimo_movimiento} onChange={(event) => updatePoolForm(hc, { fecha_ultimo_movimiento: event.target.value })} />
                          <button type="submit">Guardar fecha</button>
                        </form>
                      </td>
                      <td>
                        <input
                          className="pool-caja-input"
                          value={form.caja}
                          placeholder="Caja"
                          onChange={(event) => updatePoolForm(hc, { caja: event.target.value })}
                        />
                        <span>{hc.caja || "Sin caja"}</span>
                      </td>
                      <td>
                        <BarcodeSvg value={barcodeValue({ ...hc, caja: form.caja || hc.caja })} />
                        <button type="button" className="print-one-btn" onClick={() => printSingleLabel(hc)}>Imprimir esta</button>
                      </td>
                      <td>
                        <button className={hc.etiqueta_impresa ? "status-pill ok" : "status-pill wait"} onClick={() => toggleEtiquetaImpresa(hc)}>
                          {hc.etiqueta_impresa ? "Impresa" : "Sin imprimir"}
                        </button>
                        <span>{hc.etiqueta_impresa ? `Por ${hc.impreso_por_usuario || "-"} ${formatDate(hc.fecha_impresion)}` : "Pendiente de control"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div
        className="label-print-area"
        aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(auto-fill, ${config.etiqueta.ancho_mm}mm)` }}
      >
        {etiquetasAImprimir.map((hc) => (
          <article
            className="print-label"
            key={hc.id}
            style={{
              width: `${config.etiqueta.ancho_mm}mm`,
              minHeight: `${config.etiqueta.alto_mm}mm`,
              fontSize: `${config.etiqueta.fuente_pt}pt`,
            }}
          >
            <strong style={{ fontSize: `${Math.max(config.etiqueta.fuente_pt + 8, 12)}pt` }}>{yearFromDate(hc.fecha_ultimo_movimiento)}</strong>
            <BarcodeSvg value={barcodeValue(hc)} heightMm={labelBarcodeHeightMm} />
            <span>{hc.dni}</span>
            <span>{hc.apellido_nombre}</span>
            <small>Fecha ultimo movimiento: {dateOnlyInput(hc.fecha_ultimo_movimiento)}</small>
            <small>Caja: {hc.caja || "-"}</small>
          </article>
        ))}
      </div>

      <div className="caja-print-area" aria-hidden="true">
        {cajaResult && cajaPrintRows.length > 0 && (
          <section className="caja-print-sheet">
            <header>
              <div>
                <h1>Caja {cajaResult.caja}</h1>
                <p>{cajaPrintRows.length} historias clinicas asignadas</p>
              </div>
              <BarcodeSvg value={cajaBarcodeValue(cajaResult.caja)} />
            </header>
            <table>
              <thead>
                <tr><th>DNI</th><th>Apellido y nombre</th><th>Ultimo movimiento</th><th>Estado etiqueta</th></tr>
              </thead>
              <tbody>
                {cajaPrintRows.map((hc) => (
                  <tr key={hc.id}>
                    <td>{hc.dni}</td>
                    <td>{hc.apellido_nombre}</td>
                    <td>{dateOnlyInput(hc.fecha_ultimo_movimiento)}</td>
                    <td>{hc.etiqueta_impresa ? "Impresa" : "Sin imprimir"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <div className="admin-split hc-admin-zone">
        <div className="panel">
          <div className="panel-head"><h2>Historial de HC</h2><span>{historias.length} registros</span></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>DNI</th><th>Apellido y nombre</th><th>Ultimo movimiento</th><th>Caja</th><th>Criterio</th><th>Pedido</th></tr>
              </thead>
              <tbody>
                {historias.map((hc) => (
                  <tr key={hc.id}>
                    <td>{hc.dni}</td>
                    <td><strong>{hc.apellido_nombre}</strong><span>{hc.comentarios || ""}</span></td>
                    <td>{formatDate(hc.fecha_ultimo_movimiento)}</td>
                    <td>{hc.caja || "-"}</td>
                    <td>{hc.criterio_anios ? <span className="status-pill wait">{hc.criterio_anios} años</span> : <span>-</span>}</td>
                    <td>
                      <div className="inline-reset">
                        <input
                          placeholder="Comentario"
                          value={pedidoComentarios[hc.id] || ""}
                          onChange={(event) => setPedidoComentarios((current) => ({ ...current, [hc.id]: event.target.value }))}
                        />
                        <button disabled={!canAsk} onClick={() => createPedido(hc)}>Pedir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {canCreate && (
          <form className="panel form-panel" onSubmit={createHc}>
            <div className="panel-head"><h2>Cargar HC directa</h2><span>Admin</span></div>
            <label className="form-field">DNI
              <input value={newHc.dni} onChange={(event) => setNewHc({ ...newHc, dni: event.target.value })} />
            </label>
            <label className="form-field">Apellido y nombre
              <input value={newHc.apellido_nombre} onChange={(event) => setNewHc({ ...newHc, apellido_nombre: event.target.value })} />
            </label>
            <label className="form-field">Fecha ultimo movimiento
              <input type="date" value={newHc.fecha_ultimo_movimiento} onChange={(event) => setNewHc({ ...newHc, fecha_ultimo_movimiento: event.target.value })} />
            </label>
            <label className="form-field">Comentarios
              <input value={newHc.comentarios} onChange={(event) => setNewHc({ ...newHc, comentarios: event.target.value })} />
            </label>
            <button className="primary-btn" type="submit">Guardar HC</button>
          </form>
        )}
      </div>
    </section>
  );
}

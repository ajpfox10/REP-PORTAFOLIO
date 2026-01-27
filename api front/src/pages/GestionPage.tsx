import React, { useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "../components/Layout";
import { useToast } from "../ui/toast";
import { apiFetch, apiFetchBlob } from "../api/http";
import { exportToExcel, exportToPdf, exportToWord, printTable } from "../utils/export";

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
  type ModuleKey = "consultas" | "pedidos";
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null);
  const [moduleRows, setModuleRows] = useState<any[]>([]);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleScanned, setModuleScanned] = useState<{ pages: number; totalPages: number; total: number } | null>(null);
  const [cellModal, setCellModal] = useState<{ col: string; value: string; rowIndex: number } | null>(null);

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
      setActiveModule(null);
      setModuleRows([]);
      setModuleScanned(null);
      revokeLastObjectUrl();
      setFotoUrl(null);

      const agenteId = await resolveAgenteIdByDni(clean);
      const res = await apiFetch<any>(`/agentes/${agenteId}`);
      setRow(res.data);
      toast.ok("Agente cargado");
    } catch (e: any) {
      toast.error("No se pudo cargar el agente", e?.message || "Error");
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
      setActiveModule(null);
      setModuleRows([]);
      setModuleScanned(null);
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
      setActiveModule(null);
      setModuleRows([]);
      setModuleScanned(null);
      revokeLastObjectUrl();
      setFotoUrl(null);

      const agenteId = await resolveAgenteIdByDni(clean);
      const res = await apiFetch<any>(`/agentes/${agenteId}`);
      setRow(res.data);
      toast.ok("Agente cargado");
    } catch (e: any) {
      toast.error("No se pudo cargar el agente", e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  const cleanDni = useMemo(() => {
    const d = row?.dni ? String(row.dni).replace(/\D/g, "") : "";
    return d;
  }, [row?.dni]);

  async function loadModule(table: ModuleKey) {
    if (!cleanDni) return;
    if (moduleLoading && activeModule === table) return;

    setActiveModule(table);
    setModuleRows([]);
    setModuleScanned(null);

    try {
      setModuleLoading(true);

      // ✅ tu back monta /consultas y /pedidos aca
      const res = await apiFetch<any>(`/${encodeURIComponent(table)}`);
      const rows = Array.isArray(res?.data) ? res.data : [];

      // filtrado por DNI en front (porque el back trae todo)
      const acc0 = rows.filter((r: any) => String(r?.dni ?? "").replace(/\D/g, "") === cleanDni);

      // Si ya vino todo en la primera respuesta, dejamos acá
      if (!res?.meta) {
        setModuleRows(acc0);
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
        const res2 = await apiFetch<any>(`/${encodeURIComponent(table)}?page=${page}&limit=${limit}`);
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

      setModuleRows(acc);
      setModuleScanned({ pages: Math.min(page - 1, totalPages), totalPages, total });

      if (!acc.length) toast.ok("Sin resultados", `No hay ${table} para DNI ${cleanDni}`);
      else toast.ok("Listo", `${table}: ${acc.length} registro/s (fallback CRUD)`);
    } catch (e: any) {
      toast.error("No se pudo cargar módulo", e?.message || "Error");
    } finally {
      setModuleLoading(false);
    }
  }

  const moduleTitle = useMemo(() => {
    if (!activeModule) return "";
    return activeModule === "pedidos" ? "Pedidos" : "Consultas";
  }, [activeModule]);

  const moduleCols = useMemo(() => (moduleRows.length ? Object.keys(moduleRows[0]) : []), [moduleRows]);

  const exportActions = useMemo(() => {
    if (!activeModule) return null;
    const title = `${moduleTitle} (DNI ${cleanDni})`;
    const file = `${activeModule}_dni_${cleanDni}`;
    return (
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={() => printTable(title, moduleRows)} disabled={!moduleRows.length}>
          Imprimir
        </button>
        <button className="btn" type="button" onClick={() => exportToExcel(`${file}.xlsx`, moduleRows)} disabled={!moduleRows.length}>
          Excel
        </button>
        <button className="btn" type="button" onClick={() => exportToPdf(title, moduleRows)} disabled={!moduleRows.length}>
          PDF
        </button>
        <button className="btn" type="button" onClick={() => exportToWord(title, moduleRows)} disabled={!moduleRows.length}>
          Word
        </button>
      </div>
    );
  }, [activeModule, cleanDni, moduleRows, moduleTitle]);

  return (
    <Layout title="Gestión" showBack>
      <div className="gestion-layout">
        {/* IZQUIERDA */}
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 14 }}>
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

            <div style={{ marginTop: 10 }} className="muted">
              Buscá por DNI o por Apellido/Nombre. Enter y a otra cosa 😎
            </div>
          </div>

          {loading && (
            <div className="card" style={{ padding: 14 }}>
              Cargando…
            </div>
          )}

          {row && (
            <div className="card" style={{ padding: 14 }}>
              <h3 style={{ marginTop: 0 }}>
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

          {/* ✅ MÓDULOS: solo aparecen cuando YA se buscó por DNI (Enter) */}
          {row?.dni ? (
            <div className="card" style={{ padding: 14 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h3 style={{ marginTop: 0, marginBottom: 6 }}>Gestión por DNI</h3>
                  <div className="muted">Enter primero. Después habilitamos los módulos, sin humo ni duplicados.</div>
                </div>
                <div className="badge">DNI {cleanDni}</div>
              </div>

              <div className="sep" />

              <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <div className="card" style={{ padding: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <b>Consultas</b>
                    <span className="badge">/consultas</span>
                  </div>
                  <p className="muted" style={{ marginTop: 6 }}>Atenciones, motivo y explicación.</p>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <button className="btn" type="button" onClick={() => loadModule("consultas")} disabled={moduleLoading && activeModule === "consultas"}>
                      {moduleLoading && activeModule === "consultas" ? "Cargando…" : "Ver"}
                    </button>
                    {activeModule === "consultas" ? <span className="badge">Activo</span> : null}
                  </div>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <b>Pedidos</b>
                    <span className="badge">/pedidos</span>
                  </div>
                  <p className="muted" style={{ marginTop: 6 }}>Pedidos, estado, lugar y fecha.</p>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <button className="btn" type="button" onClick={() => loadModule("pedidos")} disabled={moduleLoading && activeModule === "pedidos"}>
                      {moduleLoading && activeModule === "pedidos" ? "Cargando…" : "Ver"}
                    </button>
                    {activeModule === "pedidos" ? <span className="badge">Activo</span> : null}
                  </div>
                </div>
              </div>

              {/* ✅ Tabla embebida del módulo (dentro de Gestión) */}
              {activeModule ? (
                <>
                  <div className="sep" />

                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    {exportActions}
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <div className="badge">{moduleLoading ? "Cargando…" : `Filas: ${moduleRows.length}`}</div>
                      {moduleScanned ? (
                        <div className="badge">
                          Scan: {moduleScanned.pages}/{moduleScanned.totalPages} pág (total API {moduleScanned.total})
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="sep" />

                  <div style={{ overflow: "auto", maxHeight: "55vh", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
                    <table className="table">
                      <thead>
                        <tr>
                          {moduleCols.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {moduleRows.map((r, idx) => (
                          <tr key={idx}>
                            {moduleCols.map((c) => (
                              <td
                                key={c}
                                className="cell"
                                title="Click para ampliar"
                                onClick={() => setCellModal({ col: c, value: String(r?.[c] ?? ""), rowIndex: idx })}
                              >
                                {String(r?.[c] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* ✅ Card de exportación debajo de los datos */}
                  <div className="sep" />
                  <div className="card" style={{ padding: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
                          <h3 style={{ margin: 0 }}>{moduleTitle}</h3>
                          <span className="badge">Exportación</span>
                        </div>
                        <p className="muted" style={{ marginTop: 6 }}>
                          Tip: si un campo viene largo, click en la celda y se abre el formulario emergente para leerlo completo.
                        </p>
                      </div>
                      {exportActions}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {!!matches.length && (
            <div className="card" style={{ padding: 14 }}>
              <h3 style={{ marginTop: 0 }}>Coincidencias</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {matches.map((m: any) => (
                  <li key={m.dni} style={{ margin: "8px 0" }}>
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
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>Foto credencial</h3>

            {!row?.dni ? (
              <p className="muted">Buscá un agente.</p>
            ) : fotoUrl ? (
              <img
                src={fotoUrl}
                alt="Foto credencial"
                style={{ width: "100%", borderRadius: 12, display: "block" }}
              />
            ) : (
              <p className="muted">Sin foto (o no autorizado).</p>
            )}
          </div>

          <div className="card" style={{ padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>Panel derecho</h3>
            <p className="muted">Acá va historial, documentos, acciones, etc.</p>
          </div>
        </div>
      </div>

      {cellModal ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={() => setCellModal(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Fila {cellModal.rowIndex + 1}</div>
                <h3 style={{ margin: 0 }}>{cellModal.col}</h3>
              </div>
              <button className="btn" type="button" onClick={() => setCellModal(null)}>
                Cerrar
              </button>
            </div>

            <div className="sep" />

            <textarea className="textarea" readOnly value={cellModal.value} />

            <div className="row" style={{ justifyContent: "flex-end" }}>
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
    </Layout>
  );
}

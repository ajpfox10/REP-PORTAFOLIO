// src/pages/AsistenciaPage/index.tsx
// Estadística de Asistencia — Comparador MINISTERIO vs SIAP
// Lee los Excel directo del directorio configurado en EXCEL_ASISTENCIA_DIR (.env backend)

import React, { useState, useEffect, useCallback } from "react";
import { Layout } from "../../components/Layout";
import { useToast } from "../../ui/toast";
import { apiFetch } from "../../api/http";

// ── Tipos ────────────────────────────────────────────────────────────────────
interface ArchivoInfo { name: string; size: number; modified: string; role: string; }
interface CompareRow {
  dni: string; nombre: string;
  novedad_ministerio: string; fecha_desde_ministerio: string; fecha_hasta_ministerio: string;
  novedad_siap: string; fecha_desde_siap: string; fecha_hasta_siap: string;
  estado: "COINCIDENTE" | "NO COINCIDENTE" | "OMITIDO";
}
interface CompareMeta {
  total: number; coincidentes: number; noCoincidentes: number; omitidos: number;
  ministerioRows: number; siapRows: number; ministerioFile: string; siapFile: string;
}

const NOVEDADES_OMISIBLES_DEFAULT = [
  "PRESENTE","FRANCO COMPENSATORIO","BOLETA DE SALIDA","LLEGO TARDE",
  "AUSENTE SIN AVISO","COMISION","PARO","PARO TRANSPORTE",
];

async function exportXLSX(rows: CompareRow[], meta: CompareMeta | null) {
  // SheetJS via CDN
  const XLSX = (window as any).XLSX || await new Promise<any>((resolve, reject) => {
    if ((window as any).XLSX) return resolve((window as any).XLSX);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => resolve((window as any).XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const wb = XLSX.utils.book_new();

  // Hoja principal — todos los datos
  const headers = ["DNI","NOMBRE","NOVEDAD MINISTERIO","DESDE MIN","HASTA MIN","NOVEDAD SIAP","DESDE SIAP","HASTA SIAP","ESTADO"];
  const data = rows.map(r => [
    r.dni, r.nombre, r.novedad_ministerio,
    r.fecha_desde_ministerio, r.fecha_hasta_ministerio,
    r.novedad_siap, r.fecha_desde_siap, r.fecha_hasta_siap, r.estado,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Anchos de columna
  ws["!cols"] = [
    {wch:12},{wch:30},{wch:40},{wch:12},{wch:12},{wch:35},{wch:12},{wch:12},{wch:18}
  ];

  // Hoja resumen
  const resumen = [
    ["RESUMEN DE COMPARACIÓN"],
    [],
    ["Archivo Ministerio", meta?.ministerioFile || ""],
    ["Archivo SIAP",       meta?.siapFile       || ""],
    ["Fecha de comparación", new Date().toLocaleDateString("es-AR")],
    [],
    ["Total Ministerio",  meta?.ministerioRows  || 0],
    ["Total SIAP",        meta?.siapRows        || 0],
    ["Coincidentes",      meta?.coincidentes    || 0],
    ["No coincidentes",   meta?.noCoincidentes  || 0],
    ["Omitidos",          meta?.omitidos        || 0],
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(resumen);
  wsRes["!cols"] = [{wch:25},{wch:40}];

  XLSX.utils.book_append_sheet(wb, wsRes, "Resumen");
  XLSX.utils.book_append_sheet(wb, ws, "Comparación");

  XLSX.writeFile(wb, `asistencia_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── Panel editor de mapeo ─────────────────────────────────────────────────────
function MapeoEditor({ mapeo, onChange, onSave, onReset, saving }:
  { mapeo: Record<string,string[]>; onChange: (m:Record<string,string[]>) => void;
    onSave: () => void; onReset: () => void; saving: boolean }) {

  const [newMin, setNewMin] = useState("");
  const [newSiap, setNewSiap] = useState("");

  const fs: React.CSSProperties = { width: "100%", boxSizing: "border-box" as const, fontSize: "0.82rem" };
  const lbl: React.CSSProperties = { fontSize: "0.65rem", color: "#94a3b8", marginBottom: 3 };

  const updateEquivs = (key: string, val: string) => {
    const equivs = val.split(",").map(s => s.trim()).filter(Boolean);
    onChange({ ...mapeo, [key]: equivs });
  };

  const deleteKey = (key: string) => {
    const m = { ...mapeo };
    delete m[key];
    onChange(m);
  };

  const addRow = () => {
    const k = newMin.trim();
    const v = newSiap.split(",").map(s => s.trim()).filter(Boolean);
    if (!k || !v.length) return;
    onChange({ ...mapeo, [k]: v });
    setNewMin(""); setNewSiap("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {Object.entries(mapeo).map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, alignItems: "center" }}>
            <div>
              <div style={lbl}>NOVEDAD MINISTERIO</div>
              <input className="input" value={k} readOnly style={{ ...fs, opacity: 0.7, cursor: "default" }} />
            </div>
            <div>
              <div style={lbl}>EQUIVALENTE(S) SIAP (separar con coma)</div>
              <input className="input" value={v.join(", ")} style={fs}
                onChange={e => updateEquivs(k, e.target.value)} />
            </div>
            <button className="btn" style={{ padding: "6px 10px", marginTop: 16, color: "var(--danger)", borderColor: "rgba(239,68,68,.4)" }}
              onClick={() => deleteKey(k)}>✕</button>
          </div>
        ))}
      </div>

      {/* Agregar nueva fila */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, alignItems: "end" }}>
        <div>
          <div style={lbl}>NUEVA NOVEDAD MINISTERIO</div>
          <input className="input" placeholder="ej: 08-DESCANSO ANUAL" value={newMin} style={fs}
            onChange={e => setNewMin(e.target.value)} />
        </div>
        <div>
          <div style={lbl}>EQUIVALENTE(S) SIAP</div>
          <input className="input" placeholder="ej: ANUAL, ANUAL COMPLEMENTARIA" value={newSiap} style={fs}
            onChange={e => setNewSiap(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addRow()} />
        </div>
        <button className="btn" style={{ padding: "8px 14px" }} onClick={addRow}>+ Agregar</button>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button className="btn" onClick={onReset} style={{ fontSize: "0.8rem" }}>↺ Restaurar default</button>
        <button className="btn" onClick={onSave} disabled={saving}
          style={{ background: "#2563eb", color: "#fff", borderColor: "#1d4ed8", fontSize: "0.82rem" }}>
          {saving ? "⏳ Guardando…" : "💾 Guardar mapeo"}
        </button>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export function AsistenciaPage() {
  const toast = useToast();

  // Config del servidor
  const [dirConfig, setDirConfig] = useState<{dir:string;exists:boolean;configured:boolean}|null>(null);
  const [archivos, setArchivos] = useState<ArchivoInfo[]>([]);
  const [selectedMin, setSelectedMin] = useState("");
  const [selectedSiap, setSelectedSiap] = useState("");

  // Novedades a omitir
  const [skipNovedades, setSkipNovedades] = useState<string[]>(["PRESENTE","FRANCO COMPENSATORIO","BOLETA DE SALIDA"]);
  const [customSkip, setCustomSkip] = useState("");

  // Mapeo de novedades
  const [mapeo, setMapeo] = useState<Record<string,string[]>>({});
  const [mapeoFromDisk, setMapeoFromDisk] = useState(false);
  const [showMapeo, setShowMapeo] = useState(false);
  const [savingMapeo, setSavingMapeo] = useState(false);

  // Resultados
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CompareRow[]|null>(null);
  const [meta, setMeta] = useState<CompareMeta|null>(null);
  const [direccion, setDireccion] = useState<"MIN_VS_SIAP" | "SIAP_VS_MIN">("MIN_VS_SIAP");
  const [filtroEstado, setFiltroEstado] = useState<string>("TODOS");
  const [filtroDni, setFiltroDni] = useState("");
  const [filtroNombre, setFiltroNombre] = useState("");

  // ── Cargar config + archivos + mapeo al montar ─────────────────────────────
  useEffect(() => {
    apiFetch<any>("/asistencia/config")
      .then(r => { if (r?.ok) setDirConfig(r.data); })
      .catch(() => {});
    apiFetch<any>("/asistencia/archivos")
      .then(r => {
        if (r?.ok && Array.isArray(r.data)) {
          setArchivos(r.data);
          const min = r.data.find((f:ArchivoInfo) => f.role === "MINISTERIO");
          const siap = r.data.find((f:ArchivoInfo) => f.role === "SIAP");
          if (min) setSelectedMin(min.name);
          if (siap) setSelectedSiap(siap.name);
        }
      })
      .catch(() => {});
    apiFetch<any>("/asistencia/mapeo")
      .then(r => {
        if (r?.ok) { setMapeo(r.data); setMapeoFromDisk(r.fromDisk); }
      })
      .catch(() => {});
  }, []);

  const reloadArchivos = () => {
    apiFetch<any>("/asistencia/archivos")
      .then(r => { if (r?.ok) setArchivos(r.data); })
      .catch(() => {});
  };

  const toggleSkip = (n: string) =>
    setSkipNovedades(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);

  const addCustomSkip = () => {
    const v = customSkip.trim().toUpperCase();
    if (v && !skipNovedades.includes(v)) setSkipNovedades(p => [...p, v]);
    setCustomSkip("");
  };

  const saveMapeo = async () => {
    setSavingMapeo(true);
    try {
      const r = await apiFetch<any>("/asistencia/mapeo", {
        method: "PUT", body: JSON.stringify(mapeo),
      });
      if (r?.ok) { toast.ok("Mapeo guardado"); setMapeoFromDisk(true); }
      else throw new Error(r?.error || "Error");
    } catch (e: any) { toast.error("Error al guardar mapeo", e?.message); }
    finally { setSavingMapeo(false); }
  };

  const resetMapeo = async () => {
    try {
      const r = await apiFetch<any>("/asistencia/mapeo", { method: "DELETE" });
      if (r?.ok) { setMapeo(r.data); setMapeoFromDisk(false); toast.ok("Mapeo restaurado al default"); }
    } catch (e: any) { toast.error("Error", e?.message); }
  };

  const compare = useCallback(async () => {
    setLoading(true); setResults(null); setMeta(null);
    try {
      const body: any = { skipNovedades: skipNovedades.join(","), direccion };
      if (selectedMin) body.ministerioFile = selectedMin;
      if (selectedSiap) body.siapFile = selectedSiap;
      const r = await apiFetch<any>("/asistencia/comparar", {
        method: "POST", body: JSON.stringify(body),
      });
      if (!r?.ok) throw new Error(r?.error || "Error");
      setResults(r.data); setMeta(r.meta);
      toast.ok("Comparación completa", `${r.meta.total} registros`);
    } catch (e: any) { toast.error("Error al comparar", e?.message); }
    finally { setLoading(false); }
  }, [selectedMin, selectedSiap, skipNovedades]);

  const filtered = results ? results.filter(r => {
    if (filtroEstado !== "TODOS" && r.estado !== filtroEstado) return false;
    if (filtroDni && !r.dni.includes(filtroDni)) return false;
    if (filtroNombre && !r.nombre.toLowerCase().includes(filtroNombre.toLowerCase())) return false;
    return true;
  }) : [];

  // ── Estilos ────────────────────────────────────────────────────────────────
  const fs: React.CSSProperties = { width: "100%", boxSizing: "border-box" as const, fontSize: "0.84rem" };
  const lbl: React.CSSProperties = { fontSize: "0.68rem", color: "#94a3b8", marginBottom: 3 };
  const sh: React.CSSProperties = { fontSize: "0.68rem", color: "#64748b", fontWeight: 700, letterSpacing: "0.07em", marginBottom: 8 };
  const badge: Record<string,React.CSSProperties> = {
    COINCIDENTE:    { background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.4)",  color: "#10b981", borderRadius: 8, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 600 },
    "NO COINCIDENTE": { background: "rgba(239,68,68,.15)",  border: "1px solid rgba(239,68,68,.45)", color: "#ef4444", borderRadius: 8, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 600 },
    OMITIDO:        { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)", color: "var(--muted)", borderRadius: 8, padding: "2px 10px", fontSize: "0.72rem" },
  };

  const archivosMin  = archivos.filter(a => a.role === "MINISTERIO" || a.role === "DESCONOCIDO");
  const archivosSiap = archivos.filter(a => a.role === "SIAP"       || a.role === "DESCONOCIDO");

  return (
    <Layout title="Estadística de Asistencia" showBack>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── BANNER CONFIG ── */}
        {dirConfig && (
          <div className="card" style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, fontSize: "0.82rem" }}>
            <span style={{ color: dirConfig.exists ? "var(--ok)" : "var(--danger)", fontSize: "1.1rem" }}>
              {dirConfig.exists ? "✔" : "✗"}
            </span>
            <span style={{ color: "var(--muted)" }}>
              {dirConfig.configured
                ? <><strong style={{ color: "var(--text)" }}>Carpeta configurada:</strong> {dirConfig.dir} {!dirConfig.exists && <span style={{ color: "var(--danger)" }}>(no existe)</span>}</>
                : <span style={{ color: "var(--danger)" }}>EXCEL_ASISTENCIA_DIR no está configurado en el .env del servidor</span>
              }
            </span>
            <button className="btn" style={{ marginLeft: "auto", fontSize: "0.78rem", padding: "4px 12px" }} onClick={reloadArchivos}>↺ Refrescar</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>

          {/* ── SELECCIÓN DE ARCHIVOS ── */}
          <div className="card gp-card-14" style={{ padding: 16 }}>
            <div style={sh}>— SELECCIÓN DE ARCHIVOS —</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={lbl}>ARCHIVO MINISTERIO</div>
                <select className="input" value={selectedMin} style={{ ...fs, color: "var(--text)", background: "rgba(15,23,42,0.9)" }}
                  onChange={e => setSelectedMin(e.target.value)}>
                  <option value="">— auto-detectar —</option>
                  {archivosMin.map(a => (
                    <option key={a.name} value={a.name}>{a.name} ({(a.size/1024).toFixed(0)} KB)</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={lbl}>ARCHIVO SIAP</div>
                <select className="input" value={selectedSiap} style={{ ...fs, color: "var(--text)", background: "rgba(15,23,42,0.9)" }}
                  onChange={e => setSelectedSiap(e.target.value)}>
                  <option value="">— auto-detectar —</option>
                  {archivosSiap.map(a => (
                    <option key={a.name} value={a.name}>{a.name} ({(a.size/1024).toFixed(0)} KB)</option>
                  ))}
                </select>
              </div>
              {archivos.length === 0 && dirConfig?.configured && (
                <div style={{ fontSize: "0.78rem", color: "var(--danger)" }}>
                  No hay archivos Excel en el directorio configurado.
                  Copiá los archivos y hacé clic en Refrescar.
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button className="btn" style={{ flex: 1, fontSize: "0.78rem", padding: "7px 0",
                  background: direccion === "MIN_VS_SIAP" ? "rgba(99,102,241,.25)" : "transparent",
                  borderColor: direccion === "MIN_VS_SIAP" ? "#6366f1" : "rgba(255,255,255,.15)",
                  color: direccion === "MIN_VS_SIAP" ? "#a5b4fc" : "var(--muted)" }}
                  onClick={() => setDireccion("MIN_VS_SIAP")}>
                  Ministerio → SIAP
                </button>
                <button className="btn" style={{ flex: 1, fontSize: "0.78rem", padding: "7px 0",
                  background: direccion === "SIAP_VS_MIN" ? "rgba(99,102,241,.25)" : "transparent",
                  borderColor: direccion === "SIAP_VS_MIN" ? "#6366f1" : "rgba(255,255,255,.15)",
                  color: direccion === "SIAP_VS_MIN" ? "#a5b4fc" : "var(--muted)" }}
                  onClick={() => setDireccion("SIAP_VS_MIN")}>
                  SIAP → Ministerio
                </button>
              </div>
              <button className="btn" onClick={compare} disabled={loading}
                style={{ marginTop: 4, background: "#2563eb", color: "#fff", borderColor: "#1d4ed8", fontSize: "0.9rem", padding: "9px 0" }}>
                {loading ? "⏳ Comparando…" : "🔍 Comparar"}
              </button>
            </div>
          </div>

          {/* ── NOVEDADES A OMITIR ── */}
          <div className="card gp-card-14" style={{ padding: 16 }}>
            <div style={sh}>— NOVEDADES A OMITIR (no se comparan) —</div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5, marginBottom: 10 }}>
              {NOVEDADES_OMISIBLES_DEFAULT.map(n => (
                <button key={n} onClick={() => toggleSkip(n)} style={{
                  fontSize: "0.71rem", padding: "3px 10px", borderRadius: 8, border: "1px solid", cursor: "pointer",
                  borderColor: skipNovedades.includes(n) ? "#2563eb" : "rgba(255,255,255,.18)",
                  background: skipNovedades.includes(n) ? "rgba(37,99,235,.22)" : "rgba(255,255,255,.04)",
                  color: skipNovedades.includes(n) ? "#93c5fd" : "var(--muted)",
                }}>
                  {skipNovedades.includes(n) ? "✔ " : ""}{n}
                </button>
              ))}
            </div>
            {skipNovedades.filter(s => !NOVEDADES_OMISIBLES_DEFAULT.includes(s)).map(s => (
              <span key={s} style={{ ...badge["OMITIDO"], display: "inline-flex", gap: 4, marginRight: 5, marginBottom: 4, alignItems: "center" }}>
                {s} <span style={{ cursor: "pointer" }} onClick={() => setSkipNovedades(p => p.filter(x => x !== s))}>×</span>
              </span>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input className="input" placeholder="Agregar novedad a omitir…" value={customSkip}
                style={{ ...fs, flex: 1, fontSize: "0.8rem" }}
                onChange={e => setCustomSkip(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCustomSkip()} />
              <button className="btn" onClick={addCustomSkip} style={{ fontSize: "0.8rem", padding: "6px 12px" }}>+ Agregar</button>
            </div>
          </div>
        </div>

        {/* ── EDITOR DE MAPEO ── */}
        <div className="card gp-card-14" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: showMapeo ? 12 : 0 }}>
            <div style={sh}>— MAPEO DE NOVEDADES —</div>
            <span style={{ fontSize: "0.72rem", color: mapeoFromDisk ? "var(--ok)" : "#94a3b8", marginLeft: 4 }}>
              {mapeoFromDisk ? "✔ guardado en disco" : "(usando default)"}
            </span>
            <button className="btn" style={{ marginLeft: "auto", fontSize: "0.78rem", padding: "4px 14px" }}
              onClick={() => setShowMapeo(v => !v)}>
              {showMapeo ? "▲ Cerrar" : "▼ Ver / editar mapeo"}
            </button>
          </div>
          {showMapeo && (
            <MapeoEditor mapeo={mapeo} onChange={setMapeo}
              onSave={saveMapeo} onReset={resetMapeo} saving={savingMapeo} />
          )}
          {!showMapeo && (
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {Object.keys(mapeo).length} novedades del Ministerio mapeadas a equivalentes SIAP.
              Las novedades sin mapeo aparecerán como "NO COINCIDENTE (sin mapeo)".
            </div>
          )}
        </div>

        {/* ── CONTADORES ── */}
        {meta && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
            {[
              { l: "MINISTERIO", v: meta.ministerioRows, c: "var(--muted)", sub: meta.ministerioFile },
              { l: "SIAP",       v: meta.siapRows,       c: "var(--muted)", sub: meta.siapFile },
              { l: "COINCIDENTES",    v: meta.coincidentes,   c: "var(--ok)" },
              { l: "NO COINCIDENTES", v: meta.noCoincidentes, c: "var(--danger)" },
              { l: "OMITIDOS",        v: meta.omitidos,       c: "#94a3b8" },
            ].map(({ l, v, c, sub }: any) => (
              <div key={l} className="card" style={{ padding: "12px 14px", textAlign: "center" as const }}>
                <div style={{ fontSize: "1.7rem", fontWeight: 700, color: c }}>{v}</div>
                <div style={{ fontSize: "0.63rem", color: "#64748b", letterSpacing: "0.05em" }}>{l}</div>
                {sub && <div style={{ fontSize: "0.6rem", color: "#475569", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ── TABLA DE RESULTADOS ── */}
        {results && (
          <div className="card gp-card-14" style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr auto", gap: 8, marginBottom: 12, alignItems: "end" }}>
              <div>
                <div style={lbl}>ESTADO</div>
                <select className="input" value={filtroEstado} style={{ ...fs, width: "auto", minWidth: 170, color: "var(--text)", background: "rgba(15,23,42,0.9)" }}
                  onChange={e => setFiltroEstado(e.target.value)}>
                  <option value="TODOS">Todos ({results.length})</option>
                  <option value="COINCIDENTE">✔ Coincidentes ({meta?.coincidentes})</option>
                  <option value="NO COINCIDENTE">✗ No coincidentes ({meta?.noCoincidentes})</option>
                  <option value="OMITIDO">— Omitidos ({meta?.omitidos})</option>
                </select>
              </div>
              <div>
                <div style={lbl}>DNI</div>
                <input className="input" placeholder="Filtrar por DNI…" value={filtroDni}
                  style={fs} onChange={e => setFiltroDni(e.target.value)} />
              </div>
              <div>
                <div style={lbl}>NOMBRE</div>
                <input className="input" placeholder="Filtrar por nombre…" value={filtroNombre}
                  style={fs} onChange={e => setFiltroNombre(e.target.value)} />
              </div>
              <button className="btn" disabled={filtered.length === 0} onClick={() => exportXLSX(filtered, meta)}
                style={{ padding: "9px 16px", fontSize: "0.82rem", whiteSpace: "nowrap" as const }}>
                ⬇ Exportar Excel
              </button>
            </div>

            <div style={{ overflowX: "auto" as const }}>
              <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,.12)" }}>
                    {["DNI","NOMBRE","NOVEDAD MINISTERIO","DESDE","HASTA","NOVEDAD SIAP","DESDE SIAP","HASTA SIAP","ESTADO"].map(h => (
                      <th key={h} style={{ padding: "7px 10px", textAlign: "left" as const, fontSize: "0.63rem", color: "#64748b", letterSpacing: "0.05em", fontWeight: 600, whiteSpace: "nowrap" as const }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={9} style={{ padding: 24, textAlign: "center" as const, color: "var(--muted)" }}>Sin resultados</td></tr>
                  ) : filtered.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,.05)", background: i%2===0?"transparent":"rgba(255,255,255,.02)" }}>
                      <td style={{ padding: "6px 10px", color: "var(--muted)", fontFamily: "monospace" }}>{r.dni}</td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" as const }}>{r.nombre}</td>
                      <td style={{ padding: "6px 10px", color: "#c4b5fd", fontSize: "0.74rem" }}>{r.novedad_ministerio}</td>
                      <td style={{ padding: "6px 10px", color: "var(--muted)", fontFamily: "monospace", fontSize: "0.74rem", whiteSpace: "nowrap" as const }}>{r.fecha_desde_ministerio}</td>
                      <td style={{ padding: "6px 10px", color: "var(--muted)", fontFamily: "monospace", fontSize: "0.74rem", whiteSpace: "nowrap" as const }}>{r.fecha_hasta_ministerio}</td>
                      <td style={{ padding: "6px 10px", color: "#7dd3fc", fontSize: "0.74rem" }}>{r.novedad_siap}</td>
                      <td style={{ padding: "6px 10px", color: "var(--muted)", fontFamily: "monospace", fontSize: "0.74rem", whiteSpace: "nowrap" as const }}>{r.fecha_desde_siap}</td>
                      <td style={{ padding: "6px 10px", color: "var(--muted)", fontFamily: "monospace", fontSize: "0.74rem", whiteSpace: "nowrap" as const }}>{r.fecha_hasta_siap}</td>
                      <td style={{ padding: "6px 10px" }}><span style={badge[r.estado] || {}}>{r.estado === "COINCIDENTE" ? "✔ COINCIDENTE" : r.estado === "NO COINCIDENTE" ? "✗ NO COINCIDENTE" : "— OMITIDO"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontSize: "0.72rem", color: "#64748b" }}>
              Mostrando {filtered.length} de {results.length} registros
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

// src/pages/AsistenciaPage/index.tsx
// Estadística de Asistencia — Comparador MINISTERIO vs SIAP
// Lee los Excel directo del directorio configurado en EXCEL_ASISTENCIA_DIR (.env backend)

import React, { useState, useEffect, useCallback } from "react";
import { Layout } from "../../components/Layout";
import { useToast } from "../../ui/toast";
import { apiFetch } from "../../api/http";

// ── Tipos ────────────────────────────────────────────────────────────────────
interface ArchivoInfo { name: string; fullPath?: string; size?: number; modified?: string; role?: string; }
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
interface NovedadItem { name: string; count: number; }

const NOVEDADES_OMISIBLES_DEFAULT = [
  "PRESENTE","FRANCO COMPENSATORIO","BOLETA DE SALIDA","LLEGO TARDE",
  "AUSENTE SIN AVISO","COMISION","PARO","PARO TRANSPORTE",
];

async function exportXLSX(rows: CompareRow[], meta: CompareMeta | null) {
  const XLSX = (window as any).XLSX || await new Promise<any>((resolve, reject) => {
    if ((window as any).XLSX) return resolve((window as any).XLSX);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => resolve((window as any).XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const wb = XLSX.utils.book_new();
  const headers = ["DNI","NOMBRE","NOVEDAD MINISTERIO","DESDE MIN","HASTA MIN","NOVEDAD SIAP","DESDE SIAP","HASTA SIAP","ESTADO"];
  const data = rows.map(r => [
    r.dni, r.nombre, r.novedad_ministerio,
    r.fecha_desde_ministerio, r.fecha_hasta_ministerio,
    r.novedad_siap, r.fecha_desde_siap, r.fecha_hasta_siap, r.estado,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws["!cols"] = [{wch:12},{wch:30},{wch:40},{wch:12},{wch:12},{wch:35},{wch:12},{wch:12},{wch:18}];

  const resumen = [
    ["RESUMEN DE COMPARACIÓN"],[],
    ["Archivo Ministerio", meta?.ministerioFile || ""],
    ["Archivo SIAP",       meta?.siapFile       || ""],
    ["Fecha de comparación", new Date().toLocaleDateString("es-AR")],[],
    ["Total Ministerio",  meta?.ministerioRows  || 0],
    ["Total SIAP",        meta?.siapRows        || 0],
    ["Coincidentes",      meta?.coincidentes    || 0],
    ["No coincidentes",   meta?.noCoincidentes  || 0],
    ["Omitidos",          meta?.omitidos        || 0],
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(resumen);
  wsRes["!cols"] = [{wch:25},{wch:40}];
  XLSX.utils.book_append_sheet(wb, wsRes, "Resumen");
  XLSX.utils.book_append_sheet(wb, ws, "Comparacion");
  XLSX.writeFile(wb, `asistencia_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── Panel editor de mapeo ─────────────────────────────────────────────────────
function MapeoEditor({ mapeo, onChange, onSave, onReset, saving, novedadesMin, novedadesSiap }:
  { mapeo: Record<string,string[]>; onChange: (m:Record<string,string[]>) => void;
    onSave: () => void; onReset: () => void; saving: boolean;
    novedadesMin: NovedadItem[]; novedadesSiap: NovedadItem[]; }) {

  const [newMin, setNewMin] = useState("");
  const [newSiapTags, setNewSiapTags] = useState<string[]>([]);
  const [siapInput, setSiapInput] = useState("");

  const fs: React.CSSProperties = { width: "100%", boxSizing: "border-box" as const, fontSize: "0.82rem" };
  const lbl: React.CSSProperties = { fontSize: "0.65rem", color: "#94a3b8", marginBottom: 3 };

  const minSinMapear = novedadesMin.filter(n => !Object.keys(mapeo ?? {}).includes(n.name));

  const updateEquivs = (key: string, val: string) => {
    onChange({ ...mapeo, [key]: val.split(",").map(s => s.trim()).filter(Boolean) });
  };

  const addEquivFromSelect = (key: string, current: string[], newVal: string) => {
    if (!newVal || current.includes(newVal)) return;
    onChange({ ...mapeo, [key]: [...current, newVal] });
  };

  const deleteKey = (key: string) => {
    const m = { ...mapeo }; delete m[key]; onChange(m);
  };

  const handleSiapKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = siapInput.trim();
      if (v && !newSiapTags.includes(v)) setNewSiapTags(p => [...p, v]);
      setSiapInput("");
    }
  };

  const addRow = () => {
    const k = newMin.trim();
    const extra = siapInput.trim() ? [siapInput.trim()] : [];
    const v = [...newSiapTags, ...extra].filter(Boolean);
    if (!k || !v.length) return;
    onChange({ ...mapeo, [k]: v });
    setNewMin(""); setSiapInput(""); setNewSiapTags([]);
  };

  const tagStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4,
    background: "rgba(37,99,235,.25)", border: "1px solid rgba(37,99,235,.5)",
    borderRadius: 6, padding: "2px 7px", fontSize: "0.74rem", color: "#93c5fd",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Aviso novedades sin mapear */}
      {novedadesMin.length > 0 && minSinMapear.length > 0 && (
        <div style={{ background: "rgba(234,179,8,.08)", border: "1px solid rgba(234,179,8,.25)", borderRadius: 8, padding: "8px 12px", fontSize: "0.75rem", color: "#fde68a" }}>
          ⚠ <strong>{minSinMapear.length}</strong> novedad{minSinMapear.length > 1 ? "es" : ""} del Ministerio sin mapear:{" "}
          {minSinMapear.slice(0, 5).map(n => <span key={n.name} style={{ opacity: 0.8 }}>{n.name} ({n.count}) </span>)}
          {minSinMapear.length > 5 && <span style={{ opacity: 0.6 }}>…y {minSinMapear.length - 5} más</span>}
        </div>
      )}

      {/* Filas de mapeo existentes */}
      <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(mapeo ?? {}).map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, alignItems: "start" }}>
            <div>
              <div style={lbl}>NOVEDAD MINISTERIO</div>
              <input className="input" value={k} readOnly style={{ ...fs, opacity: 0.7, cursor: "default" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={lbl}>EQUIVALENTE(S) SIAP</div>
              {novedadesSiap.length > 0 && (
                <select className="input" style={{ ...fs, color: "var(--text)", background: "rgba(15,23,42,0.9)" }}
                  value=""
                  onChange={e => addEquivFromSelect(k, v, e.target.value)}>
                  <option value="">+ agregar desde Excel…</option>
                  {novedadesSiap.filter(n => !v.includes(n.name)).map(n => (
                    <option key={n.name} value={n.name}>{n.name} ({n.count})</option>
                  ))}
                </select>
              )}
              <input className="input" value={v.join(", ")} style={fs}
                placeholder="separar con comas"
                onChange={e => updateEquivs(k, e.target.value)} />
            </div>
            <button className="btn"
              style={{ padding: "6px 10px", marginTop: novedadesSiap.length > 0 ? 44 : 18, color: "var(--danger)", borderColor: "rgba(239,68,68,.4)" }}
              onClick={() => deleteKey(k)}>✕</button>
          </div>
        ))}
      </div>

      {/* Agregar nueva fila */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: "0.67rem", color: "#64748b", fontWeight: 700, letterSpacing: "0.06em" }}>— AGREGAR NUEVA EQUIVALENCIA —</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {/* Ministerio */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={lbl}>NOVEDAD MINISTERIO</div>
            {novedadesMin.length > 0 && (
              <select className="input" style={{ ...fs, color: "var(--text)", background: "rgba(15,23,42,0.9)" }}
                value={newMin} onChange={e => setNewMin(e.target.value)}>
                <option value="">— elegir del Excel —</option>
                {minSinMapear.length > 0 && (
                  <optgroup label="Sin mapear aun">
                    {minSinMapear.map(n => <option key={n.name} value={n.name}>{n.name} ({n.count})</option>)}
                  </optgroup>
                )}
                <optgroup label="Ya mapeadas">
                  {novedadesMin.filter(n => Object.keys(mapeo ?? {}).includes(n.name)).map(n => (
                    <option key={n.name} value={n.name}>{n.name} ({n.count})</option>
                  ))}
                </optgroup>
              </select>
            )}
            <input className="input" placeholder="o escribir manualmente…" value={newMin} style={fs}
              onChange={e => setNewMin(e.target.value)} />
          </div>
          {/* SIAP */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={lbl}>EQUIVALENTE(S) SIAP</div>
            {novedadesSiap.length > 0 && (
              <select className="input" style={{ ...fs, color: "var(--text)", background: "rgba(15,23,42,0.9)" }}
                value=""
                onChange={e => { const v = e.target.value; if (v && !newSiapTags.includes(v)) setNewSiapTags(p => [...p, v]); }}>
                <option value="">— elegir del Excel —</option>
                {novedadesSiap.map(n => <option key={n.name} value={n.name}>{n.name} ({n.count})</option>)}
              </select>
            )}
            {newSiapTags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                {newSiapTags.map(t => (
                  <span key={t} style={tagStyle}>
                    {t}
                    <span style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => setNewSiapTags(p => p.filter(x => x !== t))}>×</span>
                  </span>
                ))}
              </div>
            )}
            <input className="input" placeholder="o escribir y Enter / coma" value={siapInput} style={fs}
              onChange={e => setSiapInput(e.target.value)}
              onKeyDown={handleSiapKeyDown} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" style={{ padding: "7px 16px", fontSize: "0.82rem" }} onClick={addRow}>+ Agregar fila</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 10 }}>
        <button className="btn" onClick={onReset} style={{ fontSize: "0.8rem" }}>↺ Restaurar default</button>
        <button className="btn" onClick={onSave} disabled={saving}
          style={{ background: "#2563eb", color: "#fff", borderColor: "#1d4ed8", fontSize: "0.82rem" }}>
          {saving ? "⏳ Guardando y comparando…" : "💾 Guardar y re-comparar"}
        </button>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export function AsistenciaPage() {
  const toast = useToast();

  const [dirConfig, setDirConfig] = useState<{dir:string;exists:boolean;configured:boolean}|null>(null);
  const [archivos, setArchivos] = useState<ArchivoInfo[]>([]);
  const [selectedMin, setSelectedMin] = useState("");
  const [selectedSiap, setSelectedSiap] = useState("");

  const [skipNovedades, setSkipNovedades] = useState<string[]>(["PRESENTE","FRANCO COMPENSATORIO","BOLETA DE SALIDA"]);
  const [customSkip, setCustomSkip] = useState("");

  const [mapeo, setMapeo] = useState<Record<string,string[]>>({});
  const [mapeoFromDisk, setMapeoFromDisk] = useState(false);
  const [showMapeo, setShowMapeo] = useState(false);
  const [savingMapeo, setSavingMapeo] = useState(false);

  // Novedades únicas de los Excel
  const [novedadesMin, setNovedadesMin] = useState<NovedadItem[]>([]);
  const [novedadesSiap, setNovedadesSiap] = useState<NovedadItem[]>([]);
  const [loadingNovedades, setLoadingNovedades] = useState(false);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CompareRow[]|null>(null);
  const [meta, setMeta] = useState<CompareMeta|null>(null);
  const [direccion, setDireccion] = useState<"MIN_VS_SIAP" | "SIAP_VS_MIN">("MIN_VS_SIAP");
  const [filtroEstado, setFiltroEstado] = useState<string>("TODOS");
  const [filtroDni, setFiltroDni] = useState("");
  const [filtroNombre, setFiltroNombre] = useState("");

  useEffect(() => {
    apiFetch<any>("/asistencia/config")
      .then(r => { if (r?.ok) setDirConfig(r.data); })
      .catch(() => {});
    apiFetch<any>("/asistencia/archivos")
      .then(r => {
        if (r?.ok && Array.isArray(r.files)) {
          setArchivos(r.files);
          // r.auto = { ministerio: fullPath, siap: fullPath }
          if (r.auto?.ministerio) { const n = r.auto.ministerio.split(/[\\/]/).pop(); if (n) setSelectedMin(n); }
          if (r.auto?.siap)        { const n = r.auto.siap.split(/[\\/]/).pop();        if (n) setSelectedSiap(n); }
        }
      })
      .catch(() => {});
    // GET /asistencia/mapeo devuelve { ok, mapeo } (no r.data)
    apiFetch<any>("/asistencia/mapeo")
      .then(r => {
        if (r?.ok) { setMapeo(r.mapeo ?? r.data ?? {}); setMapeoFromDisk(r.fromDisk ?? false); }
      })
      .catch(() => {});
  }, []);

  // Cargar novedades únicas de los Excel
  const loadNovedades = useCallback(async () => {
    setLoadingNovedades(true);
    try {
      const params = new URLSearchParams();
      if (selectedMin) params.set("ministerioFile", selectedMin);
      if (selectedSiap) params.set("siapFile", selectedSiap);
      const r = await apiFetch<any>(`/asistencia/novedades?${params.toString()}`);
      if (r?.ok && r.data) {
        setNovedadesMin(r.data.ministerio ?? []);
        setNovedadesSiap(r.data.siap ?? []);
      } else if (r && !r.ok) {
        toast.error("No se pudieron cargar las novedades", r.error);
      }
    } catch (e: any) { toast.error("Error cargando novedades", e?.message); }
    finally { setLoadingNovedades(false); }
  }, [selectedMin, selectedSiap]);

  const reloadArchivos = () => {
    apiFetch<any>("/asistencia/archivos")
      .then(r => { if (r?.ok && Array.isArray(r.files)) setArchivos(r.files); })
      .catch(() => {});
  };

  const toggleSkip = (n: string) =>
    setSkipNovedades(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n]);

  const addCustomSkip = () => {
    const v = customSkip.trim().toUpperCase();
    if (v && !skipNovedades.includes(v)) setSkipNovedades(p => [...p, v]);
    setCustomSkip("");
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
      // Backend devuelve { ok, data: { comparado, totals, files } }
      const comparado = r.data?.comparado ?? [];
      const totals = r.data?.totals ?? {};
      const files = r.data?.files ?? {};
      setResults(comparado);
      setMeta({
        total: comparado.length,
        coincidentes:   totals.coincidencias ?? 0,
        noCoincidentes: totals.no_coinciden  ?? 0,
        omitidos:       totals.omitidos      ?? 0,
        ministerioRows: totals.ministerio    ?? 0,
        siapRows:       totals.siap          ?? 0,
        ministerioFile: files.ministerioFile ?? "",
        siapFile:       files.siapFile       ?? "",
      });
      toast.ok("Comparacion completa", `${comparado.length} registros`);
    } catch (e: any) { toast.error("Error al comparar", e?.message); }
    finally { setLoading(false); }
  }, [selectedMin, selectedSiap, skipNovedades, direccion]);

  const saveMapeo = async () => {
    setSavingMapeo(true);
    try {
      // El backend PUT /asistencia/mapeo espera body: { mapeo: {...} }
      const r = await apiFetch<any>("/asistencia/mapeo", {
        method: "PUT", body: JSON.stringify({ mapeo }),
      });
      if (r?.ok) {
        setMapeoFromDisk(true);
        toast.ok("Mapeo guardado — re-comparando…");
        // Auto-comparar con el nuevo mapeo
        await compare();
      } else throw new Error(r?.error || "Error");
    } catch (e: any) { toast.error("Error al guardar mapeo", e?.message); }
    finally { setSavingMapeo(false); }
  };

  const resetMapeo = async () => {
    try {
      const r = await apiFetch<any>("/asistencia/mapeo", { method: "DELETE" });
      // DELETE devuelve { ok, mapeo } con el default
      if (r?.ok) {
        setMapeo(r.mapeo ?? r.data ?? {});
        setMapeoFromDisk(false);
        toast.ok("Mapeo restaurado al default");
      }
    } catch (e: any) { toast.error("Error", e?.message); }
  };

  const filtered = results ? results.filter(r => {
    if (filtroEstado !== "TODOS" && r.estado !== filtroEstado) return false;
    if (filtroDni && !String(r.dni ?? '').includes(filtroDni)) return false;
    if (filtroNombre && !String(r.nombre ?? '').toLowerCase().includes(filtroNombre.toLowerCase())) return false;
    return true;
  }) : [];

  const fs: React.CSSProperties = { width: "100%", boxSizing: "border-box" as const, fontSize: "0.84rem" };
  const lbl: React.CSSProperties = { fontSize: "0.68rem", color: "#94a3b8", marginBottom: 3 };
  const sh: React.CSSProperties = { fontSize: "0.68rem", color: "#64748b", fontWeight: 700, letterSpacing: "0.07em", marginBottom: 8 };
  const badge: Record<string,React.CSSProperties> = {
    COINCIDENTE:      { background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.4)",  color: "#10b981", borderRadius: 8, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 600 },
    "NO COINCIDENTE": { background: "rgba(239,68,68,.15)",  border: "1px solid rgba(239,68,68,.45)", color: "#ef4444", borderRadius: 8, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 600 },
    OMITIDO:          { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)", color: "var(--muted)", borderRadius: 8, padding: "2px 10px", fontSize: "0.72rem" },
  };

  const archivosMin  = archivos;
  const archivosSiap = archivos;

  return (
    <Layout title="Estadistica de Asistencia" showBack>
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
                : <span style={{ color: "var(--danger)" }}>EXCEL_ASISTENCIA_DIR no esta configurado en el .env del servidor</span>
              }
            </span>
            <button className="btn" style={{ marginLeft: "auto", fontSize: "0.78rem", padding: "4px 12px" }} onClick={reloadArchivos}>Refrescar</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>

          {/* ── SELECCION DE ARCHIVOS ── */}
          <div className="card gp-card-14" style={{ padding: 16 }}>
            <div style={sh}>SELECCION DE ARCHIVOS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={lbl}>ARCHIVO MINISTERIO</div>
                <select className="input" value={selectedMin} style={{ ...fs, color: "var(--text)", background: "rgba(15,23,42,0.9)" }}
                  onChange={e => setSelectedMin(e.target.value)}>
                  <option value="">auto-detectar</option>
                  {archivosMin.map(a => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={lbl}>ARCHIVO SIAP</div>
                <select className="input" value={selectedSiap} style={{ ...fs, color: "var(--text)", background: "rgba(15,23,42,0.9)" }}
                  onChange={e => setSelectedSiap(e.target.value)}>
                  <option value="">auto-detectar</option>
                  {archivosSiap.map(a => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </div>
              {archivos.length === 0 && dirConfig?.configured && (
                <div style={{ fontSize: "0.78rem", color: "var(--danger)" }}>
                  No hay archivos Excel en el directorio. Copialos y refrescá.
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button className="btn" style={{ flex: 1, fontSize: "0.78rem", padding: "7px 0",
                  background: direccion === "MIN_VS_SIAP" ? "rgba(99,102,241,.25)" : "transparent",
                  borderColor: direccion === "MIN_VS_SIAP" ? "#6366f1" : "rgba(255,255,255,.15)",
                  color: direccion === "MIN_VS_SIAP" ? "#a5b4fc" : "var(--muted)" }}
                  onClick={() => setDireccion("MIN_VS_SIAP")}>
                  Ministerio SIAP
                </button>
                <button className="btn" style={{ flex: 1, fontSize: "0.78rem", padding: "7px 0",
                  background: direccion === "SIAP_VS_MIN" ? "rgba(99,102,241,.25)" : "transparent",
                  borderColor: direccion === "SIAP_VS_MIN" ? "#6366f1" : "rgba(255,255,255,.15)",
                  color: direccion === "SIAP_VS_MIN" ? "#a5b4fc" : "var(--muted)" }}
                  onClick={() => setDireccion("SIAP_VS_MIN")}>
                  SIAP Ministerio
                </button>
              </div>
              <button className="btn" onClick={compare} disabled={loading}
                style={{ marginTop: 4, background: "#2563eb", color: "#fff", borderColor: "#1d4ed8", fontSize: "0.9rem", padding: "9px 0" }}>
                {loading ? "Comparando..." : "Comparar"}
              </button>
            </div>
          </div>

          {/* ── NOVEDADES A OMITIR ── */}
          <div className="card gp-card-14" style={{ padding: 16 }}>
            <div style={sh}>NOVEDADES A OMITIR (no se comparan)</div>
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
                {s} <span style={{ cursor: "pointer" }} onClick={() => setSkipNovedades(p => p.filter(x => x !== s))}>x</span>
              </span>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input className="input" placeholder="Agregar novedad a omitir..." value={customSkip}
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
            <div style={sh}>MAPEO DE NOVEDADES</div>
            <span style={{ fontSize: "0.72rem", color: mapeoFromDisk ? "var(--ok)" : "#94a3b8", marginLeft: 4 }}>
              {mapeoFromDisk ? "✔ guardado en disco" : "(usando default)"}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              {/* Boton cargar novedades */}
              <button className="btn"
                style={{ fontSize: "0.76rem", padding: "4px 12px",
                  color: novedadesMin.length > 0 ? "var(--ok)" : "var(--muted)",
                  borderColor: novedadesMin.length > 0 ? "rgba(16,185,129,.4)" : undefined }}
                onClick={loadNovedades}
                disabled={loadingNovedades}
                title="Lee los Excel y carga todas las novedades unicas para usar en el editor">
                {loadingNovedades ? "Cargando..." : novedadesMin.length > 0
                  ? `✔ ${novedadesMin.length} Ministerio / ${novedadesSiap.length} SIAP`
                  : "Cargar novedades de los Excel"}
              </button>
              <button className="btn" style={{ fontSize: "0.78rem", padding: "4px 14px" }}
                onClick={async () => {
                  if (!showMapeo && novedadesMin.length === 0) await loadNovedades();
                  setShowMapeo(v => !v);
                }}>
                {showMapeo ? "Cerrar" : "Ver / editar mapeo"}
              </button>
            </div>
          </div>
          {showMapeo && (
            <MapeoEditor
              mapeo={mapeo}
              onChange={setMapeo}
              onSave={saveMapeo}
              onReset={resetMapeo}
              saving={savingMapeo}
              novedadesMin={novedadesMin}
              novedadesSiap={novedadesSiap}
            />
          )}
          {!showMapeo && (
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {Object.keys(mapeo ?? {}).length} novedades del Ministerio mapeadas a equivalentes SIAP.
              Las novedades sin mapeo apareceran como "NO COINCIDENTE (sin mapeo)".
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
                  <option value="COINCIDENTE">Coincidentes ({meta?.coincidentes})</option>
                  <option value="NO COINCIDENTE">No coincidentes ({meta?.noCoincidentes})</option>
                  <option value="OMITIDO">Omitidos ({meta?.omitidos})</option>
                </select>
              </div>
              <div>
                <div style={lbl}>DNI</div>
                <input className="input" placeholder="Filtrar por DNI..." value={filtroDni}
                  style={fs} onChange={e => setFiltroDni(e.target.value)} />
              </div>
              <div>
                <div style={lbl}>NOMBRE</div>
                <input className="input" placeholder="Filtrar por nombre..." value={filtroNombre}
                  style={fs} onChange={e => setFiltroNombre(e.target.value)} />
              </div>
              <button className="btn" disabled={filtered.length === 0} onClick={() => exportXLSX(filtered, meta)}
                style={{ padding: "9px 16px", fontSize: "0.82rem", whiteSpace: "nowrap" as const }}>
                Exportar Excel
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
                      <td style={{ padding: "6px 10px" }}><span style={badge[r.estado] || {}}>{r.estado === "COINCIDENTE" ? "✔ COINCIDENTE" : r.estado === "NO COINCIDENTE" ? "✗ NO COINCIDENTE" : "OMITIDO"}</span></td>
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

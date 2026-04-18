// src/pages/AusenciasConFichajesPage/index.tsx
// Ausentes código 28 — cruzado con fichajes biométricos y horarios planificados

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "../../components/Layout";
import { useToast } from "../../ui/toast";
import { apiFetch } from "../../api/http";
import { exportToExcel } from "../../utils/export";

// ── Tipos ────────────────────────────────────────────────────────────────────
interface ArchivoInfo { name: string; }

interface AusenteRow {
  dni: string;
  nombre: string;
  fecha: string;
  diaSemana: string;
  debiaVenir: boolean | null;
  novedadMinisterio: string;
  novedadSiap: string;
  siapJustificada: boolean | null;
  tieneFichaje: boolean;
  entrada: string | null;
  salida: string | null;
}

interface Meta {
  total: number;
  conFichaje: number;
  sinFichaje: number;
  debiaVenir: number;
  noDebiaVenir: number;
  sinInfoHorario: number;
  sinBiometrico: boolean;
  dbError: string | null;
}

function fmtFecha(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

type FiltroFichaje = "todos" | "con" | "sin";
type FiltroDebia   = "todos" | "si" | "no" | "sininfo";

export function AusenciasConFichajesPage() {
  const { error: toastError } = useToast();

  // ── Archivos disponibles ──────────────────────────────────────────────────
  const [archivos, setArchivos] = useState<ArchivoInfo[]>([]);
  const [ministerioFile, setMinisterioFile] = useState("");
  const [siapFile,       setSiapFile]       = useState("");
  const [horariosFile,   setHorariosFile]   = useState("");

  // ── Parámetros ────────────────────────────────────────────────────────────
  const [periodo, setPeriodo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // ── Resultados ────────────────────────────────────────────────────────────
  const [loading, setLoading]   = useState(false);
  const [rows, setRows]         = useState<AusenteRow[]>([]);
  const [meta, setMeta]         = useState<Meta | null>(null);
  const [loaded, setLoaded]     = useState(false);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const [filtroFichaje, setFiltroFichaje] = useState<FiltroFichaje>("todos");
  const [filtroDebia,   setFiltroDebia]   = useState<FiltroDebia>("todos");
  const [filtroSiap,    setFiltroSiap]    = useState<"todos"|"con"|"sin">("todos");
  const [filtroNovMin,  setFiltroNovMin]  = useState("");
  const [busqueda,      setBusqueda]      = useState("");
  const [filtroDni,     setFiltroDni]     = useState("");

  // Ref para disparar auto-carga solo una vez al detectar archivos
  const autoLoadRef = useRef(false);

  // ── Cargar lista de archivos disponibles ─────────────────────────────────
  useEffect(() => {
    apiFetch<any>("/asistencia/archivos")
      .then((r) => {
        if (!r?.ok || !Array.isArray(r.files)) return;
        const files: ArchivoInfo[] = r.files;
        setArchivos(files);

        // Auto-detectar ministerio (contiene "ministerio" en el nombre, sin "upa")
        const autoMin = files.find((f) => {
          const u = f.name.toUpperCase();
          return u.includes("MINISTERIO") && !u.includes("UPA");
        }) ?? files.find((f) => f.name.toUpperCase().includes("MINISTERIO"));
        if (autoMin) setMinisterioFile(autoMin.name);

        // Auto-detectar SIAP (contiene "siap" o "siape")
        const autoSiap = files.find((f) => f.name.toUpperCase().includes("SIAP"));
        if (autoSiap) setSiapFile(autoSiap.name);

        // Auto-detectar horarios (contiene "horario")
        const autoHor = files.find((f) => f.name.toUpperCase().includes("HORARIO"));
        if (autoHor) setHorariosFile(autoHor.name);

        // Marcar para auto-carga si encontramos al menos el archivo ministerio
        if (autoMin) autoLoadRef.current = true;
      })
      .catch(() => {});
  }, []);

  // ── Cargar datos ──────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    if (!ministerioFile) { toastError("Falta archivo", "Seleccioná el archivo Ministerio"); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (periodo)        params.set("periodo",        periodo);
      if (ministerioFile) params.set("ministerioFile", ministerioFile);
      if (siapFile)       params.set("siapFile",       siapFile);
      if (horariosFile)   params.set("horariosFile",   horariosFile);

      const r = await apiFetch<{ ok: boolean; data: AusenteRow[]; meta: Meta }>(
        `/asistencia/ausentes28?${params}`,
      );
      if (!r.ok) throw new Error((r as any).error ?? "Error al cargar");
      setRows(r.data ?? []);
      setMeta(r.meta ?? null);
      setLoaded(true);
    } catch (e: any) {
      toastError("Error", e?.message ?? "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, [periodo, ministerioFile, siapFile, horariosFile, toastError]);

  // ── Auto-carga al detectar archivos ───────────────────────────────────────
  useEffect(() => {
    if (autoLoadRef.current && ministerioFile && !loaded && !loading) {
      autoLoadRef.current = false;
      cargar();
    }
  }, [ministerioFile, cargar, loaded, loading]);


  // ── Filtro ────────────────────────────────────────────────────────────────
  // Lista de personas únicas para el selector
  const personasUnicas = React.useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (!map.has(r.dni)) map.set(r.dni, r.nombre); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  // Listas únicas para selectores
  const novedadesMinUnicas = React.useMemo(() =>
    [...new Set(rows.map(r => r.novedadMinisterio).filter(Boolean))].sort(), [rows]);

  const novedadesSiapUnicas = React.useMemo(() =>
    [...new Set(rows.map(r => r.novedadSiap).filter(Boolean))].sort(), [rows]);

  const rowsFiltradas = rows.filter((r) => {
    if (filtroDni     && r.dni !== filtroDni)               return false;
    if (filtroNovMin  && r.novedadMinisterio !== filtroNovMin) return false;
    if (filtroSiap === "con" && !r.novedadSiap)             return false;
    if (filtroSiap === "sin" &&  r.novedadSiap)             return false;
    if (filtroFichaje === "con"  && !r.tieneFichaje)        return false;
    if (filtroFichaje === "sin"  &&  r.tieneFichaje)        return false;
    if (filtroDebia   === "si"   && r.debiaVenir !== true)  return false;
    if (filtroDebia   === "no"   && r.debiaVenir !== false) return false;
    if (filtroDebia   === "sininfo" && r.debiaVenir !== null) return false;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      return r.nombre.toLowerCase().includes(q) || r.dni.includes(q) || r.fecha.includes(q);
    }
    return true;
  });

  // ── Exportar ──────────────────────────────────────────────────────────────
  const exportar = () => {
    const data = rowsFiltradas.map((r) => ({
      DNI:                  r.dni,
      Nombre:               r.nombre,
      Fecha:                fmtFecha(r.fecha),
      Día:                  r.diaSemana,
      "Novedad Ministerio": r.novedadMinisterio,
      "Novedad SIAP":       r.novedadSiap || "—",
      "Debía venir":        r.debiaVenir === true ? "Sí" : r.debiaVenir === false ? "No" : "Sin info",
      "Fichó":              r.tieneFichaje ? "Sí" : "No",
      Entrada:              r.entrada ?? "",
      Salida:               r.salida  ?? "",
    }));
    exportToExcel(`ausentes28_${periodo}`, data);
  };

  // ── Estilos semáforo ──────────────────────────────────────────────────────
  const badgeFichaje = (tiene: boolean): React.CSSProperties =>
    tiene
      ? { background: "rgba(34,197,94,0.18)",  color: "#22c55e", border: "1px solid rgba(34,197,94,0.35)" }
      : { background: "rgba(239,68,68,0.18)",  color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" };

  const badgeDebia = (v: boolean | null): React.CSSProperties => {
    if (v === true)  return { background: "rgba(251,191,36,0.18)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)" };
    if (v === false) return { background: "rgba(100,116,139,0.18)", color: "#94a3b8", border: "1px solid rgba(100,116,139,0.35)" };
    return { background: "rgba(100,116,139,0.1)", color: "#64748b", border: "1px solid rgba(100,116,139,0.2)" };
  };

  const badge: React.CSSProperties = {
    display: "inline-block", padding: "2px 10px", borderRadius: 20,
    fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap",
  };

  const selectStyle: React.CSSProperties = {
    background: "rgba(15,23,42,0.9)", color: "var(--text)",
    border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
    padding: "6px 10px", fontSize: "0.82rem", width: "100%",
  };

  return (
    <Layout title="Ausentes 28 — Fichajes">

      {/* ── Selección de archivos ──────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: "0.68rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
          Archivos
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>

          <div style={{ flex: "1 1 220px" }}>
            <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Archivo Ministerio (cod. 28)</div>
            <select style={selectStyle} value={ministerioFile} onChange={(e) => setMinisterioFile(e.target.value)}>
              <option value="">— elegir archivo —</option>
              {archivos.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>

          <div style={{ flex: "1 1 220px" }}>
            <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Archivo SIAP</div>
            <select style={selectStyle} value={siapFile} onChange={(e) => setSiapFile(e.target.value)}>
              <option value="">— sin SIAP —</option>
              {archivos.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>

          <div style={{ flex: "1 1 220px" }}>
            <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Archivo Horarios</div>
            <select style={selectStyle} value={horariosFile} onChange={(e) => setHorariosFile(e.target.value)}>
              <option value="">— sin horarios —</option>
              {archivos.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>

          <div style={{ flex: "0 0 160px" }}>
            <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Período</div>
            <input type="month" className="input" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ width: "100%" }} />
          </div>

          <button className="btn primary" onClick={cargar} disabled={loading || !ministerioFile} type="button" style={{ height: 36 }}>
            {loading ? "Cargando…" : loaded ? "↻ Recargar" : "Cargar"}
          </button>
        </div>
      </div>

      {/* ── Alerta sin biométrico ──────────────────────────────────────── */}
      {meta?.sinBiometrico && (
        <div className="card" style={{ marginBottom: 12, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.07)", color: "#fbbf24", fontSize: "0.82rem" }}>
          ⚠ Sin datos de fichajes: {meta.dbError}
        </div>
      )}

      {/* ── Resumen ────────────────────────────────────────────────────── */}
      {meta && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          {[
            { label: "Días ausencia cod.28", value: meta.total,          color: "#e2e8f0" },
            { label: "Con fichaje",          value: meta.conFichaje,     color: "#22c55e" },
            { label: "Sin fichaje",          value: meta.sinFichaje,     color: "#ef4444" },
            { label: "Debía venir",          value: meta.debiaVenir,     color: "#fbbf24" },
            { label: "No debía venir",       value: meta.noDebiaVenir,   color: "#94a3b8" },
            { label: "Sin info horario",     value: meta.sinInfoHorario, color: "#64748b" },
          ].map((t) => (
            <div key={t.label} className="card" style={{ minWidth: 130, flex: "0 0 auto", padding: "10px 16px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: t.color }}>{t.value}</div>
              <div className="muted" style={{ fontSize: "0.72rem" }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filtros ────────────────────────────────────────────────────── */}
      {loaded && (
        <div className="card" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {/* Selector de persona */}
          <select
            value={filtroDni}
            onChange={(e) => setFiltroDni(e.target.value)}
            style={{ ...selectStyle, width: 240 }}
          >
            <option value="">— Todas las personas —</option>
            {personasUnicas.map(([dni, nombre]) => (
              <option key={dni} value={dni}>{nombre} ({dni})</option>
            ))}
          </select>
          <input
            className="input" placeholder="Buscar nombre / DNI / fecha…"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            style={{ width: 200 }}
          />
          {/* Nov. Ministerio */}
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Nov. Min.:</span>
            <select
              value={filtroNovMin}
              onChange={(e) => setFiltroNovMin(e.target.value)}
              style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.75rem" }}
            >
              <option value="">Todas</option>
              {novedadesMinUnicas.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Nov. SIAP */}
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Nov. SIAP:</span>
            {(["todos", "con", "sin"] as const).map((v) => (
              <button key={v} type="button"
                className={`btn${filtroSiap === v ? " primary" : ""}`}
                style={{ fontSize: "0.75rem", padding: "4px 10px", marginRight: 4 }}
                onClick={() => setFiltroSiap(v)}>
                {v === "todos" ? "Todos" : v === "con" ? "Con novedad" : "Sin novedad"}
              </button>
            ))}
          </div>

          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Fichaje:</span>
            {(["todos", "con", "sin"] as FiltroFichaje[]).map((v) => (
              <button key={v} type="button"
                className={`btn${filtroFichaje === v ? " primary" : ""}`}
                style={{ fontSize: "0.75rem", padding: "4px 10px", marginRight: 4 }}
                onClick={() => setFiltroFichaje(v)}>
                {v === "todos" ? "Todos" : v === "con" ? "Con fichaje" : "Sin fichaje"}
              </button>
            ))}
          </div>
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Horario:</span>
            {(["todos", "si", "no", "sininfo"] as FiltroDebia[]).map((v) => (
              <button key={v} type="button"
                className={`btn${filtroDebia === v ? " primary" : ""}`}
                style={{ fontSize: "0.75rem", padding: "4px 10px", marginRight: 4 }}
                onClick={() => setFiltroDebia(v)}>
                {v === "todos" ? "Todos" : v === "si" ? "Debía venir" : v === "no" ? "No debía venir" : "Sin info"}
              </button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
            {rowsFiltradas.length} fila{rowsFiltradas.length !== 1 ? "s" : ""}
          </span>
          <button
            className="btn"
            type="button"
            disabled={rowsFiltradas.length === 0}
            onClick={exportar}
            style={{ fontSize: "0.75rem", padding: "4px 12px", whiteSpace: "nowrap" }}
          >
            📥 Exportar Excel
          </button>
        </div>
      )}

      {/* ── Tabla ──────────────────────────────────────────────────────── */}
      {loaded && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["DNI", "Nombre", "Fecha", "Día", "Nov. Ministerio", "Nov. SIAP", "¿Debía venir?", "¿Fichó?", "Entrada", "Salida"].map((h) => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsFiltradas.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin resultados.</td></tr>
                ) : rowsFiltradas.map((r, i) => (
                  <tr key={`${r.dni}-${r.fecha}-${i}`}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{r.dni}</td>
                    <td style={{ padding: "8px 12px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.nombre}>{r.nombre}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
                    <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{r.diaSemana}</td>
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", color: "#cbd5e1", maxWidth: 200 }}>{r.novedadMinisterio || "—"}</td>
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", maxWidth: 200 }}>
                      {r.novedadSiap ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ color: "#a5b4fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.novedadSiap}</span>
                          {r.siapJustificada === true  && <span title="Justificada" style={{ flexShrink: 0, fontSize: "0.68rem", fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(34,197,94,0.18)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.35)" }}>J</span>}
                          {r.siapJustificada === false && <span title="No justificada" style={{ flexShrink: 0, fontSize: "0.68rem", fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }}>NJ</span>}
                        </span>
                      ) : <span style={{ color: "#475569" }}>—</span>}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ ...badge, ...badgeDebia(r.debiaVenir) }}>
                        {r.debiaVenir === true ? "Sí" : r.debiaVenir === false ? "No" : "—"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ ...badge, ...badgeFichaje(r.tieneFichaje) }}>
                        {r.tieneFichaje ? "Sí" : "No"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: r.entrada ? "#22c55e" : "#64748b" }}>{r.entrada ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: r.salida  ? "#60a5fa" : "#64748b" }}>{r.salida  ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loaded && !loading && (
        <div className="card" style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
          Seleccioná los archivos, el período y presioná <strong>Cargar</strong>.
        </div>
      )}
    </Layout>
  );
}

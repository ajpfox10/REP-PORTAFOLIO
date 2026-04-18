// src/pages/SinFichajeSalidaPage/index.tsx
// Agentes sin fichaje de salida — cruzado con horarios y SIAP
//
// Permite analizar un día exacto o un mes completo.
// Para cada agente que debía trabajar ese(os) día(s), muestra si fichó salida,
// si sólo fichó entrada, si no fichó nada, o si tiene una novedad en SIAP.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "../../components/Layout";
import { useToast } from "../../ui/toast";
import { apiFetch } from "../../api/http";
import { exportToExcel } from "../../utils/export";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface ArchivoInfo { name: string; }

interface SinSalidaRow {
  dni:         string;
  nombre:      string;
  upa:         string;
  esGuardia:   boolean;
  fecha:       string;
  diaSemana:   string;
  entrada:     string | null;
  salida:      string | null;
  novedadSiap: string;
  estado:      "SIN_SALIDA" | "SIN_FICHAJE" | "JUSTIFICADO" | "CON_SALIDA";
}

interface Meta {
  total:        number;
  sinSalida:    number;
  sinFichaje:   number;
  justificados: number;
  conSalida:    number;
  sinBiometrico: boolean;
  dbError:      string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtFecha(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

type ModoConsulta = "fecha" | "periodo";
type FiltroEstado = "todos" | "SIN_SALIDA" | "SIN_FICHAJE" | "JUSTIFICADO" | "CON_SALIDA";

const ESTADO_LABEL: Record<string, string> = {
  SIN_SALIDA:  "Sin salida",
  SIN_FICHAJE: "Sin fichaje",
  JUSTIFICADO: "Justificado",
  CON_SALIDA:  "Con salida",
};

const ESTADO_COLOR: Record<string, React.CSSProperties> = {
  SIN_SALIDA:  { background: "rgba(239,68,68,0.18)",   color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" },
  SIN_FICHAJE: { background: "rgba(251,191,36,0.18)",  color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)" },
  JUSTIFICADO: { background: "rgba(99,102,241,0.18)",  color: "#818cf8", border: "1px solid rgba(99,102,241,0.35)" },
  CON_SALIDA:  { background: "rgba(34,197,94,0.18)",   color: "#22c55e", border: "1px solid rgba(34,197,94,0.35)" },
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

// ── Componente ─────────────────────────────────────────────────────────────────
export function SinFichajeSalidaPage() {
  const { error: toastError } = useToast();

  // ── Archivos disponibles ────────────────────────────────────────────────────
  const [archivos, setArchivos] = useState<ArchivoInfo[]>([]);

  // Horarios: hasta 3 archivos (UPA 18, UPA 4, Hospital/General)
  const [horariosFiles, setHorariosFiles] = useState<string[]>(["", "", ""]);

  // SIAP: hasta 3 archivos
  const [siapFiles, setSiapFiles] = useState<string[]>(["", "", ""]);

  // ── Modo de consulta ────────────────────────────────────────────────────────
  const [modo, setModo] = useState<ModoConsulta>("periodo");

  const [fecha, setFecha] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });

  const [periodo, setPeriodo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // ── Resultados ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState<SinSalidaRow[]>([]);
  const [meta, setMeta]       = useState<Meta | null>(null);
  const [loaded, setLoaded]   = useState(false);

  // ── Filtros ─────────────────────────────────────────────────────────────────
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("SIN_SALIDA");
  const [filtroUpa,    setFiltroUpa]    = useState("");
  const [busqueda,     setBusqueda]     = useState("");

  const autoLoadRef = useRef(false);

  // ── Cargar lista de archivos disponibles ────────────────────────────────────
  useEffect(() => {
    apiFetch<any>("/asistencia/archivos")
      .then((r) => {
        if (!r?.ok || !Array.isArray(r.files)) return;
        const files: ArchivoInfo[] = r.files;
        setArchivos(files);

        // Auto-detectar horarios (archivos con "horario" en el nombre)
        const hors = files.filter(f => f.name.toUpperCase().includes("HORARIO"));
        if (hors.length > 0) {
          setHorariosFiles([
            hors[0]?.name ?? "",
            hors[1]?.name ?? "",
            hors[2]?.name ?? "",
          ]);
        }

        // Auto-detectar SIAP (archivos con "siap" en el nombre)
        const siaps = files.filter(f => f.name.toUpperCase().includes("SIAP"));
        if (siaps.length > 0) {
          setSiapFiles([
            siaps[0]?.name ?? "",
            siaps[1]?.name ?? "",
            siaps[2]?.name ?? "",
          ]);
          autoLoadRef.current = true;
        }
      })
      .catch(() => {});
  }, []);

  // ── Cargar datos ─────────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    const horariosSelected = horariosFiles.filter(Boolean);
    if (horariosSelected.length === 0) {
      toastError("Falta archivo", "Seleccioná al menos un archivo de horarios");
      return;
    }
    if (modo === "fecha" && !fecha) {
      toastError("Falta fecha", "Seleccioná la fecha a consultar");
      return;
    }
    if (modo === "periodo" && !periodo) {
      toastError("Falta período", "Seleccioná el período a consultar");
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, any> = {
        horariosFiles: horariosSelected,
        siapFiles:     siapFiles.filter(Boolean),
      };
      if (modo === "fecha")    body.fecha   = fecha;
      if (modo === "periodo")  body.periodo = periodo;

      const r = await apiFetch<{ ok: boolean; data: SinSalidaRow[]; meta: Meta }>(
        "/sin-salida/",
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        },
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
  }, [modo, fecha, periodo, horariosFiles, siapFiles, toastError]);

  // Auto-carga al detectar archivos
  useEffect(() => {
    if (autoLoadRef.current && !loaded && !loading) {
      autoLoadRef.current = false;
      cargar();
    }
  }, [cargar, loaded, loading]);

  // ── UPAs únicas para el filtro ───────────────────────────────────────────────
  const upasUnicas = React.useMemo(() =>
    [...new Set(rows.map(r => r.upa).filter(Boolean))].sort(), [rows]);

  // ── Filas filtradas ──────────────────────────────────────────────────────────
  const rowsFiltradas = React.useMemo(() => {
    return rows.filter(r => {
      if (filtroEstado !== "todos" && r.estado !== filtroEstado) return false;
      if (filtroUpa && r.upa !== filtroUpa) return false;
      if (busqueda) {
        const q = busqueda.toLowerCase();
        return (
          r.nombre.toLowerCase().includes(q) ||
          r.dni.includes(q) ||
          r.fecha.includes(q)
        );
      }
      return true;
    });
  }, [rows, filtroEstado, filtroUpa, busqueda]);

  // ── Exportar ─────────────────────────────────────────────────────────────────
  const exportar = () => {
    const etiqueta = modo === "periodo" ? periodo : fecha;
    const data = rowsFiltradas.map(r => ({
      DNI:               r.dni,
      "Apellido y Nombre": r.nombre,
      Dependencia:       r.upa,
      Régimen:           r.esGuardia ? "GUARDIA" : "",
      Fecha:             fmtFecha(r.fecha),
      Día:               r.diaSemana,
      Entrada:           r.entrada ?? "",
      Salida:            r.salida  ?? "",
      Estado:            ESTADO_LABEL[r.estado] ?? r.estado,
      "Nov. SIAP":       r.novedadSiap || "",
    }));
    exportToExcel(`sin_salida_${etiqueta}`, data);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  const setHorFile = (idx: number, val: string) =>
    setHorariosFiles(prev => { const next = [...prev]; next[idx] = val; return next; });

  const setSiapFile = (idx: number, val: string) =>
    setSiapFiles(prev => { const next = [...prev]; next[idx] = val; return next; });

  const fileOpt = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
    </>
  );

  return (
    <Layout title="Sin fichaje de salida">

      {/* ── Archivos y consulta ────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: "0.68rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
          Archivos y período
        </div>

        {/* Cabeceras de columna UPA */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          {["Hospital", "UPA 18", "UPA 4"].map(label => (
            <div key={label} style={{ flex: "1 1 200px", fontSize: "0.72rem", color: "#94a3b8", fontWeight: 600, textAlign: "center", letterSpacing: "0.04em" }}>
              {label}
            </div>
          ))}
        </div>

        {/* Horarios */}
        <div style={{ marginBottom: 10 }}>
          <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Horarios</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ flex: "1 1 200px" }}>
                <select style={selectStyle} value={horariosFiles[i]} onChange={e => setHorFile(i, e.target.value)}>
                  {fileOpt("— sin archivo —")}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* SIAP */}
        <div style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>SIAP</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ flex: "1 1 200px" }}>
                <select style={selectStyle} value={siapFiles[i]} onChange={e => setSiapFile(i, e.target.value)}>
                  {fileOpt("— sin archivo —")}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Modo + fecha/periodo + botón */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          {/* Toggle modo */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["fecha", "periodo"] as ModoConsulta[]).map(m => (
              <button
                key={m}
                type="button"
                className={`btn${modo === m ? " primary" : ""}`}
                style={{ fontSize: "0.78rem", padding: "5px 14px" }}
                onClick={() => setModo(m)}
              >
                {m === "fecha" ? "Día exacto" : "Mes completo"}
              </button>
            ))}
          </div>

          {modo === "fecha" ? (
            <div>
              <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Fecha</div>
              <input
                type="date"
                className="input"
                value={fecha}
                onChange={e => setFecha(e.target.value)}
                style={{ width: 160 }}
              />
            </div>
          ) : (
            <div>
              <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Período</div>
              <input
                type="month"
                className="input"
                value={periodo}
                onChange={e => setPeriodo(e.target.value)}
                style={{ width: 160 }}
              />
            </div>
          )}

          <button
            className="btn primary"
            onClick={cargar}
            disabled={loading || horariosFiles.filter(Boolean).length === 0}
            type="button"
            style={{ height: 36 }}
          >
            {loading ? "Cargando…" : loaded ? "↻ Recargar" : "Cargar"}
          </button>
        </div>
      </div>

      {/* ── Alerta sin biométrico ─────────────────────────────────────────── */}
      {meta?.sinBiometrico && (
        <div className="card" style={{ marginBottom: 12, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.07)", color: "#fbbf24", fontSize: "0.82rem" }}>
          ⚠ Sin datos de fichajes biométricos: {meta.dbError}
        </div>
      )}

      {/* ── Resumen ───────────────────────────────────────────────────────── */}
      {meta && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          {[
            { label: "Total controlables", value: meta.total,        color: "#e2e8f0" },
            { label: "Sin salida",         value: meta.sinSalida,    color: "#ef4444" },
            { label: "Sin fichaje",        value: meta.sinFichaje,   color: "#fbbf24" },
            { label: "Justificados",       value: meta.justificados, color: "#818cf8" },
            { label: "Con salida (OK)",    value: meta.conSalida,    color: "#22c55e" },
          ].map(t => (
            <div key={t.label} className="card" style={{ minWidth: 130, flex: "0 0 auto", padding: "10px 16px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: t.color }}>{t.value}</div>
              <div className="muted" style={{ fontSize: "0.72rem" }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      {loaded && (
        <div className="card" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>

          {/* Estado */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["todos", "SIN_SALIDA", "SIN_FICHAJE", "JUSTIFICADO", "CON_SALIDA"] as FiltroEstado[]).map(v => (
              <button
                key={v}
                type="button"
                className={`btn${filtroEstado === v ? " primary" : ""}`}
                style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                onClick={() => setFiltroEstado(v)}
              >
                {v === "todos" ? "Todos" : ESTADO_LABEL[v]}
              </button>
            ))}
          </div>

          {/* UPA */}
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Dependencia:</span>
            <select
              value={filtroUpa}
              onChange={e => setFiltroUpa(e.target.value)}
              style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}
            >
              <option value="">Todas</option>
              {upasUnicas.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* Búsqueda */}
          <input
            className="input"
            placeholder="Buscar nombre / DNI…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            style={{ width: 200 }}
          />

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

      {/* ── Tabla ─────────────────────────────────────────────────────────── */}
      {loaded && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["Apellido y Nombre", "DNI", "Dependencia", "Régimen", "Fecha", "Día", "Entrada", "Salida", "Estado", "Nov. SIAP"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsFiltradas.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                      Sin resultados para los filtros aplicados.
                    </td>
                  </tr>
                ) : rowsFiltradas.map((r, i) => (
                  <tr
                    key={`${r.dni}-${r.fecha}-${i}`}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.nombre}>
                      {r.nombre || <span style={{ color: "#475569" }}>—</span>}
                    </td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{r.dni}</td>
                    <td style={{ padding: "8px 12px", color: "#cbd5e1", fontSize: "0.78rem" }}>{r.upa}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {r.esGuardia
                        ? <span style={{ ...badge, background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)", fontSize: "0.72rem" }}>GUARDIA</span>
                        : <span style={{ color: "#475569", fontSize: "0.78rem" }}>—</span>
                      }
                    </td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
                    <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{r.diaSemana}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: r.entrada ? "#22c55e" : "#475569" }}>
                      {r.entrada ?? "—"}
                    </td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: r.salida ? "#60a5fa" : "#ef4444" }}>
                      {r.salida ?? "—"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ ...badge, ...(ESTADO_COLOR[r.estado] ?? {}) }}>
                        {ESTADO_LABEL[r.estado] ?? r.estado}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", color: r.novedadSiap ? "#a5b4fc" : "#475569", maxWidth: 220 }}>
                      {r.novedadSiap || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loaded && !loading && (
        <div className="card" style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
          Seleccioná los archivos de horarios, el modo de consulta y presioná <strong>Cargar</strong>.
        </div>
      )}
    </Layout>
  );
}

// src/pages/SinFichajeSalidaPage/index.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "../../components/Layout";
import { useToast } from "../../ui/toast";
import { apiFetch } from "../../api/http";
import { exportToExcel } from "../../utils/export";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface ArchivoInfo { name: string; }

interface SinSalidaRow {
  dni:                   string;
  nombre:                string;
  upa:                   string;
  esGuardia:             boolean;
  fecha:                 string;
  diaSemana:             string;
  entrada:               string | null;
  salida:                string | null;
  horaEntradaProgramada: string | null;
  horaSalidaProgramada:  string | null;
  novedadSiap:           string;
  estado:                "SIN_SALIDA" | "SIN_FICHAJE" | "JUSTIFICADO" | "CON_SALIDA";
  fichajeInvertido:      boolean;
}

interface Meta {
  total:              number;
  sinSalida:          number;
  sinFichaje:         number;
  justificados:       number;
  conSalida:          number;
  agentesConProblema: number;
  agentesInvertidos:  number;
  sinBiometrico:      boolean;
  dbError:            string | null;
}

interface AgenteRow {
  dni:        string;
  nombre:     string;
  upa:        string;
  sinSalida:  number;
  sinFichaje: number;
}

interface AgenteInvertidoRow {
  dni:      string;
  nombre:   string;
  upa:      string;
  cantidad: number;
}

type Tab          = "registros" | "agentes" | "invertidos";
type ModoConsulta = "fecha" | "periodo";
type FiltroEstado = "todos" | "SIN_SALIDA" | "SIN_FICHAJE" | "JUSTIFICADO" | "CON_SALIDA";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtFecha(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

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

const PAGE_SIZE = 50;

// ── Paginación ────────────────────────────────────────────────────────────────
function Paginacion({ pagina, total, onChange }: { pagina: number; total: number; onChange: (p: number) => void }) {
  const totalPags = Math.ceil(total / PAGE_SIZE);
  if (totalPags <= 1) return null;
  const btnStyle: React.CSSProperties = { fontSize: "0.78rem", padding: "3px 10px", minWidth: 32 };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "10px 12px", justifyContent: "center", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <button className="btn" style={btnStyle} disabled={pagina === 1} onClick={() => onChange(1)}>«</button>
      <button className="btn" style={btnStyle} disabled={pagina === 1} onClick={() => onChange(pagina - 1)}>‹</button>
      <span className="muted" style={{ fontSize: "0.78rem", padding: "0 8px" }}>
        Página {pagina} de {totalPags} &nbsp;·&nbsp; {total} fila{total !== 1 ? "s" : ""}
      </span>
      <button className="btn" style={btnStyle} disabled={pagina === totalPags} onClick={() => onChange(pagina + 1)}>›</button>
      <button className="btn" style={btnStyle} disabled={pagina === totalPags} onClick={() => onChange(totalPags)}>»</button>
    </div>
  );
}

// ── Modal fichajes de agente ───────────────────────────────────────────────────
function AgentModal({ agente, rows, highlightInvertido = false, onClose }: {
  agente:            { dni: string; nombre: string; upa: string };
  rows:              SinSalidaRow[];
  highlightInvertido?: boolean;
  onClose:           () => void;
}) {
  const agentRows = rows
    .filter(r => r.dni === agente.dni)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 700, maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{agente.nombre}</div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>DNI {agente.dni} &nbsp;·&nbsp; {agente.upa}</div>
          </div>
          <button className="btn" style={{ fontSize: "0.82rem", padding: "4px 12px" }} onClick={onClose}>Cerrar</button>
        </div>

        {/* Tabla */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["Fecha", "Día", "Prog. Entrada", "Prog. Salida", "Real Entrada", "Real Salida", "Estado", "Nov. SIAP"].map(h => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--card, #1e293b)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agentRows.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin registros.</td></tr>
              ) : agentRows.map((r, i) => {
                const esProblema  = r.estado === "SIN_SALIDA" || r.estado === "SIN_FICHAJE";
                const esInvertido = highlightInvertido ? r.fichajeInvertido : false;
                const rowBg =
                  esInvertido ? "rgba(239,68,68,0.12)" :
                  esProblema  ? "rgba(239,68,68,0.09)" :
                  i % 2 === 0 ? "transparent"          : "rgba(255,255,255,0.02)";

                return (
                  <tr key={`${r.fecha}-${i}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: rowBg }}>
                    <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
                    <td style={{ padding: "7px 12px", color: "#94a3b8" }}>{r.diaSemana}</td>
                    {/* Horas programadas */}
                    <td style={{ padding: "7px 12px", fontFamily: "monospace", color: "#64748b" }}>
                      {r.horaEntradaProgramada ?? <span style={{ color: "#334155" }}>—</span>}
                    </td>
                    <td style={{ padding: "7px 12px", fontFamily: "monospace", color: "#64748b" }}>
                      {r.horaSalidaProgramada ?? <span style={{ color: "#334155" }}>—</span>}
                    </td>
                    {/* Horas reales */}
                    <td style={{ padding: "7px 12px", fontFamily: "monospace", color: r.entrada ? (esInvertido ? "#ef4444" : "#22c55e") : "#475569" }}>
                      {r.entrada ?? "—"}{esInvertido && r.entrada && " ↕"}
                    </td>
                    <td style={{ padding: "7px 12px", fontFamily: "monospace", color: r.salida ? (esInvertido ? "#ef4444" : "#60a5fa") : "#ef4444" }}>
                      {r.salida ?? "—"}{esInvertido && r.salida && " ↕"}
                    </td>
                    <td style={{ padding: "7px 12px" }}>
                      <span style={{ ...badge, ...(ESTADO_COLOR[r.estado] ?? {}) }}>{ESTADO_LABEL[r.estado] ?? r.estado}</span>
                      {esInvertido && (
                        <span style={{ ...badge, marginLeft: 4, background: "rgba(239,68,68,0.2)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.4)", fontSize: "0.68rem" }}>
                          Invertido
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "7px 12px", fontSize: "0.75rem", color: r.novedadSiap ? "#a5b4fc" : "#475569" }}>{r.novedadSiap || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer resumen */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          {[
            { label: "Sin salida",  val: agentRows.filter(r => r.estado === "SIN_SALIDA").length,  color: "#ef4444" },
            { label: "Sin fichaje", val: agentRows.filter(r => r.estado === "SIN_FICHAJE").length, color: "#fbbf24" },
            { label: "Justificado", val: agentRows.filter(r => r.estado === "JUSTIFICADO").length, color: "#818cf8" },
            { label: "Con salida",  val: agentRows.filter(r => r.estado === "CON_SALIDA").length,  color: "#22c55e" },
            { label: "Invertidos",  val: agentRows.filter(r => r.fichajeInvertido).length,         color: "#ef4444" },
          ].map(s => (
            <span key={s.label} style={{ fontSize: "0.78rem" }}>
              <span style={{ fontWeight: 700, color: s.color }}>{s.val}</span>
              <span className="muted"> {s.label}</span>
            </span>
          ))}
          <span className="muted" style={{ fontSize: "0.72rem", marginLeft: "auto" }}>Clic fuera para cerrar</span>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export function SinFichajeSalidaPage() {
  const { error: toastError } = useToast();

  const [archivos, setArchivos]           = useState<ArchivoInfo[]>([]);
  const [horariosFiles, setHorariosFiles] = useState<string[]>(["", "", ""]);
  const [siapFiles, setSiapFiles]         = useState<string[]>(["", "", ""]);

  const [modo, setModo]       = useState<ModoConsulta>("periodo");
  const [fecha, setFecha]     = useState(() => new Date().toISOString().slice(0, 10));
  const [periodo, setPeriodo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState<SinSalidaRow[]>([]);
  const [meta, setMeta]       = useState<Meta | null>(null);
  const [loaded, setLoaded]   = useState(false);

  // filtros tab Registros
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("SIN_SALIDA");
  const [filtroUpa, setFiltroUpa]       = useState("");
  const [busqueda, setBusqueda]         = useState("");

  // tabs y paginación
  const [tab, setTab]         = useState<Tab>("registros");
  const [paginaR, setPaginaR] = useState(1);
  const [paginaA, setPaginaA] = useState(1);
  const [paginaI, setPaginaI] = useState(1);

  // búsquedas tabs
  const [busquedaA, setBusquedaA] = useState("");
  const [busquedaI, setBusquedaI] = useState("");

  // modal
  const [agentModal, setAgentModal] = useState<{ dni: string; nombre: string; upa: string; invertido: boolean } | null>(null);

  const autoLoadRef = useRef(false);

  useEffect(() => { setPaginaR(1); setPaginaA(1); setPaginaI(1); }, [rows]);
  useEffect(() => { setPaginaR(1); }, [filtroEstado, filtroUpa, busqueda]);
  useEffect(() => { setPaginaA(1); }, [busquedaA]);
  useEffect(() => { setPaginaI(1); }, [busquedaI]);

  // Cargar lista de archivos
  useEffect(() => {
    apiFetch<any>("/asistencia/archivos")
      .then((r) => {
        if (!r?.ok || !Array.isArray(r.files)) return;
        const files: ArchivoInfo[] = r.files;
        setArchivos(files);
        const hors = files.filter(f => f.name.toUpperCase().includes("HORARIO"));
        if (hors.length > 0)
          setHorariosFiles([hors[0]?.name ?? "", hors[1]?.name ?? "", hors[2]?.name ?? ""]);
        const siaps = files.filter(f => f.name.toUpperCase().includes("SIAP"));
        if (siaps.length > 0) {
          setSiapFiles([siaps[0]?.name ?? "", siaps[1]?.name ?? "", siaps[2]?.name ?? ""]);
          autoLoadRef.current = true;
        }
      })
      .catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    const horariosSelected = horariosFiles.filter(Boolean);
    if (horariosSelected.length === 0) { toastError("Falta archivo", "Seleccioná al menos un archivo de horarios"); return; }
    if (modo === "fecha"   && !fecha)   { toastError("Falta fecha",   "Seleccioná la fecha a consultar");   return; }
    if (modo === "periodo" && !periodo) { toastError("Falta período",  "Seleccioná el período a consultar"); return; }

    setLoading(true);
    try {
      const body: Record<string, any> = { horariosFiles: horariosSelected, siapFiles: siapFiles.filter(Boolean) };
      if (modo === "fecha")   body.fecha   = fecha;
      if (modo === "periodo") body.periodo = periodo;

      const r = await apiFetch<{ ok: boolean; data: SinSalidaRow[]; meta: Meta }>(
        "/sin-salida/",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
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

  useEffect(() => {
    if (autoLoadRef.current && !loaded && !loading) { autoLoadRef.current = false; cargar(); }
  }, [cargar, loaded, loading]);

  const upasUnicas = React.useMemo(() =>
    [...new Set(rows.map(r => r.upa).filter(Boolean))].sort(), [rows]);

  // Filas filtradas – tab Registros
  const rowsFiltradas = React.useMemo(() =>
    rows.filter(r => {
      if (filtroEstado !== "todos" && r.estado !== filtroEstado) return false;
      if (filtroUpa && r.upa !== filtroUpa) return false;
      if (busqueda) {
        const q = busqueda.toLowerCase();
        return r.nombre.toLowerCase().includes(q) || r.dni.includes(q) || r.fecha.includes(q);
      }
      return true;
    }), [rows, filtroEstado, filtroUpa, busqueda]);

  // Agentes únicos con problema (sin salida / sin fichaje)
  const agentesLista = React.useMemo((): AgenteRow[] => {
    const map = new Map<string, AgenteRow>();
    rows.forEach(r => {
      if (r.estado !== "SIN_SALIDA" && r.estado !== "SIN_FICHAJE") return;
      if (!map.has(r.dni)) map.set(r.dni, { dni: r.dni, nombre: r.nombre, upa: r.upa, sinSalida: 0, sinFichaje: 0 });
      const a = map.get(r.dni)!;
      if (r.estado === "SIN_SALIDA") a.sinSalida++; else a.sinFichaje++;
    });
    return [...map.values()]
      .filter(a => {
        if (!busquedaA) return true;
        const q = busquedaA.toLowerCase();
        return a.nombre.toLowerCase().includes(q) || a.dni.includes(q);
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [rows, busquedaA]);

  // Agentes con fichaje invertido
  const agentesInvertidosLista = React.useMemo((): AgenteInvertidoRow[] => {
    const map = new Map<string, AgenteInvertidoRow>();
    rows.forEach(r => {
      if (!r.fichajeInvertido) return;
      if (!map.has(r.dni)) map.set(r.dni, { dni: r.dni, nombre: r.nombre, upa: r.upa, cantidad: 0 });
      map.get(r.dni)!.cantidad++;
    });
    return [...map.values()]
      .filter(a => {
        if (!busquedaI) return true;
        const q = busquedaI.toLowerCase();
        return a.nombre.toLowerCase().includes(q) || a.dni.includes(q);
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [rows, busquedaI]);

  const exportar = () => {
    const etiqueta = modo === "periodo" ? periodo : fecha;
    exportToExcel(`sin_salida_${etiqueta}`, rowsFiltradas.map(r => ({
      DNI:                 r.dni,
      "Apellido y Nombre": r.nombre,
      Dependencia:         r.upa,
      Régimen:             r.esGuardia ? "GUARDIA" : "",
      Fecha:               fmtFecha(r.fecha),
      Día:                 r.diaSemana,
      Entrada:             r.entrada ?? "",
      Salida:              r.salida  ?? "",
      Estado:              ESTADO_LABEL[r.estado] ?? r.estado,
      "Nov. SIAP":         r.novedadSiap || "",
      "Invertido":         r.fichajeInvertido ? "SÍ" : "",
    })));
  };

  const rowsPagina          = rowsFiltradas.slice((paginaR - 1) * PAGE_SIZE, paginaR * PAGE_SIZE);
  const agentesPagina       = agentesLista.slice((paginaA - 1) * PAGE_SIZE, paginaA * PAGE_SIZE);
  const invertidosPagina    = agentesInvertidosLista.slice((paginaI - 1) * PAGE_SIZE, paginaI * PAGE_SIZE);

  const setHorFile  = (idx: number, val: string) => setHorariosFiles(prev => { const n = [...prev]; n[idx] = val; return n; });
  const setSiapFile = (idx: number, val: string) => setSiapFiles(prev => { const n = [...prev]; n[idx] = val; return n; });

  const fileOpt = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
    </>
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: "registros",  label: `Registros (${rowsFiltradas.length})` },
    { id: "agentes",    label: `Agentes c/ problema (${agentesLista.length})` },
    { id: "invertidos", label: `Fichaje invertido (${agentesInvertidosLista.length})` },
  ];

  return (
    <Layout title="Sin fichaje de salida">

      {/* ── Archivos y consulta ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: "0.68rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
          Archivos y período
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          {["Hospital", "UPA 18", "UPA 4"].map(label => (
            <div key={label} style={{ flex: "1 1 200px", fontSize: "0.72rem", color: "#94a3b8", fontWeight: 600, textAlign: "center", letterSpacing: "0.04em" }}>
              {label}
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 10 }}>
          <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Horarios</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ flex: "1 1 200px" }}>
                <select style={selectStyle} value={horariosFiles[i]} onChange={e => setHorFile(i, e.target.value)}>{fileOpt("— sin archivo —")}</select>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>SIAP</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ flex: "1 1 200px" }}>
                <select style={selectStyle} value={siapFiles[i]} onChange={e => setSiapFile(i, e.target.value)}>{fileOpt("— sin archivo —")}</select>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["fecha", "periodo"] as ModoConsulta[]).map(m => (
              <button key={m} type="button" className={`btn${modo === m ? " primary" : ""}`}
                style={{ fontSize: "0.78rem", padding: "5px 14px" }} onClick={() => setModo(m)}>
                {m === "fecha" ? "Día exacto" : "Mes completo"}
              </button>
            ))}
          </div>
          {modo === "fecha" ? (
            <div>
              <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Fecha</div>
              <input type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} style={{ width: 160 }} />
            </div>
          ) : (
            <div>
              <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Período</div>
              <input type="month" className="input" value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ width: 160 }} />
            </div>
          )}
          <button className="btn primary" onClick={cargar}
            disabled={loading || horariosFiles.filter(Boolean).length === 0} type="button" style={{ height: 36 }}>
            {loading ? "Cargando…" : loaded ? "↻ Recargar" : "Cargar"}
          </button>
        </div>
      </div>

      {/* ── Alerta sin biométrico ────────────────────────────────────────── */}
      {meta?.sinBiometrico && (
        <div className="card" style={{ marginBottom: 12, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.07)", color: "#fbbf24", fontSize: "0.82rem" }}>
          ⚠ Sin datos de fichajes biométricos: {meta.dbError}
        </div>
      )}

      {/* ── Resumen ──────────────────────────────────────────────────────── */}
      {meta && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          {[
            { label: "Total controlables",  value: meta.total,              color: "#e2e8f0" },
            { label: "Sin salida",          value: meta.sinSalida,          color: "#ef4444" },
            { label: "Sin fichaje",         value: meta.sinFichaje,         color: "#fbbf24" },
            { label: "Justificados",        value: meta.justificados,       color: "#818cf8" },
            { label: "Con salida (OK)",     value: meta.conSalida,          color: "#22c55e" },
            { label: "Agentes c/ problema", value: meta.agentesConProblema, color: "#f97316" },
            { label: "Fichaje invertido",   value: meta.agentesInvertidos,  color: "#e879f9" },
          ].map(t => (
            <div key={t.label} className="card" style={{ minWidth: 130, flex: "0 0 auto", padding: "10px 16px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: t.color }}>{t.value}</div>
              <div className="muted" style={{ fontSize: "0.72rem" }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      {loaded && (
        <div style={{ display: "flex", gap: 0, marginBottom: 0, borderBottom: "2px solid rgba(255,255,255,0.08)" }}>
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{
                padding: "9px 20px", fontSize: "0.82rem",
                fontWeight: tab === t.id ? 700 : 400,
                border: "none",
                borderBottom: tab === t.id ? "2px solid #818cf8" : "2px solid transparent",
                background: "transparent",
                color: tab === t.id ? "#e2e8f0" : "#64748b",
                cursor: "pointer", marginBottom: -2, transition: "color 0.15s",
              }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ══════════════ TAB: REGISTROS ══════════════ */}
      {loaded && tab === "registros" && (
        <>
          <div className="card" style={{ marginBottom: 12, marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(["todos", "SIN_SALIDA", "SIN_FICHAJE", "JUSTIFICADO", "CON_SALIDA"] as FiltroEstado[]).map(v => (
                <button key={v} type="button"
                  className={`btn${filtroEstado === v ? " primary" : ""}`}
                  style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                  onClick={() => setFiltroEstado(v)}>
                  {v === "todos" ? "Todos" : ESTADO_LABEL[v]}
                </button>
              ))}
            </div>
            <div>
              <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Dependencia:</span>
              <select value={filtroUpa} onChange={e => setFiltroUpa(e.target.value)}
                style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}>
                <option value="">Todas</option>
                {upasUnicas.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <input className="input" placeholder="Buscar nombre / DNI…" value={busqueda}
              onChange={e => setBusqueda(e.target.value)} style={{ width: 200 }} />
            <button className="btn" type="button" disabled={rowsFiltradas.length === 0} onClick={exportar}
              style={{ fontSize: "0.75rem", padding: "4px 12px", whiteSpace: "nowrap", marginLeft: "auto" }}>
              📥 Exportar Excel
            </button>
          </div>

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
                  {rowsPagina.length === 0 ? (
                    <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin resultados.</td></tr>
                  ) : rowsPagina.map((r, i) => (
                    <tr key={`${r.dni}-${r.fecha}-${i}`}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        background: r.fichajeInvertido
                          ? "rgba(232,121,249,0.07)"
                          : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                      }}>
                      <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.nombre}>
                        {r.nombre || <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{r.dni}</td>
                      <td style={{ padding: "8px 12px", color: "#cbd5e1", fontSize: "0.78rem" }}>{r.upa}</td>
                      <td style={{ padding: "8px 12px" }}>
                        {r.esGuardia
                          ? <span style={{ ...badge, background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)", fontSize: "0.72rem" }}>GUARDIA</span>
                          : <span style={{ color: "#475569", fontSize: "0.78rem" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
                      <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{r.diaSemana}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", color: r.fichajeInvertido ? "#ef4444" : r.entrada ? "#22c55e" : "#475569" }}>
                        {r.entrada ?? "—"}{r.fichajeInvertido && r.entrada && " ↕"}
                      </td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", color: r.fichajeInvertido ? "#ef4444" : r.salida ? "#60a5fa" : "#ef4444" }}>
                        {r.salida ?? "—"}{r.fichajeInvertido && r.salida && " ↕"}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ ...badge, ...(ESTADO_COLOR[r.estado] ?? {}) }}>{ESTADO_LABEL[r.estado] ?? r.estado}</span>
                        {r.fichajeInvertido && (
                          <span style={{ ...badge, marginLeft: 4, background: "rgba(232,121,249,0.2)", color: "#e879f9", border: "1px solid rgba(232,121,249,0.4)", fontSize: "0.68rem" }}>↕</span>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: "0.78rem", color: r.novedadSiap ? "#a5b4fc" : "#475569", maxWidth: 220 }}>
                        {r.novedadSiap || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={paginaR} total={rowsFiltradas.length} onChange={setPaginaR} />
          </div>
        </>
      )}

      {/* ══════════════ TAB: AGENTES CON PROBLEMA ══════════════ */}
      {loaded && tab === "agentes" && (
        <>
          <div className="card" style={{ marginBottom: 12, marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" placeholder="Buscar nombre / DNI…" value={busquedaA}
              onChange={e => setBusquedaA(e.target.value)} style={{ width: 240 }} />
            <span className="muted" style={{ fontSize: "0.75rem" }}>{agentesLista.length} agente{agentesLista.length !== 1 ? "s" : ""} con problema</span>
            <span className="muted" style={{ fontSize: "0.72rem", marginLeft: "auto" }}>Doble click para ver fichajes del mes</span>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["Apellido y Nombre", "DNI", "Servicio", "Sin salida", "Sin fichaje"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentesPagina.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                      {busquedaA ? "Sin resultados." : "No hay agentes con problema."}
                    </td></tr>
                  ) : agentesPagina.map((a, i) => (
                    <tr key={a.dni}
                      onDoubleClick={() => setAgentModal({ ...a, invertido: false })}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)", cursor: "pointer" }}
                      title="Doble click para ver fichajes del mes">
                      <td style={{ padding: "9px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.nombre}>{a.nombre}</td>
                      <td style={{ padding: "9px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{a.dni}</td>
                      <td style={{ padding: "9px 12px", color: "#cbd5e1", fontSize: "0.78rem" }}>{a.upa}</td>
                      <td style={{ padding: "9px 12px" }}>
                        {a.sinSalida > 0
                          ? <span style={{ ...badge, background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }}>{a.sinSalida}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        {a.sinFichaje > 0
                          ? <span style={{ ...badge, background: "rgba(251,191,36,0.18)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)" }}>{a.sinFichaje}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={paginaA} total={agentesLista.length} onChange={setPaginaA} />
          </div>
        </>
      )}

      {/* ══════════════ TAB: FICHAJE INVERTIDO ══════════════ */}
      {loaded && tab === "invertidos" && (
        <>
          <div className="card" style={{ marginBottom: 12, marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" placeholder="Buscar nombre / DNI…" value={busquedaI}
              onChange={e => setBusquedaI(e.target.value)} style={{ width: 240 }} />
            <span className="muted" style={{ fontSize: "0.75rem" }}>{agentesInvertidosLista.length} agente{agentesInvertidosLista.length !== 1 ? "s" : ""} con fichaje invertido</span>
            <span className="muted" style={{ fontSize: "0.72rem", marginLeft: "auto" }}>
              Detectado cuando entrada &gt; salida — Doble click para ver fichajes del mes
            </span>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["Apellido y Nombre", "DNI", "Servicio", "Días invertidos"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invertidosPagina.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                      {busquedaI ? "Sin resultados." : "No se detectaron fichajes invertidos."}
                    </td></tr>
                  ) : invertidosPagina.map((a, i) => (
                    <tr key={a.dni}
                      onDoubleClick={() => setAgentModal({ ...a, invertido: true })}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)", cursor: "pointer" }}
                      title="Doble click para ver fichajes del mes">
                      <td style={{ padding: "9px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.nombre}>{a.nombre}</td>
                      <td style={{ padding: "9px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{a.dni}</td>
                      <td style={{ padding: "9px 12px", color: "#cbd5e1", fontSize: "0.78rem" }}>{a.upa}</td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ ...badge, background: "rgba(232,121,249,0.18)", color: "#e879f9", border: "1px solid rgba(232,121,249,0.35)" }}>
                          {a.cantidad} día{a.cantidad !== 1 ? "s" : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={paginaI} total={agentesInvertidosLista.length} onChange={setPaginaI} />
          </div>
        </>
      )}

      {!loaded && !loading && (
        <div className="card" style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
          Seleccioná los archivos de horarios, el modo de consulta y presioná <strong>Cargar</strong>.
        </div>
      )}

      {/* ── Modal ────────────────────────────────────────────────────────── */}
      {agentModal && (
        <AgentModal
          agente={{ dni: agentModal.dni, nombre: agentModal.nombre, upa: agentModal.upa }}
          rows={rows}
          highlightInvertido={agentModal.invertido}
          onClose={() => setAgentModal(null)}
        />
      )}

    </Layout>
  );
}

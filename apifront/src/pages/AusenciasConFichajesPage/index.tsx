// src/pages/AusenciasConFichajesPage/index.tsx
// Ausentes código 28 — cruzado con fichajes biométricos y horarios planificados
// + Tabla SIAP vs Ministerio vs Fichajes

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "../../components/Layout";
import { useToast } from "../../ui/toast";
import { apiFetch } from "../../api/http";
import { exportToExcel } from "../../utils/export";

// ── Tipos ────────────────────────────────────────────────────────────────────
interface ArchivoInfo { name: string; }

// ── Tipos tabla SIAP-Fichajes ─────────────────────────────────────────────────
interface SiapFichajeRow {
  dni: string;
  nombre: string;
  fecha: string;
  diaSemana: string;
  novedadSiap: string;
  justificadoSiap: string;
  debiaVenir: boolean | null;
  enMinisterio: boolean | null;
  novedadMinisterio: string;
  tieneFichaje: boolean;
  entrada: string | null;
  salida: string | null;
}

interface AgenteDiaRow {
  fecha: string;
  diaSemana: string;
  novedadesSiap: { novedad: string; justificado: string }[];
  novedadesMin: string[];
  esAusente: boolean;
  tieneFichaje: boolean;
  entrada: string | null;
  salida: string | null;
  horarioEntrada: string | null;
}

interface MetaSiap {
  total: number;
  conFichaje: number;
  sinFichaje: number;
  enMinisterio: number | null;
  sinMinisterio: number | null;
  sinBiometrico: boolean;
  dbError: string | null;
}

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
  recMedico: string | null;
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

  const [tabActiva, setTabActiva] = useState<"ausentes28" | "siap">("ausentes28");

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

  // ── Estado tabla SIAP-Fichajes ────────────────────────────────────────────
  const [loadingSiap,   setLoadingSiap]   = useState(false);
  const [rowsSiap,      setRowsSiap]      = useState<SiapFichajeRow[]>([]);
  const [metaSiap,      setMetaSiap]      = useState<MetaSiap | null>(null);
  const [loadedSiap,    setLoadedSiap]    = useState(false);

  // Filtros SIAP
  const [sfFiltroDni,    setSfFiltroDni]    = useState("");
  const [sfBusqueda,     setSfBusqueda]     = useState("");
  const [sfFiltroFichaje,setSfFiltroFichaje]= useState<"todos"|"con"|"sin">("todos");
  const [sfFiltroMin,    setSfFiltroMin]    = useState<"todos"|"con"|"sin">("todos");
  const [sfFiltroNovSiap,setSfFiltroNovSiap]= useState("");
  const [sfFiltroJust,   setSfFiltroJust]   = useState<"todos"|"SI"|"NO"|"">("todos");

  // ── Modal agente ──────────────────────────────────────────────────────────
  const [modalDni,    setModalDni]    = useState<string | null>(null);
  const [modalNombre, setModalNombre] = useState("");
  const [modalDias,   setModalDias]   = useState<AgenteDiaRow[]>([]);
  const [modalLoading,setModalLoading]= useState(false);

  const abrirModal = useCallback(async (dni: string, nombre: string) => {
    setModalDni(dni);
    setModalNombre(nombre);
    setModalDias([]);
    setModalLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("dni", dni);
      if (periodo)        params.set("periodo",        periodo);
      if (siapFile)       params.set("siapFile",       siapFile);
      if (ministerioFile) params.set("ministerioFile", ministerioFile);
      if (horariosFile)   params.set("horariosFile",   horariosFile);
      const r = await apiFetch<{ ok: boolean; nombre: string; data: AgenteDiaRow[] }>(
        `/asistencia/agente-mes?${params}`
      );
      if (!r.ok) throw new Error((r as any).error ?? "Error");
      if (r.nombre) setModalNombre(r.nombre);
      setModalDias(r.data ?? []);
    } catch (e: any) {
      setModalDias([]);
    } finally {
      setModalLoading(false);
    }
  }, [periodo, siapFile, ministerioFile, horariosFile]);

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

  // ── Cargar tabla SIAP-Fichajes ────────────────────────────────────────────
  const cargarSiap = useCallback(async () => {
    if (!siapFile) { toastError("Falta archivo", "Seleccioná el archivo SIAP"); return; }
    setLoadingSiap(true);
    try {
      const params = new URLSearchParams();
      if (periodo)        params.set("periodo",        periodo);
      if (siapFile)       params.set("siapFile",       siapFile);
      if (ministerioFile) params.set("ministerioFile", ministerioFile);
      const r = await apiFetch<{ ok: boolean; data: SiapFichajeRow[]; meta: MetaSiap }>(
        `/asistencia/siap-fichajes?${params}`,
      );
      if (!r.ok) throw new Error((r as any).error ?? "Error al cargar");
      setRowsSiap(r.data ?? []);
      setMetaSiap(r.meta ?? null);
      setLoadedSiap(true);
    } catch (e: any) {
      toastError("Error", e?.message ?? "No se pudo cargar");
    } finally {
      setLoadingSiap(false);
    }
  }, [periodo, siapFile, ministerioFile, toastError]);


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

  // ── Filtros y exportar tabla SIAP-Fichajes ────────────────────────────────
  const sfPersonasUnicas = React.useMemo(() => {
    const map = new Map<string, string>();
    rowsSiap.forEach(r => { if (!map.has(r.dni)) map.set(r.dni, r.nombre); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rowsSiap]);

  const sfNovedadesSiapUnicas = React.useMemo(() =>
    [...new Set(rowsSiap.map(r => r.novedadSiap).filter(Boolean))].sort(), [rowsSiap]);

  const sfRowsFiltradas = rowsSiap.filter(r => {
    if (sfFiltroDni    && r.dni !== sfFiltroDni)                       return false;
    if (sfFiltroNovSiap && r.novedadSiap !== sfFiltroNovSiap)         return false;
    if (sfFiltroJust !== "todos" && r.justificadoSiap !== sfFiltroJust) return false;
    if (sfFiltroFichaje === "con"  && !r.tieneFichaje)                 return false;
    if (sfFiltroFichaje === "sin"  &&  r.tieneFichaje)                 return false;
    if (sfFiltroMin === "con" && !r.enMinisterio)                      return false;
    if (sfFiltroMin === "sin" &&  r.enMinisterio !== false)            return false;
    if (sfBusqueda) {
      const q = sfBusqueda.toLowerCase();
      return r.nombre.toLowerCase().includes(q) || r.dni.includes(q) || r.fecha.includes(q);
    }
    return true;
  });

  const exportarSiap = () => {
    const data = sfRowsFiltradas.map(r => ({
      DNI:                r.dni,
      Nombre:             r.nombre,
      Fecha:              fmtFecha(r.fecha),
      Día:                r.diaSemana,
      "Novedad SIAP":     r.novedadSiap || "—",
      Justificado:        r.justificadoSiap || "—",
      "En Ministerio":    r.enMinisterio === null ? "Sin datos" : r.enMinisterio ? "Sí" : "No",
      "Novedad Ministerio": r.novedadMinisterio || "—",
      "Fichó":            r.tieneFichaje ? "Sí" : "No",
      Entrada:            r.entrada ?? "",
      Salida:             r.salida  ?? "",
    }));
    exportToExcel(`siap_fichajes_${periodo}`, data);
  };

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
      "Rec. Médico":        r.recMedico ?? "—",
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

  const tabStyle = (activa: boolean): React.CSSProperties => ({
    padding: "7px 20px", fontSize: "0.83rem", fontWeight: 600, cursor: "pointer",
    color: activa ? "#60a5fa" : "#64748b", background: "none", border: "none",
    borderBottom: activa ? "2px solid #60a5fa" : "2px solid transparent",
  });

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

          {tabActiva === "ausentes28"
            ? <button className="btn primary" onClick={cargar} disabled={loading || !ministerioFile} type="button" style={{ height: 36 }}>
                {loading ? "Cargando…" : loaded ? "↻ Recargar" : "Cargar"}
              </button>
            : <button className="btn primary" onClick={cargarSiap} disabled={loadingSiap || !siapFile} type="button" style={{ height: 36 }}>
                {loadingSiap ? "Cargando…" : loadedSiap ? "↻ Recargar" : "Cargar"}
              </button>
          }
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 14 }}>
        <button style={tabStyle(tabActiva === "ausentes28")} onClick={() => setTabActiva("ausentes28")}>
          Ausentes cod.28 vs Fichajes
        </button>
        <button style={tabStyle(tabActiva === "siap")} onClick={() => setTabActiva("siap")}>
          SIAP vs Ministerio vs Fichajes
        </button>
      </div>

      {tabActiva === "ausentes28" && <>

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
                  {["DNI", "Nombre", "Fecha", "Día", "Nov. Ministerio", "Nov. SIAP", "¿Debía venir?", "¿Fichó?", "Entrada", "Salida", "Rec. Médico"].map((h) => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsFiltradas.length === 0 ? (
                  <tr><td colSpan={11} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin resultados.</td></tr>
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
                    <td style={{ padding: "8px 12px" }}>
                      {r.recMedico != null
                        ? <span style={{ ...badge, background: "rgba(168,85,247,0.18)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.35)" }} title={r.recMedico !== "Sí" ? r.recMedico : undefined}>
                            {r.recMedico !== "Sí" ? r.recMedico : "Sí"}
                          </span>
                        : <span style={{ color: "#475569" }}>—</span>
                      }
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
          Seleccioná los archivos, el período y presioná <strong>Cargar</strong>.
        </div>
      )}

      </>}

      {tabActiva === "siap" && <>

      {/* ── Alerta sin biométrico ────────────────────────────────────────── */}
      {metaSiap?.sinBiometrico && (
        <div className="card" style={{ marginBottom: 12, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.07)", color: "#fbbf24", fontSize: "0.82rem" }}>
          ⚠ Sin datos de fichajes: {metaSiap.dbError}
        </div>
      )}

      {/* ── Resumen SIAP ────────────────────────────────────────────────── */}
      {metaSiap && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          {[
            { label: "Días en SIAP",       value: metaSiap.total,                                    color: "#e2e8f0" },
            { label: "Con fichaje",         value: metaSiap.conFichaje,                               color: "#22c55e" },
            { label: "Sin fichaje",         value: metaSiap.sinFichaje,                               color: "#ef4444" },
            ...(metaSiap.enMinisterio  !== null ? [{ label: "En Ministerio",     value: metaSiap.enMinisterio,  color: "#60a5fa" }] : []),
            ...(metaSiap.sinMinisterio !== null ? [{ label: "Sin en Ministerio", value: metaSiap.sinMinisterio, color: "#f97316" }] : []),
          ].map(t => (
            <div key={t.label} className="card" style={{ minWidth: 130, flex: "0 0 auto", padding: "10px 16px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: t.color }}>{t.value}</div>
              <div className="muted" style={{ fontSize: "0.72rem" }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filtros SIAP ────────────────────────────────────────────────── */}
      {loadedSiap && (
        <div className="card" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <select
            value={sfFiltroDni}
            onChange={e => setSfFiltroDni(e.target.value)}
            style={{ ...selectStyle, width: 240 }}
          >
            <option value="">— Todas las personas —</option>
            {sfPersonasUnicas.map(([dni, nombre]) => (
              <option key={dni} value={dni}>{nombre} ({dni})</option>
            ))}
          </select>
          <input
            className="input" placeholder="Buscar nombre / DNI / fecha…"
            value={sfBusqueda} onChange={e => setSfBusqueda(e.target.value)}
            style={{ width: 200 }}
          />
          {/* Nov. SIAP */}
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Nov. SIAP:</span>
            <select
              value={sfFiltroNovSiap}
              onChange={e => setSfFiltroNovSiap(e.target.value)}
              style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.75rem" }}
            >
              <option value="">Todas</option>
              {sfNovedadesSiapUnicas.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {/* Justificado */}
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Justificado:</span>
            {(["todos", "SI", "NO"] as const).map(v => (
              <button key={v} type="button"
                className={`btn${sfFiltroJust === v ? " primary" : ""}`}
                style={{ fontSize: "0.75rem", padding: "4px 10px", marginRight: 4 }}
                onClick={() => setSfFiltroJust(v)}>
                {v === "todos" ? "Todos" : v}
              </button>
            ))}
          </div>
          {/* En Ministerio */}
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Ministerio:</span>
            {(["todos", "con", "sin"] as const).map(v => (
              <button key={v} type="button"
                className={`btn${sfFiltroMin === v ? " primary" : ""}`}
                style={{ fontSize: "0.75rem", padding: "4px 10px", marginRight: 4 }}
                onClick={() => setSfFiltroMin(v)}>
                {v === "todos" ? "Todos" : v === "con" ? "En Ministerio" : "Sin en Min."}
              </button>
            ))}
          </div>
          {/* Fichaje */}
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Fichaje:</span>
            {(["todos", "con", "sin"] as const).map(v => (
              <button key={v} type="button"
                className={`btn${sfFiltroFichaje === v ? " primary" : ""}`}
                style={{ fontSize: "0.75rem", padding: "4px 10px", marginRight: 4 }}
                onClick={() => setSfFiltroFichaje(v)}>
                {v === "todos" ? "Todos" : v === "con" ? "Fichó" : "No fichó"}
              </button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
            {sfRowsFiltradas.length} fila{sfRowsFiltradas.length !== 1 ? "s" : ""}
          </span>
          <button
            className="btn" type="button"
            disabled={sfRowsFiltradas.length === 0}
            onClick={exportarSiap}
            style={{ fontSize: "0.75rem", padding: "4px 12px", whiteSpace: "nowrap" }}
          >
            📥 Exportar Excel
          </button>
        </div>
      )}

      {/* ── Tabla SIAP-Fichajes ──────────────────────────────────────────── */}
      {loadedSiap && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["DNI", "Nombre", "Fecha", "Día", "Novedad SIAP", "Justif.", "¿Debía venir?", "En Min.", "Nov. Ministerio", "¿Fichó?", "Entrada", "Salida"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sfRowsFiltradas.length === 0 ? (
                  <tr><td colSpan={12} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin resultados.</td></tr>
                ) : sfRowsFiltradas.map((r, i) => {
                  const badgeMin: React.CSSProperties = r.enMinisterio === null
                    ? { background: "rgba(100,116,139,0.1)", color: "#64748b", border: "1px solid rgba(100,116,139,0.2)" }
                    : r.enMinisterio
                      ? { background: "rgba(96,165,250,0.18)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.35)" }
                      : { background: "rgba(249,115,22,0.18)", color: "#f97316", border: "1px solid rgba(249,115,22,0.35)" };
                  const badgeJust: React.CSSProperties = r.justificadoSiap === "SI"
                    ? { background: "rgba(34,197,94,0.18)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.35)" }
                    : r.justificadoSiap === "NO"
                      ? { background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }
                      : { background: "rgba(100,116,139,0.1)", color: "#64748b", border: "1px solid rgba(100,116,139,0.2)" };
                  return (
                    <tr key={`${r.dni}-${r.fecha}-${i}`}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                        <span
                          style={{ color: "#60a5fa", cursor: "pointer", textDecoration: "underline" }}
                          onClick={() => abrirModal(r.dni, r.nombre)}
                        >{r.dni}</span>
                      </td>
                      <td style={{ padding: "8px 12px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.nombre}>{r.nombre}</td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
                      <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{r.diaSemana}</td>
                      <td style={{ padding: "8px 12px", fontSize: "0.78rem", color: "#a5b4fc", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.novedadSiap}>{r.novedadSiap || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ ...badge, ...badgeJust }}>
                          {r.justificadoSiap || "—"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ ...badge, ...badgeDebia(r.debiaVenir) }}>
                          {r.debiaVenir === true ? "Sí" : r.debiaVenir === false ? "No" : "—"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ ...badge, ...badgeMin }}>
                          {r.enMinisterio === null ? "—" : r.enMinisterio ? "Sí" : "No"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: "0.78rem", color: "#cbd5e1", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.novedadMinisterio}>{r.novedadMinisterio || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ ...badge, ...badgeFichaje(r.tieneFichaje) }}>
                          {r.tieneFichaje ? "Sí" : "No"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", color: r.entrada ? "#22c55e" : "#64748b" }}>{r.entrada ?? "—"}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", color: r.salida  ? "#60a5fa" : "#64748b" }}>{r.salida  ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loadedSiap && !loadingSiap && (
        <div className="card" style={{ textAlign: "center", color: "#64748b", padding: 28, marginBottom: 24 }}>
          Seleccioná el archivo SIAP y presioná <strong>Cargar</strong>.
        </div>
      )}

      </>}

      {/* ── Modal agente-mes ──────────────────────────────────────────────── */}
      {modalDni && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setModalDni(null)}
        >
          <div
            style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, width: "min(95vw, 780px)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#e2e8f0" }}>{modalNombre || modalDni}</div>
                <div style={{ fontSize: "0.75rem", color: "#64748b" }}>DNI {modalDni} · {periodo}</div>
              </div>
              <button onClick={() => setModalDni(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ overflowY: "auto", padding: "0 0 12px" }}>
              {modalLoading ? (
                <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Cargando…</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      {["Fecha","Día","Novedad SIAP","Novedad Ministerio","Horario","Entrada","Salida"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#0f172a" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modalDias.map((d, i) => {
                      const esAusente = d.esAusente;
                      const rowBg = esAusente
                        ? "rgba(234,179,8,0.12)"
                        : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)";
                      const novSiapTxt = d.novedadesSiap.map(n => n.novedad + (n.justificado ? ` (${n.justificado})` : "")).join(" / ") || "—";
                      const novMinTxt  = d.novedadesMin.join(" / ") || "—";
                      return (
                        <tr key={d.fecha} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: rowBg }}>
                          <td style={{ padding: "7px 12px", whiteSpace: "nowrap", fontWeight: esAusente ? 600 : 400, color: esAusente ? "#eab308" : "#e2e8f0" }}>{fmtFecha(d.fecha)}</td>
                          <td style={{ padding: "7px 12px", color: "#94a3b8" }}>{d.diaSemana}</td>
                          <td style={{ padding: "7px 12px", color: esAusente ? "#eab308" : "#a5b4fc", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={novSiapTxt}>{novSiapTxt}</td>
                          <td style={{ padding: "7px 12px", color: "#cbd5e1", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={novMinTxt}>{novMinTxt}</td>
                          <td style={{ padding: "7px 12px", fontFamily: "monospace", color: d.horarioEntrada ? "#fb923c" : "#475569" }}>{d.horarioEntrada ?? "—"}</td>
                          <td style={{ padding: "7px 12px", fontFamily: "monospace", color: d.entrada ? "#22c55e" : "#475569" }}>{d.entrada ?? "—"}</td>
                          <td style={{ padding: "7px 12px", fontFamily: "monospace", color: d.salida  ? "#60a5fa" : "#475569" }}>{d.salida  ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

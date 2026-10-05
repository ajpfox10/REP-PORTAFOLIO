// src/pages/AusenciasConFichajesPage/AusentesPorFechaTab.tsx
// Pestaña "Ausentes por fecha": ausentes de un día o de un rango (puede cruzar meses),
// juntando las dos fuentes:
//   - Ministerio: 28-INASISTENCIA        (/asistencia/ausentes28?desde&hasta)
//   - SIAP: novedades AUSENTE ...        (/asistencia/siap-fichajes?desde&hasta)
// Una fila por agente+día; muestra de qué fuente sale, fichaje, horario,
// licencia de la médica de Salud Laboral y turno asignado con la médica.

import React, { useState, useCallback } from "react";
import { useToast } from "../../ui/toast";
import { apiFetch } from "../../api/http";
import { exportToExcel } from "../../utils/export";
import { LicMedica, Estado, ESTADO_INFO, fmtFecha, Becado, BadgeBaja } from "./LicenciasMedicasTab";

interface Props {
  ministerioFile: string;
  siapFile: string;
  horariosFile: string;
}

interface TurnoSL {
  id: number;
  dni: number;
  fecha_turno: string;
  hora_turno: string | null;
  fecha_desde: string;
  fecha_hasta: string;
}

type Fuente = "ambos" | "ministerio" | "siap";

interface FilaFecha {
  dni: string;
  nombre: string;
  fecha: string;
  diaSemana: string;
  fuente: Fuente;
  novedadMinisterio: string;
  novedadSiap: string;
  justificado: "SI" | "NO" | "";
  debiaVenir: boolean | null;
  tieneFichaje: boolean;
  entrada: string | null;
  salida: string | null;
  licMedica: LicMedica | null;
  becado: Becado;
  turno: TurnoSL | null;
  estado: Estado;
}

const FUENTE_INFO: Record<Fuente, { label: string; color: string }> = {
  ambos:      { label: "Ministerio + SIAP", color: "#a5b4fc" },
  ministerio: { label: "Solo Ministerio",   color: "#60a5fa" },
  siap:       { label: "Solo SIAP",         color: "#f97316" },
};

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AusentesPorFechaTab({ ministerioFile, siapFile, horariosFile }: Props) {
  const { error: toastError } = useToast();

  const [modo, setModo]       = useState<"dia" | "rango">("dia");
  const [desde, setDesde]     = useState(hoyISO());
  const [hasta, setHasta]     = useState(hoyISO());
  const [loading, setLoading] = useState(false);
  const [filas, setFilas]     = useState<FilaFecha[] | null>(null);
  const [avisos, setAvisos]   = useState<string[]>([]);
  const [consultado, setConsultado] = useState<{ desde: string; hasta: string } | null>(null);

  const [filtroFuente, setFiltroFuente]   = useState<"todos" | Fuente>("todos");
  const [filtroEstado, setFiltroEstado]   = useState<"todos" | Estado>("todos");
  const [filtroFichaje, setFiltroFichaje] = useState<"todos" | "con" | "sin">("todos");
  const [filtroDebia, setFiltroDebia]     = useState<"todos" | "si">("todos");
  const [busqueda, setBusqueda]           = useState("");

  const buscar = useCallback(async () => {
    const d = desde;
    const h = modo === "dia" ? desde : hasta;
    if (!d || !h) { toastError("Falta la fecha"); return; }
    if (h < d)    { toastError("Rango inválido", "\"Hasta\" es anterior a \"desde\""); return; }
    if (!ministerioFile && !siapFile) { toastError("Faltan archivos", "Elegí el archivo Ministerio y/o SIAP"); return; }

    setLoading(true);
    const params = new URLSearchParams({ desde: d, hasta: h });
    if (ministerioFile) params.set("ministerioFile", ministerioFile);
    if (siapFile)       params.set("siapFile", siapFile);
    if (horariosFile)   params.set("horariosFile", horariosFile);

    const [rMin, rSiap, rTurnos] = await Promise.allSettled([
      ministerioFile ? apiFetch<any>(`/asistencia/ausentes28?${params}`)   : Promise.resolve(null),
      siapFile       ? apiFetch<any>(`/asistencia/siap-fichajes?${params}`) : Promise.resolve(null),
      apiFetch<any>(`/turnos-salud-laboral?desde=${d}&hasta=${h}`),
    ]);

    const msgs: string[] = [];
    const datos = (r: PromiseSettledResult<any>, nombre: string): any[] => {
      if (r.status === "rejected") { msgs.push(`${nombre}: ${r.reason?.message ?? "error"}`); return []; }
      if (r.value == null) { msgs.push(`${nombre}: sin archivo elegido`); return []; }
      if (!r.value.ok) { msgs.push(`${nombre}: ${r.value.error ?? "error"}`); return []; }
      if (r.value.meta?.dbError) msgs.push(`Fichajes: ${r.value.meta.dbError}`);
      return r.value.data ?? [];
    };
    const minRows  = datos(rMin, "Ministerio");
    const siapRows = datos(rSiap, "SIAP");
    const turnos: TurnoSL[] = rTurnos.status === "fulfilled" && rTurnos.value?.ok ? rTurnos.value.data ?? [] : [];
    if (rTurnos.status !== "fulfilled" || !rTurnos.value?.ok) msgs.push("Turnos con la médica: no se pudieron leer");

    // ── Unir ambas fuentes por agente+día ──────────────────────────────────
    const map = new Map<string, Omit<FilaFecha, "turno" | "estado">>();
    for (const r of minRows) {
      map.set(`${r.dni}|${r.fecha}`, {
        dni: r.dni, nombre: r.nombre, fecha: r.fecha, diaSemana: r.diaSemana,
        fuente: "ministerio",
        novedadMinisterio: r.novedadMinisterio || "",
        novedadSiap: r.novedadSiap || "",
        justificado: r.siapJustificada === true ? "SI" : r.siapJustificada === false ? "NO" : "",
        debiaVenir: r.debiaVenir ?? null,
        tieneFichaje: !!r.tieneFichaje, entrada: r.entrada ?? null, salida: r.salida ?? null,
        licMedica: r.licMedica ?? null,
        becado: r.becado ?? null,
      });
    }
    for (const r of siapRows) {
      const key = `${r.dni}|${r.fecha}`;
      const prev = map.get(key);
      if (prev) {
        prev.fuente = "ambos";
        if (!prev.novedadSiap) prev.novedadSiap = r.novedadSiap || "";
        if (!prev.justificado) prev.justificado = r.justificadoSiap === "SI" ? "SI" : r.justificadoSiap ? "NO" : "";
        if (prev.debiaVenir === null) prev.debiaVenir = r.debiaVenir ?? null;
        if (!prev.licMedica) prev.licMedica = r.licMedica ?? null;
        if (!prev.nombre) prev.nombre = r.nombre;
        if (!prev.becado) prev.becado = r.becado ?? null;
      } else {
        map.set(key, {
          dni: r.dni, nombre: r.nombre, fecha: r.fecha, diaSemana: r.diaSemana,
          fuente: "siap",
          novedadMinisterio: r.novedadMinisterio || "",
          novedadSiap: r.novedadSiap || "",
          justificado: r.justificadoSiap === "SI" ? "SI" : r.justificadoSiap ? "NO" : "",
          debiaVenir: r.debiaVenir ?? null,
          tieneFichaje: !!r.tieneFichaje, entrada: r.entrada ?? null, salida: r.salida ?? null,
          licMedica: r.licMedica ?? null,
          becado: r.becado ?? null,
        });
      }
    }

    // Solo becados: los que se ven/cargan en Reconocimientos de Salud Laboral
    const res: FilaFecha[] = [...map.values()].filter(f => f.becado).map(f => {
      const turno = f.licMedica ? null
        : turnos.find(t => String(t.dni) === f.dni && t.fecha_desde <= f.fecha && f.fecha <= t.fecha_hasta) ?? null;
      const estado: Estado = f.licMedica ? "cubierto" : turno ? "turno" : "sin";
      return { ...f, turno, estado };
    }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));

    setFilas(res);
    setAvisos([...new Set(msgs)]);
    setConsultado({ desde: d, hasta: h });
    setLoading(false);
  }, [modo, desde, hasta, ministerioFile, siapFile, horariosFile, toastError]);

  const filtradas = (filas ?? []).filter(f => {
    if (filtroFuente !== "todos" && f.fuente !== filtroFuente) return false;
    if (filtroEstado !== "todos" && f.estado !== filtroEstado) return false;
    if (filtroFichaje === "con" && !f.tieneFichaje) return false;
    if (filtroFichaje === "sin" &&  f.tieneFichaje) return false;
    if (filtroDebia === "si" && f.debiaVenir !== true) return false;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      return f.nombre.toLowerCase().includes(q) || f.dni.includes(q) || f.fecha.includes(q);
    }
    return true;
  });

  const resumen = React.useMemo(() => {
    const fs = filas ?? [];
    return {
      dias:       fs.length,
      agentes:    new Set(fs.map(f => f.dni)).size,
      ambos:      fs.filter(f => f.fuente === "ambos").length,
      ministerio: fs.filter(f => f.fuente === "ministerio").length,
      siap:       fs.filter(f => f.fuente === "siap").length,
      ficho:      fs.filter(f => f.tieneFichaje).length,
      sinCob:     fs.filter(f => f.estado === "sin").length,
    };
  }, [filas]);

  const exportar = () => {
    if (!consultado) return;
    exportToExcel(`ausentes_${consultado.desde}_${consultado.hasta}`, filtradas.map(f => ({
      DNI:                 f.dni,
      Nombre:              f.nombre,
      Fecha:               fmtFecha(f.fecha),
      Día:                 f.diaSemana,
      Fuente:              FUENTE_INFO[f.fuente].label,
      "Novedad Ministerio": f.novedadMinisterio || "—",
      "Novedad SIAP":      f.novedadSiap || "—",
      Justificado:         f.justificado || "—",
      "Debía venir":       f.debiaVenir === true ? "Sí" : f.debiaVenir === false ? "No" : "Sin info",
      "Fichó":             f.tieneFichaje ? "Sí" : "No",
      Entrada:             f.entrada ?? "",
      Salida:              f.salida ?? "",
      "Licencia médica":   f.licMedica ? [f.licMedica.tipo, f.licMedica.resultado].filter(Boolean).join(" · ") || "Sí" : "",
      "Turno médica":      f.turno ? `${fmtFecha(f.turno.fecha_turno)}${f.turno.hora_turno ? " " + f.turno.hora_turno : ""}` : "",
      Estado:              ESTADO_INFO[f.estado].label.replace(/^\S+\s/, ""),
      Becado:              f.becado === "BAJA" ? "Dado de baja" : "Activo",
    })));
  };

  // ── Estilos ───────────────────────────────────────────────────────────────
  const badge: React.CSSProperties = { display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" };
  const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 12px" };
  const lbl: React.CSSProperties = { fontSize: "0.72rem", marginBottom: 4, display: "block" };
  const btnChico: React.CSSProperties = { fontSize: "0.75rem", padding: "4px 10px", whiteSpace: "nowrap" };

  const grupoBotones = <T extends string>(titulo: string, valor: T, set: (v: T) => void, opciones: [T, string][]) => (
    <div>
      <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>{titulo}:</span>
      {opciones.map(([v, l]) => (
        <button key={v} type="button" className={`btn${valor === v ? " primary" : ""}`}
          style={{ ...btnChico, marginRight: 4 }} onClick={() => set(v)}>{l}</button>
      ))}
    </div>
  );

  return (
    <>
      {/* ── Selección de fecha ────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <div>
          <span className="muted" style={lbl}>Buscar por</span>
          <button type="button" className={`btn${modo === "dia" ? " primary" : ""}`} style={{ ...btnChico, marginRight: 4 }} onClick={() => setModo("dia")}>Un día</button>
          <button type="button" className={`btn${modo === "rango" ? " primary" : ""}`} style={btnChico} onClick={() => setModo("rango")}>Rango</button>
        </div>
        <div>
          <label htmlFor="apf-desde" className="muted" style={lbl}>{modo === "dia" ? "Fecha" : "Desde"}</label>
          <input id="apf-desde" type="date" className="input" value={desde}
            onChange={e => { setDesde(e.target.value); if (modo === "rango" && hasta < e.target.value) setHasta(e.target.value); }} />
        </div>
        {modo === "rango" && (
          <div>
            <label htmlFor="apf-hasta" className="muted" style={lbl}>Hasta</label>
            <input id="apf-hasta" type="date" className="input" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} />
          </div>
        )}
        <button type="button" className="btn primary" onClick={buscar} disabled={loading} style={{ height: 36 }}>
          {loading ? "Buscando…" : "🔍 Buscar ausentes"}
        </button>
        {consultado && !loading && (
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            {consultado.desde === consultado.hasta
              ? `Ausentes del ${fmtFecha(consultado.desde)}`
              : `Ausentes del ${fmtFecha(consultado.desde)} al ${fmtFecha(consultado.hasta)}`}
          </span>
        )}
      </div>

      {avisos.length > 0 && (
        <div className="card" style={{ marginBottom: 12, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.07)", color: "#fbbf24", fontSize: "0.82rem" }}>
          {avisos.map(a => <div key={a}>⚠ {a}</div>)}
        </div>
      )}

      {/* ── Resumen ───────────────────────────────────────────────────────── */}
      {filas && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          {[
            { label: "Días ausentes becados",  value: resumen.dias,       color: "#e2e8f0" },
            { label: "Becados",                value: resumen.agentes,    color: "#e2e8f0" },
            { label: "Ministerio + SIAP",      value: resumen.ambos,      color: "#a5b4fc" },
            { label: "Solo Ministerio",        value: resumen.ministerio, color: "#60a5fa" },
            { label: "Solo SIAP",              value: resumen.siap,       color: "#f97316" },
            { label: "Fichó igual",            value: resumen.ficho,      color: "#22c55e" },
            { label: "Sin licencia ni turno",  value: resumen.sinCob,     color: "#ef4444" },
          ].map(t => (
            <div key={t.label} className="card" style={{ minWidth: 120, flex: "0 0 auto", padding: "10px 16px" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: t.color }}>{t.value}</div>
              <div className="muted" style={{ fontSize: "0.72rem" }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      {filas && (
        <div className="card" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input className="input" placeholder="Buscar nombre / DNI / fecha…" aria-label="Buscar"
            value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ width: 200, maxWidth: "100%" }} />
          {grupoBotones("Fuente", filtroFuente, setFiltroFuente,
            [["todos", "Todas"], ["ambos", "Ambas"], ["ministerio", "Solo Min."], ["siap", "Solo SIAP"]])}
          {grupoBotones("Licencia", filtroEstado, setFiltroEstado,
            [["todos", "Todos"], ["sin", "Sin cobertura"], ["turno", "Con turno"], ["cubierto", "Cubiertos"]])}
          {grupoBotones("Fichaje", filtroFichaje, setFiltroFichaje, [["todos", "Todos"], ["con", "Fichó"], ["sin", "No fichó"]])}
          {grupoBotones("Horario", filtroDebia, setFiltroDebia, [["todos", "Todos"], ["si", "Solo debía venir"]])}
          <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
            {filtradas.length} fila{filtradas.length !== 1 ? "s" : ""}
          </span>
          <button className="btn" type="button" disabled={filtradas.length === 0} onClick={exportar} style={btnChico}>📥 Exportar Excel</button>
        </div>
      )}

      {/* ── Tabla ─────────────────────────────────────────────────────────── */}
      {filas && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["DNI", "Nombre", "Fecha", "Día", "Fuente", "Nov. Ministerio", "Nov. SIAP", "¿Debía venir?", "¿Fichó?", "Entrada", "Salida", "Licencia / turno médica"].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 ? (
                  <tr><td colSpan={12} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin becados ausentes para esa fecha.</td></tr>
                ) : filtradas.map((f, i) => {
                  const e = ESTADO_INFO[f.estado];
                  return (
                    <tr key={`${f.dni}-${f.fecha}`}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                      <td style={{ ...td, fontFamily: "monospace", color: "#94a3b8" }}>{f.dni}</td>
                      <td style={{ ...td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.nombre}>{f.nombre}{f.becado === "BAJA" && <BadgeBaja />}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtFecha(f.fecha)}</td>
                      <td style={{ ...td, color: "#94a3b8" }}>{f.diaSemana}</td>
                      <td style={{ ...td, color: FUENTE_INFO[f.fuente].color, fontWeight: 600, whiteSpace: "nowrap", fontSize: "0.78rem" }}>{FUENTE_INFO[f.fuente].label}</td>
                      <td style={{ ...td, fontSize: "0.78rem", color: "#cbd5e1" }}>{f.novedadMinisterio || <span style={{ color: "#475569" }}>—</span>}</td>
                      <td style={{ ...td, fontSize: "0.78rem" }}>
                        {f.novedadSiap ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ color: "#a5b4fc" }}>{f.novedadSiap}</span>
                            {f.justificado === "SI" && <span title="Justificada" style={{ fontSize: "0.68rem", fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(34,197,94,0.18)", color: "#22c55e" }}>J</span>}
                            {f.justificado === "NO" && <span title="No justificada" style={{ fontSize: "0.68rem", fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(239,68,68,0.18)", color: "#ef4444" }}>NJ</span>}
                          </span>
                        ) : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={td}>{f.debiaVenir === true ? "Sí" : f.debiaVenir === false ? "No" : <span style={{ color: "#64748b" }}>—</span>}</td>
                      <td style={{ ...td, color: f.tieneFichaje ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{f.tieneFichaje ? "Sí" : "No"}</td>
                      <td style={{ ...td, fontFamily: "monospace", color: f.entrada ? "#22c55e" : "#64748b" }}>{f.entrada ?? "—"}</td>
                      <td style={{ ...td, fontFamily: "monospace", color: f.salida ? "#60a5fa" : "#64748b" }}>{f.salida ?? "—"}</td>
                      <td style={{ ...td, fontSize: "0.78rem" }}>
                        <span style={{ ...badge, color: e.color, background: e.bg, border: `1px solid ${e.border}` }}>{e.label}</span>
                        {f.licMedica && (
                          <div className="muted" style={{ marginTop: 3 }}>
                            {[f.licMedica.tipo, f.licMedica.resultado].filter(Boolean).join(" · ")} {fmtFecha(f.licMedica.desde)} al {f.licMedica.hasta ? fmtFecha(f.licMedica.hasta) : "…"}
                          </div>
                        )}
                        {f.turno && (
                          <div className="muted" style={{ marginTop: 3 }}>
                            📅 {fmtFecha(f.turno.fecha_turno)}{f.turno.hora_turno ? ` ${f.turno.hora_turno}` : ""}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!filas && !loading && (
        <div className="card" style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
          Elegí un día o un rango y presioná <strong>Buscar ausentes</strong>.
        </div>
      )}
    </>
  );
}

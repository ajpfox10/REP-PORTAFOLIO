// src/pages/AusenciasConFichajesPage/LicenciasMedicasTab.tsx
// Pestaña "Ausentes vs Licencias Médicas": cada día ausente (cod. 28) cruzado con
//   - la licencia que dio la médica de Salud Laboral (grilla Reconocimientos → reconocimientos_medicos,
//     viene ya cruzada en /asistencia/ausentes28 como `licMedica`)
//   - el turno asignado con la médica para cubrir ese rango (tabla turnos_salud_laboral)
// Estado: 🟢 cubierto por licencia · 🟡 turno asignado (falta licencia) · 🔴 sin licencia ni turno

import React, { useState, useEffect, useCallback } from "react";
import { useToast } from "../../ui/toast";
import { apiFetch } from "../../api/http";
import { exportToExcel } from "../../utils/export";

export interface LicMedica {
  id: number;
  desde: string;
  hasta: string | null;
  tipo: string | null;
  resultado: string | null;
}

export interface AusenteLicRow {
  dni: string;
  nombre: string;
  fecha: string;
  diaSemana: string;
  debiaVenir: boolean | null;
  tieneFichaje: boolean;
  licMedica?: LicMedica | null;
  becado?: Becado;
}

// Población de Reconocimientos Médicos (Salud Laboral): solo becados (ley 6–13).
// ACTIVO → se le puede asignar turno; BAJA → ex-becado, solo consulta; null → no entra en la comparación.
export type Becado = "ACTIVO" | "BAJA" | null;

export function BadgeBaja() {
  return (
    <span title="Becado dado de baja: solo consulta" style={{ display: "inline-block", marginLeft: 6, padding: "0 6px", borderRadius: 4, fontSize: "0.65rem", fontWeight: 700, background: "rgba(100,116,139,0.25)", color: "#94a3b8", border: "1px solid rgba(100,116,139,0.4)" }}>
      BAJA
    </span>
  );
}

interface TurnoSL {
  id: number;
  dni: number;
  nombre: string | null;
  fecha_turno: string;
  hora_turno: string | null;
  fecha_desde: string;
  fecha_hasta: string;
  observaciones: string | null;
}

export type Estado = "cubierto" | "turno" | "sin";

interface FormTurno {
  id: number | null;
  dni: string;
  nombre: string;
  fecha_turno: string;
  hora_turno: string;
  fecha_desde: string;
  fecha_hasta: string;
  observaciones: string;
}

const FORM_VACIO: FormTurno = { id: null, dni: "", nombre: "", fecha_turno: "", hora_turno: "", fecha_desde: "", fecha_hasta: "", observaciones: "" };

export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangoPeriodo(periodo: string): { desde: string; hasta: string } | null {
  const m = periodo.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  const ultimo = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { desde: `${m[1]}-${m[2]}-01`, hasta: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, "0")}` };
}

export const ESTADO_INFO: Record<Estado, { label: string; color: string; bg: string; border: string }> = {
  cubierto: { label: "🟢 Cubierto por licencia", color: "#22c55e", bg: "rgba(34,197,94,0.15)",  border: "rgba(34,197,94,0.35)" },
  turno:    { label: "🟡 Turno asignado",        color: "#fbbf24", bg: "rgba(251,191,36,0.15)", border: "rgba(251,191,36,0.35)" },
  sin:      { label: "🔴 Sin licencia ni turno", color: "#ef4444", bg: "rgba(239,68,68,0.15)",  border: "rgba(239,68,68,0.35)" },
};

interface Props {
  rows: AusenteLicRow[];
  loaded: boolean;
  loading: boolean;
  periodo: string;
}

export function LicenciasMedicasTab({ rows, loaded, loading, periodo }: Props) {
  const { ok: toastOk, error: toastError } = useToast();

  const [turnos, setTurnos]           = useState<TurnoSL[]>([]);
  const [loadingTurnos, setLoadingT]  = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<"todos" | Estado>("todos");
  const [filtroDebia, setFiltroDebia] = useState<"todos" | "si">("todos");
  const [filtroDni, setFiltroDni]     = useState("");
  const [busqueda, setBusqueda]       = useState("");
  const [form, setForm]               = useState<FormTurno | null>(null);
  const [guardando, setGuardando]     = useState(false);

  // ── Turnos del período ────────────────────────────────────────────────────
  const cargarTurnos = useCallback(async () => {
    setLoadingT(true);
    try {
      const params = new URLSearchParams();
      const r = rangoPeriodo(periodo);
      if (r) { params.set("desde", r.desde); params.set("hasta", r.hasta); }
      const res = await apiFetch<{ ok: boolean; data: TurnoSL[] }>(`/turnos-salud-laboral?${params}`);
      if (!res.ok) throw new Error((res as any).error ?? "Error");
      setTurnos(res.data ?? []);
    } catch (e: any) {
      toastError("Turnos", e?.message ?? "No se pudieron cargar los turnos");
    } finally {
      setLoadingT(false);
    }
  }, [periodo, toastError]);

  useEffect(() => { cargarTurnos(); }, [cargarTurnos]);

  // ── Cruce: estado por día ─────────────────────────────────────────────────
  const turnoDe = useCallback((dni: string, fecha: string): TurnoSL | null =>
    turnos.find(t => String(t.dni) === dni && t.fecha_desde <= fecha && fecha <= t.fecha_hasta) ?? null,
  [turnos]);

  // Solo becados: los que se ven/cargan en Reconocimientos de Salud Laboral
  const filas = React.useMemo(() => rows.filter(r => r.becado).map(r => {
    const turno = r.licMedica ? null : turnoDe(r.dni, r.fecha);
    const estado: Estado = r.licMedica ? "cubierto" : turno ? "turno" : "sin";
    return { ...r, turno, estado };
  }), [rows, turnoDe]);

  const resumen = React.useMemo(() => {
    const sinCob = filas.filter(f => f.estado === "sin");
    return {
      total:      filas.length,
      cubierto:   filas.filter(f => f.estado === "cubierto").length,
      turno:      filas.filter(f => f.estado === "turno").length,
      sin:        sinCob.length,
      agentesSin: new Set(sinCob.map(f => f.dni)).size,
    };
  }, [filas]);

  const personas = React.useMemo(() => {
    const map = new Map<string, string>();
    filas.forEach(r => { if (!map.has(r.dni)) map.set(r.dni, r.nombre); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [filas]);

  const filtradas = filas.filter(f => {
    if (filtroEstado !== "todos" && f.estado !== filtroEstado) return false;
    if (filtroDebia === "si" && f.debiaVenir !== true) return false;
    if (filtroDni && f.dni !== filtroDni) return false;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      return f.nombre.toLowerCase().includes(q) || f.dni.includes(q) || f.fecha.includes(q);
    }
    return true;
  });

  // ── Asignar turno: propone el tramo de días ausentes consecutivos sin cobertura ──
  const abrirAsignar = (dni: string, nombre: string, fecha: string) => {
    const dias = new Set(filas.filter(f => f.dni === dni && f.estado === "sin").map(f => f.fecha));
    let desde = fecha, hasta = fecha;
    while (dias.has(sumarDias(desde, -1))) desde = sumarDias(desde, -1);
    while (dias.has(sumarDias(hasta, 1)))  hasta = sumarDias(hasta, 1);
    // El turno se pide después de la ausencia (hoy justifica ayer): fecha del turno = hoy por defecto
    setForm({ ...FORM_VACIO, dni, nombre, fecha_turno: hoyISO(), fecha_desde: desde, fecha_hasta: hasta });
  };

  const abrirEditar = (t: TurnoSL) => setForm({
    id: t.id, dni: String(t.dni), nombre: t.nombre ?? "",
    fecha_turno: t.fecha_turno, hora_turno: t.hora_turno ?? "",
    fecha_desde: t.fecha_desde, fecha_hasta: t.fecha_hasta, observaciones: t.observaciones ?? "",
  });

  const guardar = async () => {
    if (!form) return;
    if (!form.dni.replace(/\D/g, ""))        { toastError("Falta el DNI"); return; }
    if (!form.fecha_turno)                    { toastError("Falta la fecha del turno"); return; }
    if (!form.fecha_desde || !form.fecha_hasta) { toastError("Falta el rango a cubrir"); return; }
    if (form.fecha_hasta < form.fecha_desde)  { toastError("Rango inválido", "\"Hasta\" es anterior a \"desde\""); return; }
    setGuardando(true);
    try {
      const body = JSON.stringify({
        dni: form.dni.replace(/\D/g, ""), fecha_turno: form.fecha_turno, hora_turno: form.hora_turno || null,
        fecha_desde: form.fecha_desde, fecha_hasta: form.fecha_hasta, observaciones: form.observaciones || null,
      });
      const res = form.id
        ? await apiFetch<any>(`/turnos-salud-laboral/${form.id}`, { method: "PUT", body })
        : await apiFetch<any>("/turnos-salud-laboral", { method: "POST", body });
      if (!res?.ok) throw new Error(res?.error ?? "No se pudo guardar");
      toastOk(form.id ? "Turno actualizado" : "Turno asignado");
      setForm(null);
      await cargarTurnos();
    } catch (e: any) {
      toastError("Error", e?.message ?? "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (t: TurnoSL) => {
    if (!window.confirm(`¿Eliminar el turno de ${t.nombre || t.dni} del ${fmtFecha(t.fecha_turno)}?`)) return;
    try {
      const res = await apiFetch<any>(`/turnos-salud-laboral/${t.id}`, { method: "DELETE" });
      if (!res?.ok) throw new Error(res?.error ?? "No se pudo eliminar");
      toastOk("Turno eliminado");
      await cargarTurnos();
    } catch (e: any) {
      toastError("Error", e?.message ?? "No se pudo eliminar");
    }
  };

  const exportar = () => {
    exportToExcel(`ausentes_licencias_${periodo}`, filtradas.map(f => ({
      DNI:               f.dni,
      Nombre:            f.nombre,
      Fecha:             fmtFecha(f.fecha),
      Día:               f.diaSemana,
      "Debía venir":     f.debiaVenir === true ? "Sí" : f.debiaVenir === false ? "No" : "Sin info",
      "Fichó":           f.tieneFichaje ? "Sí" : "No",
      "Licencia médica": f.licMedica ? [f.licMedica.tipo, f.licMedica.resultado].filter(Boolean).join(" · ") || "Sí" : "",
      "Lic. desde":      fmtFecha(f.licMedica?.desde),
      "Lic. hasta":      fmtFecha(f.licMedica?.hasta),
      "Turno":           f.turno ? `${fmtFecha(f.turno.fecha_turno)}${f.turno.hora_turno ? " " + f.turno.hora_turno : ""}` : "",
      "Turno cubre":     f.turno ? `${fmtFecha(f.turno.fecha_desde)} al ${fmtFecha(f.turno.fecha_hasta)}` : "",
      Estado:            ESTADO_INFO[f.estado].label.replace(/^\S+\s/, ""),
      Becado:            f.becado === "BAJA" ? "Dado de baja" : "Activo",
    })));
  };

  // ── Estilos ───────────────────────────────────────────────────────────────
  const badge: React.CSSProperties = { display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" };
  const selectStyle: React.CSSProperties = {
    background: "rgba(15,23,42,0.9)", color: "var(--text)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8, padding: "6px 10px", fontSize: "0.82rem",
  };
  const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 12px" };
  const lbl: React.CSSProperties = { fontSize: "0.72rem", marginBottom: 4, display: "block" };
  const btnChico: React.CSSProperties = { fontSize: "0.75rem", padding: "4px 10px", whiteSpace: "nowrap" };

  return (
    <>
      {/* ── Resumen ───────────────────────────────────────────────────────── */}
      {loaded && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          {[
            { label: "Días ausentes becados",  value: resumen.total,      color: "#e2e8f0" },
            { label: "Cubiertos por licencia", value: resumen.cubierto,   color: "#22c55e" },
            { label: "Con turno asignado",     value: resumen.turno,      color: "#fbbf24" },
            { label: "Sin licencia ni turno",  value: resumen.sin,        color: "#ef4444" },
            { label: "Agentes sin cobertura",  value: resumen.agentesSin, color: "#f97316" },
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
          <select aria-label="Persona" value={filtroDni} onChange={e => setFiltroDni(e.target.value)} style={{ ...selectStyle, width: 240, maxWidth: "100%" }}>
            <option value="">— Todas las personas —</option>
            {personas.map(([dni, nombre]) => <option key={dni} value={dni}>{nombre} ({dni})</option>)}
          </select>
          <input className="input" placeholder="Buscar nombre / DNI / fecha…" aria-label="Buscar"
            value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ width: 200, maxWidth: "100%" }} />
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Estado:</span>
            {(["todos", "sin", "turno", "cubierto"] as const).map(v => (
              <button key={v} type="button" className={`btn${filtroEstado === v ? " primary" : ""}`}
                style={{ ...btnChico, marginRight: 4 }} onClick={() => setFiltroEstado(v)}>
                {v === "todos" ? "Todos" : v === "sin" ? "Sin cobertura" : v === "turno" ? "Con turno" : "Cubiertos"}
              </button>
            ))}
          </div>
          <div>
            <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Horario:</span>
            {(["todos", "si"] as const).map(v => (
              <button key={v} type="button" className={`btn${filtroDebia === v ? " primary" : ""}`}
                style={{ ...btnChico, marginRight: 4 }} onClick={() => setFiltroDebia(v)}>
                {v === "todos" ? "Todos" : "Solo debía venir"}
              </button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
            {filtradas.length} fila{filtradas.length !== 1 ? "s" : ""}
          </span>
          <button className="btn" type="button" disabled={filtradas.length === 0} onClick={exportar} style={btnChico}>
            📥 Exportar Excel
          </button>
        </div>
      )}

      {/* ── Tabla de cruce ────────────────────────────────────────────────── */}
      {loaded && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["DNI", "Nombre", "Fecha", "Día", "¿Debía venir?", "¿Fichó?", "Licencia médica", "Turno con la médica", "Estado", ""].map((h, i) => (
                    <th key={i} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin resultados.</td></tr>
                ) : filtradas.map((f, i) => {
                  const e = ESTADO_INFO[f.estado];
                  return (
                    <tr key={`${f.dni}-${f.fecha}-${i}`}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                      <td style={{ ...td, fontFamily: "monospace", color: "#94a3b8" }}>{f.dni}</td>
                      <td style={{ ...td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.nombre}>{f.nombre}{f.becado === "BAJA" && <BadgeBaja />}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtFecha(f.fecha)}</td>
                      <td style={{ ...td, color: "#94a3b8" }}>{f.diaSemana}</td>
                      <td style={td}>{f.debiaVenir === true ? "Sí" : f.debiaVenir === false ? "No" : <span style={{ color: "#64748b" }}>—</span>}</td>
                      <td style={{ ...td, color: f.tieneFichaje ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{f.tieneFichaje ? "Sí" : "No"}</td>
                      <td style={{ ...td, fontSize: "0.78rem" }}>
                        {f.licMedica ? (
                          <div>
                            <div style={{ color: "#c084fc", fontWeight: 600 }}>{[f.licMedica.tipo, f.licMedica.resultado].filter(Boolean).join(" · ") || "Reconocimiento"}</div>
                            <div className="muted">{fmtFecha(f.licMedica.desde)} al {f.licMedica.hasta ? fmtFecha(f.licMedica.hasta) : "…"}</div>
                          </div>
                        ) : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ ...td, fontSize: "0.78rem" }}>
                        {f.turno ? (
                          <div>
                            <div style={{ color: "#fbbf24", fontWeight: 600 }}>📅 {fmtFecha(f.turno.fecha_turno)}{f.turno.hora_turno ? ` ${f.turno.hora_turno}` : ""}</div>
                            <div className="muted">cubre {fmtFecha(f.turno.fecha_desde)} al {fmtFecha(f.turno.fecha_hasta)}</div>
                          </div>
                        ) : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={td}>
                        <span style={{ ...badge, color: e.color, background: e.bg, border: `1px solid ${e.border}` }}>{e.label}</span>
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {f.estado === "sin" && f.becado === "ACTIVO" && (
                          <button type="button" className="btn primary" style={btnChico} onClick={() => abrirAsignar(f.dni, f.nombre, f.fecha)}>
                            + Asignar turno
                          </button>
                        )}
                        {f.estado === "turno" && f.turno && f.becado === "ACTIVO" && (
                          <button type="button" className="btn" style={btnChico} onClick={() => abrirEditar(f.turno!)}>
                            ✏️ Turno
                          </button>
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

      {!loaded && !loading && (
        <div className="card" style={{ textAlign: "center", color: "#64748b", padding: 40, marginBottom: 16 }}>
          Seleccioná los archivos, el período y presioná <strong>Cargar</strong>.
        </div>
      )}

      {/* ── Turnos asignados en el período ────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", flexWrap: "wrap" }}>
          <strong style={{ fontSize: "0.9rem" }}>📅 Turnos con la médica de Salud Laboral</strong>
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            {loadingTurnos ? "cargando…" : `${turnos.length} en el período`}
          </span>
          <button type="button" className="btn" style={{ ...btnChico, marginLeft: "auto" }} onClick={() => setForm({ ...FORM_VACIO, fecha_turno: hoyISO() })}>
            + Nuevo turno
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["Fecha turno", "Hora", "DNI", "Nombre", "Rango a cubrir", "Observaciones", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {turnos.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>No hay turnos asignados en el período.</td></tr>
              ) : turnos.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtFecha(t.fecha_turno)}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{t.hora_turno ?? "—"}</td>
                  <td style={{ ...td, fontFamily: "monospace", color: "#94a3b8" }}>{t.dni}</td>
                  <td style={td}>{t.nombre || "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtFecha(t.fecha_desde)} al {fmtFecha(t.fecha_hasta)}</td>
                  <td style={{ ...td, maxWidth: 260, color: "#cbd5e1" }}>{t.observaciones || "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button type="button" className="btn" style={{ ...btnChico, marginRight: 4 }} onClick={() => abrirEditar(t)}>✏️</button>
                    <button type="button" className="btn" style={{ ...btnChico, color: "#ef4444" }} onClick={() => eliminar(t)}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal alta/edición de turno ───────────────────────────────────── */}
      {form && (
        <div onClick={() => !guardando && setForm(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="card" onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: "100%" }}>
            <h3 style={{ marginTop: 0, fontSize: "1rem" }}>{form.id ? "Editar turno" : "Asignar turno con la médica"}</h3>
            {form.nombre && <div className="muted" style={{ marginBottom: 10, fontSize: "0.82rem" }}>{form.nombre}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="tsl-dni" className="muted" style={lbl}>DNI</label>
                <input id="tsl-dni" className="input" value={form.dni} readOnly={!!form.nombre && !form.id}
                  onChange={e => setForm({ ...form, dni: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="tsl-fecha" className="muted" style={lbl}>Fecha del turno *</label>
                <input id="tsl-fecha" type="date" className="input" value={form.fecha_turno}
                  onChange={e => setForm({ ...form, fecha_turno: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="tsl-hora" className="muted" style={lbl}>Hora</label>
                <input id="tsl-hora" type="time" className="input" value={form.hora_turno}
                  onChange={e => setForm({ ...form, hora_turno: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="tsl-desde" className="muted" style={lbl}>Cubrir desde *</label>
                <input id="tsl-desde" type="date" className="input" value={form.fecha_desde}
                  onChange={e => setForm({ ...form, fecha_desde: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="tsl-hasta" className="muted" style={lbl}>Cubrir hasta *</label>
                <input id="tsl-hasta" type="date" className="input" value={form.fecha_hasta}
                  onChange={e => setForm({ ...form, fecha_hasta: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="tsl-obs" className="muted" style={lbl}>Observaciones</label>
                <textarea id="tsl-obs" className="input" rows={2} maxLength={500} value={form.observaciones}
                  onChange={e => setForm({ ...form, observaciones: e.target.value })} style={{ width: "100%", resize: "vertical" }} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" className="btn" disabled={guardando} onClick={() => setForm(null)}>Cancelar</button>
              <button type="button" className="btn primary" disabled={guardando} onClick={guardar}>
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

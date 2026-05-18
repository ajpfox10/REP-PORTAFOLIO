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
  ocupacion:             string;
  servicio:              string;
  fecha:                 string;
  diaSemana:             string;
  entrada:               string | null;
  salida:                string | null;
  horaEntradaProgramada: string | null;
  horaSalidaProgramada:  string | null;
  novedadSiap:           string;
  novedadMinisterio:     string;
  estado:                "SOSPECHOSO" | "SIN_SALIDA" | "SOLO_SALIDA" | "PRESENTE_SIN_ESTAR" | "SIN_FICHAJE" | "REQUIERE_REVISION" | "JUSTIFICADO" | "CON_SALIDA";
  fichajeInvertido:      boolean;
  salidaFaltante:        boolean;
  recMedico:             string | null;
}

interface SinHorarioAgente {
  dni:    string;
  nombre: string;
  upa:    string;
}

interface Meta {
  total:              number;
  sospechosos?:       number;
  sinSalida:          number;
  soloSalida?:        number;
  sinFichaje:         number;
  presentesSinEstar:  number;
  requiereRevision?:  number;
  justificados:       number;
  conSalida:          number;
  agentesConProblema: number;
  agentesInvertidos:  number;
  sinBiometrico:      boolean;
  dbError:            string | null;
}

interface AgenteRow {
  dni:                 string;
  nombre:              string;
  upa:                 string;
  sospechosos:         number;
  sinSalida:           number;
  soloSalida:          number;
  presentesSinEstar:   number;
  sinFichaje:          number;
}

interface AgenteInvertidoRow {
  dni:      string;
  nombre:   string;
  upa:      string;
  cantidad: number;
}

interface RegistroAgenteRow {
  dni:                string;
  nombre:             string;
  upa:                string;
  esGuardia:          boolean;
  servicio:           string;
  fechas:             string[];
  sinSalida:          number;
  soloSalida:         number;
  presentesSinEstar:  number;
  sinFichaje:         number;
  requiereRevision:   number;
  justificados:       number;
  conSalida:          number;
  invertidos:         number;
  total:              number;
}

interface FichoSinDeberRow {
  dni:            string;
  nombre:         string;
  upa:            string;
  esGuardia:      boolean;
  fecha:          string;
  diaSemana:      string;
  diasLaborables: string;
  entrada:        string | null;
  salida:         string | null;
}

interface FichoAgenteAgrupado {
  dni:            string;
  nombre:         string;
  upa:            string;
  esGuardia:      boolean;
  dias:           number;
  registros:      FichoSinDeberRow[];
}

interface MetaFichosindeber {
  total:         number;
  agentes:       number;
  sinBiometrico: boolean;
  dbError:       string | null;
}

interface RawFichajeRow {
  checktime: string;
  fecha:     string;
  hora:      string;
  checktype: number;
  tipoReal:  number;
  sn:        string;
  tipo:      "Entrada" | "Salida";
}

type Tab          = "registros" | "agentes" | "invertidos" | "fichosindeber" | "sinhorario" | "horarios";
type ModoConsulta = "fecha" | "periodo" | "rango";
type FiltroEstado = "todos" | "SOSPECHOSO" | "SIN_SALIDA" | "SOLO_SALIDA" | "PRESENTE_SIN_ESTAR" | "SIN_FICHAJE" | "REQUIERE_REVISION" | "JUSTIFICADO" | "CON_SALIDA";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtFecha(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const ESTADO_LABEL: Record<string, string> = {
  SOSPECHOSO:         "Sospechoso",
  SIN_SALIDA:         "Sin salida",
  SOLO_SALIDA:        "Solo salida",
  PRESENTE_SIN_ESTAR: "Presente sin estar",
  SIN_FICHAJE:        "Sin fichaje",
  REQUIERE_REVISION:  "Requiere revisión",
  JUSTIFICADO:        "Justificado",
  CON_SALIDA:         "Con salida",
};

const ESTADO_COLOR: Record<string, React.CSSProperties> = {
  SOSPECHOSO:         { background: "rgba(232,121,249,0.22)", color: "#e879f9", border: "1px solid rgba(232,121,249,0.45)" },
  SIN_SALIDA:         { background: "rgba(239,68,68,0.18)",   color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" },
  SOLO_SALIDA:        { background: "rgba(244,63,94,0.18)",   color: "#f43f5e", border: "1px solid rgba(244,63,94,0.35)" },
  PRESENTE_SIN_ESTAR: { background: "rgba(251,146,60,0.18)",  color: "#fb923c", border: "1px solid rgba(251,146,60,0.35)" },
  SIN_FICHAJE:        { background: "rgba(251,191,36,0.18)",  color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)" },
  REQUIERE_REVISION:  { background: "rgba(148,163,184,0.18)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.35)" },
  JUSTIFICADO:        { background: "rgba(99,102,241,0.18)",  color: "#818cf8", border: "1px solid rgba(99,102,241,0.35)" },
  CON_SALIDA:         { background: "rgba(34,197,94,0.18)",   color: "#22c55e", border: "1px solid rgba(34,197,94,0.35)" },
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
const RANGO_INVERTIDO = 120; // ±2 horas en minutos
// Debe coincidir con DOW_LABELS del backend: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
const DOW_LABELS_FE = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'] as const;

function getDowKey(fechaIso: string): string {
  return DOW_LABELS_FE[new Date(fechaIso + 'T00:00:00Z').getUTCDay()];
}

function timeDiffMinsFE(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  const diff = Math.abs(ah * 60 + am - (bh * 60 + bm));
  return Math.min(diff, 1440 - diff);
}

function addMinsFE(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = ((h * 60 + m + mins) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

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

// ── Modal fichajes de agente (Agentes c/ problema y Fichaje invertido) ────────
function AgentModal({ agente, rows, highlightInvertido = false, onClose, siapNovedades, horarioAgente }: {
  agente:            { dni: string; nombre: string; upa: string };
  rows:              SinSalidaRow[];
  highlightInvertido?: boolean;
  onClose:           () => void;
  siapNovedades?:    Array<{ novedad: string; desde: string; hasta: string }>;
  horarioAgente?:    { diasLaborables: string[]; horas: Record<string, { entrada: string | null; salida: string | null }> };
}) {
  const agentRows = rows
    .filter(r => r.dni === agente.dni)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.95)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 1100, maxHeight: "90vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{agente.nombre}</div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>DNI {agente.dni} &nbsp;·&nbsp; {agente.upa}</div>
          </div>
          <button className="btn" style={{ fontSize: "0.82rem", padding: "4px 12px" }} onClick={onClose}>Cerrar</button>
        </div>

        {/* Horario programado */}
        {horarioAgente && horarioAgente.diasLaborables.length > 0 && (
          <div style={{ padding: "8px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(34,197,94,0.03)", display: "flex", flexWrap: "wrap", gap: "6px 20px", alignItems: "center" }}>
            <span style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", flexBasis: "100%", marginBottom: 2 }}>
              Horario programado
            </span>
            {horarioAgente.diasLaborables.map(dia => {
              const h = horarioAgente.horas[dia];
              return (
                <span key={dia} style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  <span style={{ color: "#22c55e", fontWeight: 600 }}>{dia}</span>
                  {h?.entrada && h?.salida ? (
                    <span style={{ color: "#64748b" }}> {h.entrada}–{h.salida}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        )}

        {/* SIAP Novedades */}
        {siapNovedades && siapNovedades.length > 0 && (
          <div style={{ padding: "8px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(165,180,252,0.04)" }}>
            <div style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>SIAP — Novedades</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 24px" }}>
              {siapNovedades.map((n, i) => (
                <span key={i} style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  <span style={{ color: "#a5b4fc", fontWeight: 600 }}>{n.novedad}</span>
                  <span style={{ color: "#64748b" }}> {fmtFecha(n.desde)} → {fmtFecha(n.hasta)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tabla */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["Fecha", "Día", "Prog. Entrada", "Prog. Salida", "Real Entrada", "Real Salida", "Estado", "Nov. SIAP", "Rec. Médico"].map(h => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--card, #1e293b)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agentRows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin registros.</td></tr>
              ) : agentRows.map((r, i) => {
                const esProblema  = r.estado === "SIN_SALIDA" || r.estado === "SOLO_SALIDA" || r.estado === "PRESENTE_SIN_ESTAR" || r.estado === "SIN_FICHAJE";
                const esInvertido = highlightInvertido ? r.fichajeInvertido : false;
                const rowBg =
                  esInvertido ? "rgba(239,68,68,0.12)" :
                  esProblema  ? "rgba(239,68,68,0.09)" :
                  i % 2 === 0 ? "transparent"          : "rgba(255,255,255,0.02)";

                return (
                  <tr key={`${r.fecha}-${i}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: rowBg }}>
                    <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
                    <td style={{ padding: "7px 12px", color: "#94a3b8" }}>{r.diaSemana}</td>
                    <td style={{ padding: "7px 12px", fontFamily: "monospace", color: "#64748b" }}>
                      {r.horaEntradaProgramada ?? <span style={{ color: "#334155" }}>—</span>}
                    </td>
                    <td style={{ padding: "7px 12px", fontFamily: "monospace", color: "#64748b" }}>
                      {r.horaSalidaProgramada ?? <span style={{ color: "#334155" }}>—</span>}
                    </td>
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
                    <td style={{ padding: "7px 12px" }}>
                      {r.recMedico != null
                        ? <span style={{ ...badge, background: "rgba(168,85,247,0.18)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.35)", fontSize: "0.72rem" }}>
                            {r.recMedico !== "Sí" ? r.recMedico : "Sí"}
                          </span>
                        : <span style={{ color: "#475569" }}>—</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer resumen */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          {[
            { label: "Sin salida",          val: agentRows.filter(r => r.estado === "SIN_SALIDA").length,         color: "#ef4444" },
            { label: "Solo salida",         val: agentRows.filter(r => r.estado === "SOLO_SALIDA").length,        color: "#f43f5e" },
            { label: "Presente sin estar",  val: agentRows.filter(r => r.estado === "PRESENTE_SIN_ESTAR").length, color: "#fb923c" },
            { label: "Sin fichaje",         val: agentRows.filter(r => r.estado === "SIN_FICHAJE").length,        color: "#fbbf24" },
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

// ── Modal fichajes crudos de DB (click en DNI) ────────────────────────────────
function FichajeRawModal({ agente, rawRows, siapNovedades, loading, onClose, horarioAgente }: {
  agente:          { dni: string; nombre: string; upa: string };
  rawRows:         RawFichajeRow[];
  siapNovedades?:  Array<{ novedad: string; desde: string; hasta: string }>;
  loading:         boolean;
  onClose:         () => void;
  horarioAgente?:  { diasLaborables: string[]; horas: Record<string, { entrada: string | null; salida: string | null }> };
}) {
  const sinFichaje = !loading && rawRows.length === 0;

  // Para cada fila: calcular ventana esperada e invertido.
  // Criterio: cada evento pertenece a la mitad del turno más cercana (entrada o salida).
  // Si el checktype no coincide con el tipo esperado para esa mitad → invertido.
  function infoFila(r: RawFichajeRow): { esInvertido: boolean; ventanaLabel: string | null; esLaborable: boolean | null } {
    let ventanaLabel: string | null = null;
    let esInvertido = false;

    const dowKey   = getDowKey(r.fecha);
    const horasDia = horarioAgente?.horas?.[dowKey];
    const entProg  = horasDia?.entrada ?? null;
    const salProg  = horasDia?.salida  ?? null;
    const tieneHorario = !!horarioAgente;

    if (horasDia && entProg && salProg) {
      if (entProg !== salProg) {
        // Turno normal: el evento pertenece a la mitad más cercana del turno.
        // Se usa tipoReal (tipo del lector físico por SN) en lugar del checktype almacenado.
        const cercaEntrada = timeDiffMinsFE(r.hora, entProg) <= timeDiffMinsFE(r.hora, salProg);
        if (cercaEntrada) {
          ventanaLabel = `Vent. entrada: ${entProg}`;
          esInvertido  = r.tipoReal !== 0;
        } else {
          ventanaLabel = `Vent. salida: ${salProg}`;
          esInvertido  = r.tipoReal !== 1;
        }
      } else {
        // Turno 24hs — eventos del día del turno deben ser Entrada
        ventanaLabel = `Vent. entrada 24hs: ${entProg}`;
        esInvertido  = r.tipoReal !== 0;
      }
    }

    // ── Día anterior turno 24hs → hoy es el día de salida ─────────────────
    if (ventanaLabel === null) {
      const prevDt = new Date(r.fecha + 'T00:00:00Z');
      prevDt.setUTCDate(prevDt.getUTCDate() - 1);
      const prevDow   = getDowKey(prevDt.toISOString().slice(0, 10));
      const horasPrev = horarioAgente?.horas?.[prevDow];
      const prevEnt   = horasPrev?.entrada ?? null;
      const prevSal   = horasPrev?.salida  ?? null;
      if (prevEnt && prevSal && prevEnt === prevSal && timeDiffMinsFE(r.hora, prevSal) <= RANGO_INVERTIDO) {
        ventanaLabel = `Vent. salida 24hs: ${addMinsFE(prevSal, -RANGO_INVERTIDO)}–${addMinsFE(prevSal, RANGO_INVERTIDO)}`;
        if (r.checktype !== 1) {
          const haySalida = rawRows.some(x => x.fecha === r.fecha && x.checktype === 1 && timeDiffMinsFE(x.hora, prevSal) <= RANGO_INVERTIDO);
          esInvertido = !haySalida;
        }
      }
    }

    const esLaborable = tieneHorario ? (!!horasDia || ventanaLabel !== null) : null;
    return { esInvertido, ventanaLabel, esLaborable };
  }

  const invertidoCount = rawRows.filter(r => infoFila(r).esInvertido).length;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.96)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 820, maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{agente.nombre}</div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>DNI {agente.dni} &nbsp;·&nbsp; {agente.upa}</div>
          </div>
          <button className="btn" style={{ fontSize: "0.82rem", padding: "4px 12px" }} onClick={onClose}>Cerrar</button>
        </div>

        {/* Horario programado */}
        {horarioAgente && horarioAgente.diasLaborables.length > 0 && (
          <div style={{ padding: "8px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(34,197,94,0.03)", display: "flex", flexWrap: "wrap", gap: "6px 20px", alignItems: "center" }}>
            <span style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", flexBasis: "100%", marginBottom: 2 }}>
              Horario programado
            </span>
            {horarioAgente.diasLaborables.map(dia => {
              const h = horarioAgente.horas[dia];
              return (
                <span key={dia} style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  <span style={{ color: "#22c55e", fontWeight: 600 }}>{dia}</span>
                  {h?.entrada && h?.salida
                    ? <span style={{ color: "#64748b" }}> {h.entrada === h.salida ? `${h.entrada} (24hs)` : `${h.entrada}–${h.salida}`}</span>
                    : null}
                </span>
              );
            })}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>Cargando fichajes…</div>
        ) : sinFichaje ? (
          <>
            <div style={{ padding: "10px 18px", background: "rgba(251,191,36,0.07)", borderBottom: "1px solid rgba(251,191,36,0.2)", fontSize: "0.82rem", color: "#fbbf24" }}>
              Sin registros biométricos en el período.
            </div>
            {siapNovedades && siapNovedades.length > 0 && (
              <div style={{ padding: "12px 18px", flex: 1, overflowY: "auto" }}>
                <div style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>SIAP — Novedades</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {siapNovedades.map((n, i) => (
                    <div key={i} style={{ fontSize: "0.82rem", display: "flex", gap: 12 }}>
                      <span style={{ color: "#a5b4fc", fontWeight: 600, minWidth: 120 }}>{n.novedad}</span>
                      <span style={{ color: "#64748b" }}>{fmtFecha(n.desde)} → {fmtFecha(n.hasta)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(!siapNovedades || siapNovedades.length === 0) && (
              <div style={{ padding: 24, textAlign: "center", color: "#475569", fontSize: "0.82rem" }}>Sin novedades SIAP.</div>
            )}
          </>
        ) : (
          <div style={{ overflowY: "auto", flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["Fecha", "Hora", "Tipo", "¿Debe fichar?", "Rango esperado"].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontWeight: 600, color: "#94a3b8", position: "sticky", top: 0, background: "var(--card, #1e293b)", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawRows.map((r, i) => {
                  const { esInvertido, ventanaLabel, esLaborable } = infoFila(r);
                  const noLaborable = esLaborable === false;
                  const rowBg = noLaborable
                    ? "rgba(239,68,68,0.07)"
                    : esInvertido
                    ? "rgba(251,191,36,0.12)"
                    : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: rowBg }}>
                      <td style={{ padding: "7px 14px", whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
                      <td style={{ padding: "7px 14px", fontFamily: "monospace", fontWeight: 600, color: esInvertido ? "#fbbf24" : noLaborable ? "#ef4444" : undefined }}>
                        {r.hora}
                        {esInvertido && <span style={{ marginLeft: 6, fontSize: "0.72rem", color: "#fbbf24" }}>⚠</span>}
                        {noLaborable && <span style={{ marginLeft: 6, fontSize: "0.72rem", color: "#ef4444" }}>✕</span>}
                      </td>
                      <td style={{ padding: "7px 14px" }}>
                        <span style={{
                          ...badge,
                          ...(r.tipo === "Entrada"
                            ? { background: "rgba(34,197,94,0.18)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.35)" }
                            : { background: "rgba(96,165,250,0.18)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.35)" }),
                        }}>
                          {r.tipo}
                        </span>
                      </td>
                      <td style={{ padding: "7px 14px" }}>
                        {esLaborable === null ? (
                          <span style={{ color: "#475569", fontSize: "0.75rem" }}>—</span>
                        ) : noLaborable ? (
                          <span style={{ ...badge, background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)", fontSize: "0.72rem" }}>No laborable</span>
                        ) : (
                          <span style={{ ...badge, background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", fontSize: "0.72rem" }}>Laborable</span>
                        )}
                      </td>
                      <td style={{ padding: "7px 14px", fontSize: "0.75rem", color: esInvertido ? "#fbbf24" : "#64748b", whiteSpace: "nowrap" }}>
                        {ventanaLabel ?? <span style={{ color: "#334155" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: "8px 18px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          {!loading && !sinFichaje && (
            <>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {rawRows.filter(r => r.tipo === "Entrada").length} entradas &nbsp;·&nbsp; {rawRows.filter(r => r.tipo === "Salida").length} salidas
              </span>
              {invertidoCount > 0 && (
                <span style={{ fontSize: "0.75rem", color: "#fbbf24", fontWeight: 600 }}>
                  ⚠ {invertidoCount} registro{invertidoCount !== 1 ? "s" : ""} en lector incorrecto
                </span>
              )}
            </>
          )}
          <span className="muted" style={{ fontSize: "0.72rem", marginLeft: "auto" }}>Clic fuera para cerrar</span>
        </div>
      </div>
    </div>
  );
}

// ── Modal "Fichó sin deber" de un agente ──────────────────────────────────────
function FichoDeberModal({ agente, registros, onClose }: {
  agente:    { dni: string; nombre: string; upa: string };
  registros: FichoSinDeberRow[];
  onClose:   () => void;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.95)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 780, maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{agente.nombre}</div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>DNI {agente.dni} &nbsp;·&nbsp; {agente.upa} &nbsp;·&nbsp; {registros.length} día{registros.length !== 1 ? "s" : ""} sin deber</div>
          </div>
          <button className="btn" style={{ fontSize: "0.82rem", padding: "4px 12px" }} onClick={onClose}>Cerrar</button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["Fecha", "Día fichaje", "Días laborables", "Entrada", "Salida"].map(h => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--card, #1e293b)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registros.map((r, i) => (
                <tr key={`${r.fecha}-${i}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "7px 14px", whiteSpace: "nowrap" }}>{fmtFecha(r.fecha)}</td>
                  <td style={{ padding: "7px 14px" }}>
                    <span style={{ ...badge, background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)", fontSize: "0.72rem" }}>
                      {r.diaSemana}
                    </span>
                  </td>
                  <td style={{ padding: "7px 14px", fontSize: "0.78rem", color: "#94a3b8" }}>{r.diasLaborables}</td>
                  <td style={{ padding: "7px 14px", fontFamily: "monospace", color: r.entrada ? "#22c55e" : "#475569" }}>{r.entrada ?? "—"}</td>
                  <td style={{ padding: "7px 14px", fontFamily: "monospace", color: r.salida  ? "#60a5fa" : "#475569" }}>{r.salida  ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: "8px 18px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="muted" style={{ fontSize: "0.72rem" }}>Clic fuera para cerrar</span>
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
  const [ministerioFile, setMinisterioFile] = useState("");

  const [modo, setModo]       = useState<ModoConsulta>("periodo");
  const [fecha, setFecha]     = useState(() => new Date().toISOString().slice(0, 10));
  const [periodo, setPeriodo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [desde, setDesde] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));

  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState<SinSalidaRow[]>([]);
  const [meta, setMeta]       = useState<Meta | null>(null);
  const [loaded, setLoaded]   = useState(false);

  // filtros tab Registros
  const [filtroEstado, setFiltroEstado]         = useState<FiltroEstado>("SIN_SALIDA");
  const [filtroUpa, setFiltroUpa]               = useState("");
  const [filtroOcupacion, setFiltroOcupacion]   = useState("");
  const [filtroServicio, setFiltroServicio]     = useState("");
  const [busqueda, setBusqueda]         = useState("");

  // tabs y paginación
  const [tab, setTab]           = useState<Tab>("registros");
  const [paginaR, setPaginaR]   = useState(1);
  const [paginaA, setPaginaA]   = useState(1);
  const [paginaI, setPaginaI]   = useState(1);
  const [paginaF, setPaginaF]   = useState(1);
  const [paginaSH, setPaginaSH] = useState(1);
  const [paginaH,  setPaginaH]  = useState(1);

  // búsquedas y filtros tabs
  const [busquedaA,   setBusquedaA]   = useState("");
  const [filtroUpaA,  setFiltroUpaA]  = useState("");
  const [busquedaI,   setBusquedaI]   = useState("");
  const [filtroUpaI,  setFiltroUpaI]  = useState("");
  const [busquedaF,   setBusquedaF]   = useState("");
  const [filtroUpaF,  setFiltroUpaF]  = useState("");
  const [busquedaSH,  setBusquedaSH]  = useState("");
  const [filtroUpaSH, setFiltroUpaSH] = useState("");
  const [busquedaH,   setBusquedaH]   = useState("");

  // fichó sin deber
  const [rowsFicho, setRowsFicho]     = useState<FichoSinDeberRow[]>([]);
  const [metaFicho, setMetaFicho]     = useState<MetaFichosindeber | null>(null);

  // modal asistencia (doble click agente)
  const [agentModal, setAgentModal] = useState<{ dni: string; nombre: string; upa: string; invertido: boolean } | null>(null);
  const [siapAgentes, setSiapAgentes] = useState<Record<string, { novedades: Array<{ novedad: string; desde: string; hasta: string }> }>>({});
  const [horariosAgentes, setHorariosAgentes] = useState<Record<string, { nombre: string; diasLaborables: string[]; horas: Record<string, { entrada: string | null; salida: string | null }> }>>({});
  const [patronModal, setPatronModal] = useState<{ patron: string; agentes: { dni: string; nombre: string }[] } | null>(null);
  const [sinHorarioAgentes, setSinHorarioAgentes] = useState<SinHorarioAgente[]>([]);

  // modal fichajes crudos (click en DNI)
  const [fichajeRawModal, setFichajeRawModal] = useState<{ dni: string; nombre: string; upa: string; fechas?: string[] } | null>(null);
  const [fichajeRawRows, setFichajeRawRows]   = useState<RawFichajeRow[]>([]);
  const [fichajeRawLoading, setFichajeRawLoading] = useState(false);

  // modal fichó sin deber agente (doble click en tabla agrupada)
  const [fichoDeberModal, setFichoDeberModal] = useState<FichoAgenteAgrupado | null>(null);

  const autoLoadRef = useRef(false);

  useEffect(() => { setPaginaR(1); setPaginaA(1); setPaginaI(1); setPaginaF(1); }, [rows]);
  useEffect(() => { setPaginaR(1); }, [filtroEstado, filtroUpa, busqueda]);
  useEffect(() => { setPaginaA(1); }, [busquedaA]);
  useEffect(() => { setPaginaI(1); }, [busquedaI]);
  useEffect(() => { setPaginaF(1); }, [busquedaF, rowsFicho]);

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
        const ministerio = files.find(f => f.name.toUpperCase().includes("MINISTERIO"));
        if (ministerio) setMinisterioFile(ministerio.name);
      })
      .catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    const horariosSelected = horariosFiles.filter(Boolean);
    if (horariosSelected.length === 0) { toastError("Falta archivo", "Seleccioná al menos un archivo de horarios"); return; }
    if (modo === "fecha"   && !fecha)   { toastError("Falta fecha",   "Seleccioná la fecha a consultar");   return; }
    if (modo === "periodo" && !periodo) { toastError("Falta período",  "Seleccioná el período a consultar"); return; }
    if (modo === "rango"   && (!desde || !hasta)) { toastError("Falta rango", "Seleccioná desde y hasta"); return; }
    if (modo === "rango"   && desde > hasta)      { toastError("Rango inválido", "La fecha 'Desde' no puede ser posterior a 'Hasta'"); return; }

    setLoading(true);
    try {
      const body: Record<string, any> = {
        horariosFiles: horariosSelected,
        siapFiles: siapFiles.filter(Boolean),
      };
      if (ministerioFile) body.ministerioFile = ministerioFile;
      if (modo === "fecha")   body.fecha   = fecha;
      if (modo === "periodo") body.periodo = periodo;
      if (modo === "rango")   { body.desde = desde; body.hasta = hasta; }

      const [r, rf] = await Promise.all([
        apiFetch<{ ok: boolean; data: SinSalidaRow[]; meta: Meta }>(
          "/sin-salida/",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        ),
        siapFiles.filter(Boolean).length > 0
          ? apiFetch<{ ok: boolean; data: FichoSinDeberRow[]; meta: MetaFichosindeber }>(
              "/sin-salida/ficho-sin-deber",
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
            ).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!r.ok) throw new Error((r as any).error ?? "Error al cargar");
      setRows(r.data ?? []);
      setMeta(r.meta ?? null);
      setSiapAgentes((r as any).siapAgentes ?? {});
      setHorariosAgentes((r as any).horariosAgentes ?? {});
      setSinHorarioAgentes((r as any).sinHorarioAgentes ?? []);
      if (rf && rf.ok) { setRowsFicho(rf.data ?? []); setMetaFicho(rf.meta ?? null); }
      setLoaded(true);
    } catch (e: any) {
      toastError("Error", e?.message ?? "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, [modo, fecha, periodo, desde, hasta, horariosFiles, siapFiles, ministerioFile, toastError]);

  useEffect(() => {
    if (autoLoadRef.current && !loaded && !loading) { autoLoadRef.current = false; cargar(); }
  }, [cargar, loaded, loading]);

  // Abrir modal de fichajes crudos para un agente (click en DNI)
  const abrirFichajeRaw = useCallback(async (agente: { dni: string; nombre: string; upa: string; fechas?: string[] }) => {
    setFichajeRawModal(agente);
    setFichajeRawRows([]);
    setFichajeRawLoading(true);
    try {
      const body: Record<string, any> = { dni: agente.dni };
      if (agente.fechas?.length) body.fechas = agente.fechas;
      if (modo === "fecha")   body.fecha   = fecha;
      if (modo === "periodo") body.periodo = periodo;
      if (modo === "rango")   { body.desde = desde; body.hasta = hasta; }
      const r = await apiFetch<{ ok: boolean; data: RawFichajeRow[] }>(
        "/sin-salida/fichajes-agente",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (r.ok) setFichajeRawRows(r.data ?? []);
    } catch {
      // modal igual se muestra (sin datos → fallback a SIAP)
    } finally {
      setFichajeRawLoading(false);
    }
  }, [modo, fecha, periodo]);

  const upasUnicas        = React.useMemo(() => [...new Set(rows.map(r => r.upa).filter(Boolean))].sort(), [rows]);
  const ocupacionesUnicas = React.useMemo(() => [...new Set(rows.map(r => r.ocupacion).filter(Boolean))].sort(), [rows]);
  const serviciosUnicos   = React.useMemo(() => [...new Set(rows.map(r => r.servicio).filter(Boolean))].sort(), [rows]);
  const upasUnicasFicho = React.useMemo(() => [...new Set(rowsFicho.map(r => r.upa).filter(Boolean))].sort(), [rowsFicho]);

  // Filas filtradas – tab Registros
  const rowsFiltradas = React.useMemo(() =>
    rows.filter(r => {
      if (filtroEstado !== "todos" && r.estado !== filtroEstado) return false;
      if (filtroUpa && r.upa !== filtroUpa) return false;
      if (filtroOcupacion && r.ocupacion !== filtroOcupacion) return false;
      if (filtroServicio && r.servicio !== filtroServicio) return false;
      if (busqueda) {
        const q = busqueda.toLowerCase();
        return r.nombre.toLowerCase().includes(q) || r.dni.includes(q) || r.fecha.includes(q);
      }
      return true;
    }), [rows, filtroEstado, filtroUpa, filtroOcupacion, filtroServicio, busqueda]);

  const registrosAgentesLista = React.useMemo((): RegistroAgenteRow[] => {
    const map = new Map<string, RegistroAgenteRow>();
    rowsFiltradas.forEach(r => {
      if (!map.has(r.dni)) {
        map.set(r.dni, {
          dni: r.dni,
          nombre: r.nombre,
          upa: r.upa,
          esGuardia: r.esGuardia,
          servicio: r.servicio ?? '',
          fechas: [],
          sinSalida: 0,
          soloSalida: 0,
          presentesSinEstar: 0,
          sinFichaje: 0,
          requiereRevision: 0,
          justificados: 0,
          conSalida: 0,
          invertidos: 0,
          total: 0,
        });
      }
      const a = map.get(r.dni)!;
      a.total++;
      if (!a.fechas.includes(r.fecha)) a.fechas.push(r.fecha);
      if (r.fichajeInvertido) a.invertidos++;
      if (r.estado === "SIN_SALIDA") a.sinSalida++;
      else if (r.estado === "SOLO_SALIDA") a.soloSalida++;
      else if (r.estado === "PRESENTE_SIN_ESTAR") a.presentesSinEstar++;
      else if (r.estado === "SIN_FICHAJE") a.sinFichaje++;
      else if (r.estado === "REQUIERE_REVISION") a.requiereRevision++;
      else if (r.estado === "JUSTIFICADO") a.justificados++;
      else if (r.estado === "CON_SALIDA") a.conSalida++;
    });
    return [...map.values()]
      .map(a => ({ ...a, fechas: [...a.fechas].sort() }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [rowsFiltradas]);

  // Agentes únicos con problema (sin salida / sin fichaje / sospechoso)
  const agentesLista = React.useMemo((): AgenteRow[] => {
    const map = new Map<string, AgenteRow>();
    rows.forEach(r => {
      if (r.estado !== "SOSPECHOSO" && r.estado !== "SIN_SALIDA" && r.estado !== "SOLO_SALIDA" && r.estado !== "PRESENTE_SIN_ESTAR" && r.estado !== "SIN_FICHAJE") return;
      if (!map.has(r.dni)) map.set(r.dni, { dni: r.dni, nombre: r.nombre, upa: r.upa, sospechosos: 0, sinSalida: 0, soloSalida: 0, presentesSinEstar: 0, sinFichaje: 0 });
      const a = map.get(r.dni)!;
      if (r.estado === "SOSPECHOSO") a.sospechosos++;
      else if (r.estado === "SIN_SALIDA") a.sinSalida++;
      else if (r.estado === "SOLO_SALIDA") a.soloSalida++;
      else if (r.estado === "PRESENTE_SIN_ESTAR") a.presentesSinEstar++;
      else a.sinFichaje++;
    });
    return [...map.values()]
      .filter(a => {
        if (filtroUpaA && a.upa !== filtroUpaA) return false;
        if (busquedaA) { const q = busquedaA.toLowerCase(); return a.nombre.toLowerCase().includes(q) || a.dni.includes(q); }
        return true;
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [rows, busquedaA, filtroUpaA]);

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
        if (filtroUpaI && a.upa !== filtroUpaI) return false;
        if (busquedaI) { const q = busquedaI.toLowerCase(); return a.nombre.toLowerCase().includes(q) || a.dni.includes(q); }
        return true;
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [rows, busquedaI, filtroUpaI]);

  // Agentes agrupados – tab Fichó sin deber (sin filtro de búsqueda → para el tab label)
  const fichoAgrupadoAll = React.useMemo((): FichoAgenteAgrupado[] => {
    const map = new Map<string, FichoAgenteAgrupado>();
    rowsFicho.forEach(r => {
      if (!map.has(r.dni)) map.set(r.dni, { dni: r.dni, nombre: r.nombre, upa: r.upa, esGuardia: r.esGuardia, dias: 0, registros: [] });
      const a = map.get(r.dni)!;
      a.dias++;
      a.registros.push(r);
    });
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [rowsFicho]);

  // Con filtro de búsqueda y UPA → para la tabla
  const fichoAgrupado = React.useMemo((): FichoAgenteAgrupado[] =>
    fichoAgrupadoAll.filter(a => {
      if (filtroUpaF && a.upa !== filtroUpaF) return false;
      if (busquedaF) { const q = busquedaF.toLowerCase(); return a.nombre.toLowerCase().includes(q) || a.dni.includes(q); }
      return true;
    }), [fichoAgrupadoAll, busquedaF, filtroUpaF]);

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
      "Nov. Ministerio":   r.novedadMinisterio || "",
      "Nov. SIAP":         r.novedadSiap || "",
      "Invertido":         r.fichajeInvertido ? "SÍ" : "",
      "Rec. Médico":       r.recMedico ?? "",
    })));
  };

  const registrosPagina  = registrosAgentesLista.slice((paginaR - 1) * PAGE_SIZE, paginaR * PAGE_SIZE);
  const agentesPagina    = agentesLista.slice((paginaA - 1) * PAGE_SIZE, paginaA * PAGE_SIZE);
  const invertidosPagina = agentesInvertidosLista.slice((paginaI - 1) * PAGE_SIZE, paginaI * PAGE_SIZE);
  const fichoPagina      = fichoAgrupado.slice((paginaF - 1) * PAGE_SIZE, paginaF * PAGE_SIZE);

  const setHorFile  = (idx: number, val: string) => setHorariosFiles(prev => { const n = [...prev]; n[idx] = val; return n; });
  const setSiapFile = (idx: number, val: string) => setSiapFiles(prev => { const n = [...prev]; n[idx] = val; return n; });

  const fileOpt = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
    </>
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: "registros",     label: `Registros (${registrosAgentesLista.length} agentes)` },
    { id: "agentes",       label: `Agentes c/ problema (${agentesLista.length})` },
    { id: "invertidos",    label: `Sospechosos (${agentesInvertidosLista.length})` },
    { id: "fichosindeber", label: `Fichó sin deber (${fichoAgrupadoAll.length})` },
    { id: "sinhorario",    label: `Sin horario (${sinHorarioAgentes.length})` },
    { id: "horarios",      label: "Horarios agrupados" },
  ];

  // Estilo hover para DNI clickeable
  const dniCellStyle: React.CSSProperties = {
    padding: "8px 12px", fontFamily: "monospace", color: "#60a5fa",
    cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted",
  };

  return (
    <Layout title="Control de fichajes">

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
        <div style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Ministerio</div>
          <div style={{ maxWidth: 420 }}>
            <select style={selectStyle} value={ministerioFile} onChange={e => setMinisterioFile(e.target.value)}>
              {fileOpt("â€” sin archivo â€”")}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["fecha", "periodo", "rango"] as ModoConsulta[]).map(m => (
              <button key={m} type="button" className={`btn${modo === m ? " primary" : ""}`}
                style={{ fontSize: "0.78rem", padding: "5px 14px" }}
                onClick={() => {
                  if (m === "rango" && modo !== "rango") {
                    if (periodo) {
                      const [y, mo] = periodo.split("-").map(Number);
                      const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
                      setDesde(`${periodo}-01`);
                      setHasta(`${periodo}-${String(lastDay).padStart(2, "0")}`);
                    } else if (fecha) {
                      setDesde(fecha);
                      setHasta(fecha);
                    }
                  }
                  setModo(m);
                }}>
                {m === "fecha" ? "Día exacto" : m === "periodo" ? "Mes completo" : "Rango"}
              </button>
            ))}
          </div>
          {modo === "fecha" ? (
            <div>
              <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Fecha</div>
              <input type="date" className="input" value={fecha} onChange={e => setFecha(e.target.value)} style={{ width: 160 }} />
            </div>
          ) : modo === "periodo" ? (
            <div>
              <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Período</div>
              <input type="month" className="input" value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ width: 160 }} />
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div>
                <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Desde</div>
                <input type="date" className="input" value={desde}
                  max={hasta || undefined}
                  onChange={e => { setDesde(e.target.value); if (hasta && e.target.value > hasta) setHasta(e.target.value); }}
                  style={{ width: 150 }} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Hasta</div>
                <input type="date" className="input" value={hasta}
                  min={desde || undefined}
                  onChange={e => { setHasta(e.target.value); if (desde && e.target.value < desde) setDesde(e.target.value); }}
                  style={{ width: 150 }} />
              </div>
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
            { label: "Agentes controlables", value: meta.total,               color: "#e2e8f0" },
            { label: "Sospechosos",         value: meta.sospechosos ?? 0,    color: "#e879f9" },
            { label: "Sin salida",          value: meta.sinSalida,           color: "#ef4444" },
            { label: "Solo salida",         value: meta.soloSalida ?? 0,     color: "#f43f5e" },
            { label: "Presente sin estar",  value: meta.presentesSinEstar,   color: "#fb923c" },
            { label: "Sin fichaje",         value: meta.sinFichaje,          color: "#fbbf24" },
            { label: "Requiere revisión",   value: meta.requiereRevision ?? 0, color: "#94a3b8" },
            { label: "Justificados",        value: meta.justificados,        color: "#818cf8" },
            { label: "Con salida (OK)",     value: meta.conSalida,           color: "#22c55e" },
            { label: "Agentes c/ problema", value: meta.agentesConProblema,  color: "#f97316" },
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
              {(["todos", "SOSPECHOSO", "SIN_SALIDA", "SOLO_SALIDA", "PRESENTE_SIN_ESTAR", "SIN_FICHAJE", "REQUIERE_REVISION", "JUSTIFICADO", "CON_SALIDA"] as FiltroEstado[]).map(v => (
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
            {ocupacionesUnicas.length > 0 && (
              <div>
                <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Ocupación:</span>
                <select value={filtroOcupacion} onChange={e => setFiltroOcupacion(e.target.value)}
                  style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}>
                  <option value="">Todas</option>
                  {ocupacionesUnicas.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            )}
            {serviciosUnicos.length > 0 && (
              <div>
                <span className="muted" style={{ fontSize: "0.72rem", marginRight: 6 }}>Servicio:</span>
                <select value={filtroServicio} onChange={e => setFiltroServicio(e.target.value)}
                  style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}>
                  <option value="">Todos</option>
                  {serviciosUnicos.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
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
                    {["Apellido y Nombre", "DNI", "Dependencia", "Servicio", "Régimen", "Filas", "Sin salida", "Solo salida", "Sin fichaje", "Revisión", "Fechas"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {registrosPagina.length === 0 ? (
                    <tr><td colSpan={11} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin resultados.</td></tr>
                  ) : registrosPagina.map((r, i) => (
                    <tr key={r.dni}
                      onDoubleClick={() => setAgentModal({ dni: r.dni, nombre: r.nombre, upa: r.upa, invertido: false })}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        background: r.invertidos > 0
                          ? "rgba(232,121,249,0.07)"
                          : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                      }}>
                      <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.nombre}>
                        {r.nombre || <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td
                        style={dniCellStyle}
                        title="Ver fichajes de DB"
                        onClick={e => {
                          e.stopPropagation();
                          abrirFichajeRaw({ dni: r.dni, nombre: r.nombre, upa: r.upa, fechas: r.fechas });
                        }}
                      >
                        {r.dni}
                      </td>
                      <td style={{ padding: "8px 12px", color: "#cbd5e1", fontSize: "0.78rem" }}>{r.upa}</td>
                      <td style={{ padding: "8px 12px", color: "#94a3b8", fontSize: "0.78rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.servicio}>
                        {r.servicio || <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {r.esGuardia
                          ? <span style={{ ...badge, background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)", fontSize: "0.72rem" }}>GUARDIA</span>
                          : <span style={{ color: "#475569", fontSize: "0.78rem" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ ...badge, background: "rgba(148,163,184,0.18)", color: "#cbd5e1", border: "1px solid rgba(148,163,184,0.35)" }}>
                          {r.total}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {r.sinSalida > 0
                          ? <span style={{ ...badge, background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }}>{r.sinSalida}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {r.soloSalida > 0
                          ? <span style={{ ...badge, background: "rgba(244,63,94,0.18)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.35)" }}>{r.soloSalida}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {r.sinFichaje > 0
                          ? <span style={{ ...badge, background: "rgba(251,191,36,0.18)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)" }}>{r.sinFichaje}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {r.requiereRevision > 0
                          ? <span style={{ ...badge, background: "rgba(148,163,184,0.18)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.35)" }}>{r.requiereRevision}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: "0.75rem", color: "#64748b", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.fechas.map(f => fmtFecha(f)).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={paginaR} total={registrosAgentesLista.length} onChange={setPaginaR} />
          </div>
        </>
      )}

      {/* ══════════════ TAB: AGENTES CON PROBLEMA ══════════════ */}
      {loaded && tab === "agentes" && (
        <>
          <div className="card" style={{ marginBottom: 12, marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" placeholder="Buscar nombre / DNI…" value={busquedaA}
              onChange={e => setBusquedaA(e.target.value)} style={{ width: 200 }} />
            <select value={filtroUpaA} onChange={e => { setFiltroUpaA(e.target.value); setPaginaA(1); }}
              style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}>
              <option value="">Todas las dependencias</option>
              {upasUnicas.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <span className="muted" style={{ fontSize: "0.75rem" }}>{agentesLista.length} agente{agentesLista.length !== 1 ? "s" : ""} con problema</span>
            <span className="muted" style={{ fontSize: "0.72rem", marginLeft: "auto" }}>Doble click para ver fichajes del mes · Click en DNI para ver registros de DB</span>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["Apellido y Nombre", "DNI", "Servicio", "Sospechoso", "Sin salida", "Solo salida", "Presente sin estar", "Sin fichaje"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentesPagina.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                      {busquedaA ? "Sin resultados." : "No hay agentes con problema."}
                    </td></tr>
                  ) : agentesPagina.map((a, i) => (
                    <tr key={a.dni}
                      onDoubleClick={() => setAgentModal({ ...a, invertido: false })}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)", cursor: "pointer" }}
                      title="Doble click para ver fichajes del mes">
                      <td style={{ padding: "9px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.nombre}>{a.nombre}</td>
                      <td
                        style={dniCellStyle}
                        title="Ver fichajes de DB"
                        onClick={e => {
                          e.stopPropagation();
                          abrirFichajeRaw({
                            dni: a.dni,
                            nombre: a.nombre,
                            upa: a.upa,
                            fechas: [...new Set(rows
                              .filter(r => r.dni === a.dni && (r.estado === "SIN_SALIDA" || r.estado === "SOLO_SALIDA" || r.estado === "PRESENTE_SIN_ESTAR" || r.estado === "SIN_FICHAJE"))
                              .map(r => r.fecha))].sort(),
                          });
                        }}
                      >
                        {a.dni}
                      </td>
                      <td style={{ padding: "9px 12px", color: "#cbd5e1", fontSize: "0.78rem" }}>{a.upa}</td>
                      <td style={{ padding: "9px 12px" }}>
                        {a.sospechosos > 0
                          ? <span style={{ ...badge, background: "rgba(232,121,249,0.18)", color: "#e879f9", border: "1px solid rgba(232,121,249,0.35)" }}>{a.sospechosos}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        {a.sinSalida > 0
                          ? <span style={{ ...badge, background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }}>{a.sinSalida}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        {a.soloSalida > 0
                          ? <span style={{ ...badge, background: "rgba(244,63,94,0.18)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.35)" }}>{a.soloSalida}</span>
                          : <span style={{ color: "#475569" }}>—</span>}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        {a.presentesSinEstar > 0
                          ? <span style={{ ...badge, background: "rgba(251,146,60,0.18)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.35)" }}>{a.presentesSinEstar}</span>
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
              onChange={e => setBusquedaI(e.target.value)} style={{ width: 200 }} />
            <select value={filtroUpaI} onChange={e => { setFiltroUpaI(e.target.value); setPaginaI(1); }}
              style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}>
              <option value="">Todas las dependencias</option>
              {upasUnicas.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <span className="muted" style={{ fontSize: "0.75rem" }}>{agentesInvertidosLista.length} agente{agentesInvertidosLista.length !== 1 ? "s" : ""} sospechosos</span>
            <span className="muted" style={{ fontSize: "0.72rem", marginLeft: "auto" }}>
              Fichó en el lector incorrecto para la ventana del turno — Doble click · Click en DNI para DB
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
                      <td
                        style={dniCellStyle}
                        title="Ver fichajes de DB"
                        onClick={e => {
                          e.stopPropagation();
                          abrirFichajeRaw({
                            dni: a.dni,
                            nombre: a.nombre,
                            upa: a.upa,
                            fechas: [...new Set(rows.filter(r => r.dni === a.dni && r.fichajeInvertido).map(r => r.fecha))].sort(),
                          });
                        }}
                      >
                        {a.dni}
                      </td>
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

      {/* ══════════════ TAB: FICHÓ SIN DEBER ══════════════ */}
      {loaded && tab === "fichosindeber" && (
        <>
          {metaFicho?.sinBiometrico && (
            <div className="card" style={{ marginBottom: 10, marginTop: 10, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.07)", color: "#fbbf24", fontSize: "0.82rem" }}>
              ⚠ Sin datos biométricos: {metaFicho.dbError}
            </div>
          )}
          <div className="card" style={{ marginBottom: 12, marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" placeholder="Buscar nombre / DNI…" value={busquedaF}
              onChange={e => setBusquedaF(e.target.value)} style={{ width: 200 }} />
            <select value={filtroUpaF} onChange={e => { setFiltroUpaF(e.target.value); setPaginaF(1); }}
              style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}>
              <option value="">Todas las dependencias</option>
              {upasUnicasFicho.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              {fichoAgrupado.length} agente{fichoAgrupado.length !== 1 ? "s" : ""} &nbsp;·&nbsp; {rowsFicho.length} registros
            </span>
            <button className="btn" type="button" disabled={fichoAgrupado.length === 0}
              style={{ fontSize: "0.75rem", padding: "4px 12px", whiteSpace: "nowrap", marginLeft: "auto" }}
              onClick={() => {
                const etiqueta = modo === "periodo" ? periodo : fecha;
                exportToExcel(`ficho_sin_deber_${etiqueta}`, rowsFicho.map(r => ({
                  DNI:                   r.dni,
                  "Apellido y Nombre":   r.nombre,
                  Dependencia:           r.upa,
                  Régimen:               r.esGuardia ? "GUARDIA" : "",
                  Fecha:                 fmtFecha(r.fecha),
                  Día:                   r.diaSemana,
                  "Días laborables":     r.diasLaborables,
                  Entrada:               r.entrada ?? "",
                  Salida:                r.salida  ?? "",
                })));
              }}>
              📥 Exportar Excel
            </button>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["Apellido y Nombre", "DNI", "Dependencia", "Días", "Fechas"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fichoPagina.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                      {rowsFicho.length === 0
                        ? "No se detectaron fichajes en días no laborables."
                        : "Sin resultados para la búsqueda."}
                    </td></tr>
                  ) : fichoPagina.map((a, i) => (
                    <tr key={a.dni}
                      onDoubleClick={() => setFichoDeberModal(a)}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)", cursor: "pointer" }}
                      title="Doble click para ver detalle">
                      <td style={{ padding: "9px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.nombre}>
                        {a.nombre}
                      </td>
                      <td
                        style={dniCellStyle}
                        title="Ver fichajes de DB"
                        onClick={e => {
                          e.stopPropagation();
                          abrirFichajeRaw({
                            dni: a.dni,
                            nombre: a.nombre,
                            upa: a.upa,
                            fechas: [...new Set(a.registros.map(r => r.fecha))].sort(),
                          });
                        }}
                      >
                        {a.dni}
                      </td>
                      <td style={{ padding: "9px 12px", color: "#cbd5e1", fontSize: "0.78rem" }}>{a.upa}</td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{ ...badge, background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }}>
                          {a.dias} día{a.dias !== 1 ? "s" : ""}
                        </span>
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: "0.75rem", color: "#64748b", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.registros.map(r => `${fmtFecha(r.fecha)} (${r.diaSemana})`).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={paginaF} total={fichoAgrupado.length} onChange={setPaginaF} />
          </div>
        </>
      )}

      {/* ══════════════ TAB: SIN HORARIO ══════════════ */}
      {loaded && tab === "sinhorario" && (() => {
        const filtrados = sinHorarioAgentes.filter(a => {
          if (filtroUpaSH && a.upa !== filtroUpaSH) return false;
          if (busquedaSH) { const q = busquedaSH.toLowerCase(); return a.nombre.toLowerCase().includes(q) || a.dni.includes(q); }
          return true;
        });
        const upasUnicas = [...new Set(sinHorarioAgentes.map(a => a.upa).filter(Boolean))].sort();
        const pagina = filtrados.slice((paginaSH - 1) * PAGE_SIZE, paginaSH * PAGE_SIZE);
        return (
          <>
            <div className="card" style={{ marginBottom: 12, marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input className="input" placeholder="Buscar nombre / DNI…" value={busquedaSH}
                onChange={e => { setBusquedaSH(e.target.value); setPaginaSH(1); }} style={{ width: 200 }} />
              <select value={filtroUpaSH} onChange={e => { setFiltroUpaSH(e.target.value); setPaginaSH(1); }}
                style={{ ...selectStyle, width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}>
                <option value="">Todas las dependencias</option>
                {upasUnicas.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {filtrados.length} agente{filtrados.length !== 1 ? "s" : ""} en SIAP sin horario en el Excel
              </span>
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      {["Apellido y Nombre", "DNI", "Dependencia"].map(h => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagina.length === 0 ? (
                      <tr><td colSpan={3} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                        {sinHorarioAgentes.length === 0 ? "Todos los agentes del SIAP tienen horario cargado." : "Sin resultados."}
                      </td></tr>
                    ) : pagina.map((a, i) => (
                      <tr key={a.dni} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                        <td style={{ padding: "9px 12px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.nombre}>{a.nombre || <span style={{ color: "#475569" }}>—</span>}</td>
                        <td style={{ padding: "9px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{a.dni}</td>
                        <td style={{ padding: "9px 12px", color: "#cbd5e1", fontSize: "0.78rem" }}>{a.upa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacion pagina={paginaSH} total={filtrados.length} onChange={setPaginaSH} />
            </div>
          </>
        );
      })()}

      {/* ══════════════ TAB: HORARIOS AGRUPADOS ══════════════ */}
      {loaded && tab === "horarios" && (() => {
        // Build pattern string for each agent and group them
        type Patron = { patron: string; cantidad: number; dnis: string[] };
        const patronMap = new Map<string, Patron>();
        const DOW_ORDER = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
        for (const [dni, info] of Object.entries(horariosAgentes)) {
          const partes = DOW_ORDER
            .filter(d => info.horas[d])
            .map(d => {
              const h = info.horas[d];
              const hStr = h.entrada && h.salida
                ? (h.entrada === h.salida ? `${h.entrada}(24hs)` : `${h.entrada}–${h.salida}`)
                : h.entrada ?? h.salida ?? "?";
              return `${d} ${hStr}`;
            });
          const patron = partes.join(" / ") || "Sin días";
          if (!patronMap.has(patron)) patronMap.set(patron, { patron, cantidad: 0, dnis: [] });
          const p = patronMap.get(patron)!;
          p.cantidad++;
          p.dnis.push(dni);
        }
        const patronesTodos = [...patronMap.values()].sort((a, b) => b.cantidad - a.cantidad);
        const patrones = busquedaH
          ? patronesTodos.filter(p => {
              const q = busquedaH.toLowerCase();
              return p.patron.toLowerCase().includes(q) ||
                p.dnis.some(d => d.includes(q) || (horariosAgentes[d]?.nombre ?? "").toLowerCase().includes(q));
            })
          : patronesTodos;
        const paginaItems = patrones.slice((paginaH - 1) * PAGE_SIZE, paginaH * PAGE_SIZE);
        return (
          <>
            <div className="card" style={{ marginBottom: 12, marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {patrones.length}{busquedaH ? ` de ${patronesTodos.length}` : ""} patrón{patrones.length !== 1 ? "es" : ""} de horario distintos entre {Object.keys(horariosAgentes).length} agentes
              </span>
              <input
                className="input"
                placeholder="Buscar nombre / DNI / horario…"
                value={busquedaH}
                onChange={e => { setBusquedaH(e.target.value); setPaginaH(1); }}
                style={{ width: 240, marginLeft: "auto" }}
              />
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>Patrón de horario</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>Agentes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginaItems.length === 0 ? (
                      <tr><td colSpan={2} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Sin datos de horarios.</td></tr>
                    ) : paginaItems.map((p, i) => (
                      <tr key={p.patron} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                        <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: "0.78rem", color: "#cbd5e1" }}>{p.patron}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>
                          <span
                            onClick={() => setPatronModal({ patron: p.patron, agentes: p.dnis.map(d => ({ dni: d, nombre: horariosAgentes[d]?.nombre ?? d })).sort((a, b) => a.nombre.localeCompare(b.nombre)) })}
                            style={{ ...badge, background: "rgba(99,102,241,0.18)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.35)", cursor: "pointer" }}
                          >
                            {p.cantidad}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacion pagina={paginaH} total={patrones.length} onChange={setPaginaH} />
            </div>
          </>
        );
      })()}

      {!loaded && !loading && (
        <div className="card" style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
          Seleccioná los archivos de horarios, el modo de consulta y presioná <strong>Cargar</strong>.
        </div>
      )}

      {/* ── Modal asistencia agente (doble click) ─────────────────────────── */}
      {agentModal && (
        <AgentModal
          agente={{ dni: agentModal.dni, nombre: agentModal.nombre, upa: agentModal.upa }}
          rows={rows}
          highlightInvertido={agentModal.invertido}
          onClose={() => setAgentModal(null)}
          siapNovedades={siapAgentes[agentModal.dni]?.novedades}
          horarioAgente={horariosAgentes[agentModal.dni]}
        />
      )}

      {/* ── Modal fichajes crudos DB (click en DNI) ───────────────────────── */}
      {fichajeRawModal && (
        <FichajeRawModal
          agente={fichajeRawModal}
          rawRows={fichajeRawRows}
          siapNovedades={siapAgentes[fichajeRawModal.dni]?.novedades}
          loading={fichajeRawLoading}
          horarioAgente={horariosAgentes[fichajeRawModal.dni]}
          onClose={() => { setFichajeRawModal(null); setFichajeRawRows([]); }}
        />
      )}

      {/* ── Modal fichó sin deber agente (doble click fila agrupada) ─────── */}
      {fichoDeberModal && (
        <FichoDeberModal
          agente={{ dni: fichoDeberModal.dni, nombre: fichoDeberModal.nombre, upa: fichoDeberModal.upa }}
          registros={fichoDeberModal.registros}
          onClose={() => setFichoDeberModal(null)}
        />
      )}

      {/* ── Modal agentes por patrón de horario ───────────────────────────── */}
      {patronModal && (
        <div
          onClick={() => setPatronModal(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, width: "min(520px, 94vw)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
          >
            <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#e2e8f0", marginBottom: 4 }}>Agentes con este horario</div>
                <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#818cf8", wordBreak: "break-word" }}>{patronModal.patron}</div>
              </div>
              <button onClick={() => setPatronModal(null)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "1.2rem", flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "8px 0 12px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <th style={{ padding: "7px 20px", textAlign: "left", fontWeight: 600, color: "#94a3b8", position: "sticky", top: 0, background: "#0f172a" }}>#</th>
                    <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", position: "sticky", top: 0, background: "#0f172a" }}>DNI</th>
                    <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600, color: "#94a3b8", position: "sticky", top: 0, background: "#0f172a" }}>Nombre</th>
                  </tr>
                </thead>
                <tbody>
                  {patronModal.agentes.map((a, i) => (
                    <tr key={a.dni} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                      <td style={{ padding: "7px 20px", color: "#475569", fontSize: "0.75rem" }}>{i + 1}</td>
                      <td style={{ padding: "7px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{a.dni}</td>
                      <td style={{ padding: "7px 12px", color: "#e2e8f0" }}>{a.nombre}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "8px 20px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "0.75rem", color: "#64748b", display: "flex", alignItems: "center", gap: 12 }}>
              <span>{patronModal.agentes.length} agente{patronModal.agentes.length !== 1 ? "s" : ""}</span>
              <button
                className="btn"
                style={{ marginLeft: "auto", fontSize: "0.75rem", padding: "3px 12px" }}
                onClick={() => {
                  const nombre = patronModal.patron.replace(/\s*\/\s*/g, " - ").slice(0, 60);
                  exportToExcel(`horario_${nombre}`, patronModal.agentes.map((a, i) => ({
                    "#":      i + 1,
                    DNI:      a.dni,
                    Nombre:   a.nombre,
                    Horario:  patronModal.patron,
                  })));
                }}
              >
                Exportar Excel
              </button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  );
}

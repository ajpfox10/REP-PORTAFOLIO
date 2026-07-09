// src/pages/SinFichajeSalidaPage/NotificacionesMailModal.tsx
//
// Formulario para notificar por mail (no-reply) a los agentes que NO ficharon la
// salida. Filtros en vivo (cliente). Doble-click en un agente => fichaje del mes
// con los días sin salida marcados en amarillo (del ATTLOG sincronizado).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/http";
import { useToast } from "../../ui/toast";

interface Props {
  open: boolean;
  onClose: () => void;
  periodo?: string;   // YYYY-MM
  desde?: string;     // YYYY-MM-DD
  hasta?: string;     // YYYY-MM-DD
}

interface TurnoFaceta { value: string; label: string; }
interface Facetas { servicios: string[]; ubicaciones: string[]; turnos: TurnoFaceta[]; }
interface DiaSS { fecha: string; turno: string; turnoLabel: string; }
interface HorarioDiaResumen { dia: string; entrada: string; salida: string; horas: number; turno: string; }
interface HorarioResumen { tipo: string; resumen: string; porDia: HorarioDiaResumen[]; esFranquero: boolean; diasSemana: number; horasSemana: number; }

const TIPO_COLOR: Record<string, { bg: string; fg: string }> = {
  Guardia: { bg: "#fde2c8", fg: "#8a4b00" },
  Semana: { bg: "#e5e7eb", fg: "#374151" },
  Franquero: { bg: "#dbeafe", fg: "#1e40af" },
  Rotativo: { bg: "#e9d5ff", fg: "#6b21a8" },
};
interface Coincidencia { estado: "coincide" | "parcial" | "no" | "sin_datos"; dias: boolean; hora: boolean; declara: string; ficha: string; }
interface AgentePreview {
  dni: string; nombre: string; servicio: string; ley: string; ubicacion: string;
  email: string | null; emailValido: boolean; dias: DiaSS[]; totalDias: number; mensaje: string;
  horario?: HorarioResumen; coincidencia?: Coincidencia;
}

const COINC: Record<string, { color: string; label: string; dot: string }> = {
  coincide: { color: "#1a7f37", label: "Coincide", dot: "🟢" },
  parcial: { color: "#b26a00", label: "Parcial", dot: "🟡" },
  no: { color: "#b02a37", label: "No coincide", dot: "🔴" },
  sin_datos: { color: "#888", label: "Sin datos", dot: "⚪" },
};
interface PreviewResp { ok: boolean; error?: string; dbError?: string; facetas: Facetas; agentes: AgentePreview[]; }
interface EnviarResp {
  ok: boolean; error?: string; total: number; enviados: number; fallidos: number;
  resultados: { dni: string; nombre: string; email: string; ok: boolean; error?: string }[]; aviso?: string;
}
interface FichajeRaw { fecha: string; hora: string; tipo: string; sn: string; }

const box: React.CSSProperties = { border: "1px solid #d0d0d0", borderRadius: 6, padding: "8px 10px", background: "#fff" };

// Copia robusta: navigator.clipboard requiere https/localhost; en http (192.168.x) usa fallback textarea.
function copiarTexto(texto: string): boolean {
  try {
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(texto); return true; }
  } catch { /* cae al fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function mensajeWhatsapp(nombre: string, dias: string[]): string {
  const lista = dias.join(", ");
  return `Buenos días. Se ha detectado que usted, el agente ${nombre}, no registró fichaje de SALIDA el/los día(s): ${lista}. ` +
    `Se le aclara que al no tener fichaje de salida se lo considera AUSENTE ese día. ` +
    `Ante cualquier consulta, continúe la comunicación por este medio.`;
}

export function NotificacionesMailModal({ open, onClose, periodo, desde, hasta }: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [facetas, setFacetas] = useState<Facetas>({ servicios: [], ubicaciones: [], turnos: [] });
  const [allAgentes, setAllAgentes] = useState<AgentePreview[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);

  const [servSel, setServSel] = useState<Set<string>>(new Set());
  const [turnoSel, setTurnoSel] = useState<Set<string>>(new Set());
  const [ubicSel, setUbicSel] = useState<Set<string>>(new Set());
  const [excluirResidentes, setExcluirResidentes] = useState(true);
  const [minDias, setMinDias] = useState(1);
  const [dniSel, setDniSel] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState(false);
  const [resultado, setResultado] = useState<EnviarResp | null>(null);
  const [detalle, setDetalle] = useState<{ agente: AgentePreview; loading: boolean; rows: FichajeRaw[]; fuente?: any } | null>(null);

  const rango = useMemo(() => {
    const b: any = {};
    if (periodo) b.periodo = periodo;
    if (desde && hasta) { b.desde = desde; b.hasta = hasta; }
    return b;
  }, [periodo, desde, hasta]);

  const cargarPreview = useCallback(async () => {
    setLoading(true); setResultado(null);
    try {
      const r = await apiFetch<PreviewResp>("/sin-salida/notificaciones/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rango),
      });
      setDbError(r.dbError ?? null);
      setFacetas(r.facetas ?? { servicios: [], ubicaciones: [], turnos: [] });
      setAllAgentes(r.agentes ?? []);
    } catch (e: any) {
      toast.error(e?.message || "Error al previsualizar");
    } finally { setLoading(false); }
  }, [rango, toast]);

  useEffect(() => { if (open) cargarPreview(); /* eslint-disable-next-line */ }, [open]);

  // ── filtrado EN VIVO (cliente) ──
  const filtrados = useMemo(() => {
    return allAgentes.filter(a => {
      if (excluirResidentes && /RESIDENTE/i.test(a.ley)) return false;
      if (servSel.size && !servSel.has(a.servicio)) return false;
      if (ubicSel.size && !ubicSel.has(a.ubicacion)) return false;
      const dias = turnoSel.size ? a.dias.filter(d => turnoSel.has(d.turno)) : a.dias;
      if (dias.length < minDias) return false;
      return true;
    }).map(a => turnoSel.size ? { ...a, dias: a.dias.filter(d => turnoSel.has(d.turno)), totalDias: a.dias.filter(d => turnoSel.has(d.turno)).length } : a)
      .sort((x, y) => y.totalDias - x.totalDias || x.nombre.localeCompare(y.nombre));
  }, [allAgentes, servSel, turnoSel, ubicSel, excluirResidentes, minDias]);

  // al cambiar el filtro, seleccionar por defecto todos los que tienen mail válido
  useEffect(() => {
    setDniSel(new Set(filtrados.filter(a => a.emailValido).map(a => a.dni)));
  }, [filtrados]);

  const conMail = filtrados.filter(a => a.emailValido).length;
  const seleccionados = filtrados.filter(a => a.emailValido && dniSel.has(a.dni));

  const toggle = (set: Set<string>, val: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(val) ? n.delete(val) : n.add(val); setter(n);
  };

  const abrirDetalle = useCallback(async (a: AgentePreview) => {
    setDetalle({ agente: a, loading: true, rows: [] });
    try {
      // Fichajes del período desde el checkinout sincronizado (cubre TODOS los relojes,
      // y ya está verificado que es idéntico al ATTLOG del aparato).
      const r = await apiFetch<{ ok: boolean; data: FichajeRaw[] }>("/sin-salida/fichajes-agente", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dni: a.dni, ...rango }),
      });
      setDetalle({ agente: a, loading: false, rows: r.data ?? [] });
    } catch (e: any) {
      toast.error(e?.message || "Error al traer fichajes");
      setDetalle({ agente: a, loading: false, rows: [] });
    }
  }, [rango, toast]);

  const enviar = async () => {
    if (!confirmar) { toast.error("Confirmá la casilla antes de enviar"); return; }
    if (seleccionados.length === 0) { toast.error("No hay agentes con email válido seleccionados"); return; }
    setSending(true);
    try {
      const body: any = {
        ...rango, servicios: [...servSel], turnos: [...turnoSel], ubicaciones: [...ubicSel],
        excluirResidentes, minDias, soloDni: seleccionados.map(a => a.dni), confirmar: true,
      };
      const r = await apiFetch<EnviarResp>("/sin-salida/notificaciones/enviar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      setResultado(r);
      if (r.ok) toast.ok(`Enviados ${r.enviados}/${r.total}`); else toast.error(r.error || "Error al enviar");
    } catch (e: any) {
      toast.error(e?.message || "Error al enviar");
    } finally { setSending(false); setConfirmar(false); }
  };

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto", padding: 20 }}>
      <div style={{ background: "#f7f7f8", color: "#222", borderRadius: 10, width: "min(1050px, 96vw)", boxShadow: "0 10px 40px rgba(0,0,0,.3)", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: "#222" }}>📧 Notificar "sin salida" por mail (no-reply)</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#222" }}>✕</button>
        </div>

        <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>
          Período: <strong>{periodo || (desde && hasta ? `${desde} → ${hasta}` : "—")}</strong>.
          Solo se notifica a agentes con <strong>salida realmente no fichada</strong>. Doble-click en un agente para ver su fichaje del mes.
        </div>

        {dbError && <div style={{ ...box, background: "#fff3cd", border: "1px solid #ffe08a", marginBottom: 10 }}>⚠️ {dbError}</div>}

        {/* Filtros */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={box}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Servicios ({servSel.size || "todos"})</div>
            <div style={{ maxHeight: 150, overflow: "auto", fontSize: 12 }}>
              {facetas.servicios.map(s => (
                <label key={s} style={{ display: "block", cursor: "pointer" }}>
                  <input type="checkbox" checked={servSel.has(s)} onChange={() => toggle(servSel, s, setServSel)} /> {s || "(sin servicio)"}
                </label>
              ))}
              {facetas.servicios.length === 0 && <span style={{ color: "#999" }}>—</span>}
            </div>
          </div>
          <div style={box}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Turnos</div>
            {facetas.turnos.map(t => (
              <label key={t.value} style={{ display: "block", cursor: "pointer", fontSize: 12 }}>
                <input type="checkbox" checked={turnoSel.has(t.value)} onChange={() => toggle(turnoSel, t.value, setTurnoSel)} /> {t.label}
              </label>
            ))}
            <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0 6px" }}>Ubicación</div>
            {facetas.ubicaciones.map(u => (
              <label key={u} style={{ display: "block", cursor: "pointer", fontSize: 12 }}>
                <input type="checkbox" checked={ubicSel.has(u)} onChange={() => toggle(ubicSel, u, setUbicSel)} /> {u}
              </label>
            ))}
          </div>
          <div style={box}>
            <label style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
              <input type="checkbox" checked={excluirResidentes} onChange={e => setExcluirResidentes(e.target.checked)} /> Excluir residentes
            </label>
            <label style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
              Mínimo de días sin salida:{" "}
              <input type="number" min={1} value={minDias} onChange={e => setMinDias(Math.max(1, Number(e.target.value) || 1))} style={{ width: 56 }} />
            </label>
            <button onClick={cargarPreview} disabled={loading} style={{ width: "100%", padding: "8px", borderRadius: 6, border: "1px solid #2E5FA3", background: "#2E5FA3", color: "#fff", cursor: "pointer" }}>
              {loading ? "Cargando…" : "↻ Recargar del período"}
            </button>
          </div>
        </div>

        {/* Resumen */}
        <div style={{ ...box, marginBottom: 10, fontSize: 13, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>Seleccionados: <strong>{filtrados.length}</strong></span>
          <span style={{ color: "#1a7f37" }}>Con email válido: <strong>{conMail}</strong></span>
          <span style={{ color: "#b02a37" }}>Sin email: <strong>{filtrados.length - conMail}</strong></span>
          <span style={{ marginLeft: "auto" }}>A enviar: <strong>{seleccionados.length}</strong></span>
        </div>

        {/* Tabla */}
        <div style={{ ...box, maxHeight: 300, overflow: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#222" }}>
            <thead style={{ position: "sticky", top: 0, background: "#eaeaea" }}>
              <tr>
                <th style={{ padding: 6 }}><input type="checkbox"
                  checked={seleccionados.length > 0 && seleccionados.length === conMail}
                  onChange={e => setDniSel(e.target.checked ? new Set(filtrados.filter(a => a.emailValido).map(a => a.dni)) : new Set())} /></th>
                <th style={{ textAlign: "left", padding: 6 }}>Agente</th>
                <th style={{ textAlign: "left", padding: 6 }}>Servicio</th>
                <th style={{ textAlign: "left", padding: 6 }}>Ubic.</th>
                <th style={{ textAlign: "center", padding: 6 }}>Días</th>
                <th style={{ textAlign: "left", padding: 6 }}>Email</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(a => (
                <tr key={a.dni} onDoubleClick={() => abrirDetalle(a)} title="Doble-click: ver fichaje del mes"
                  style={{ borderTop: "1px solid #eee", opacity: a.emailValido ? 1 : 0.55, cursor: "pointer" }}>
                  <td style={{ textAlign: "center", padding: 6 }}>
                    <input type="checkbox" disabled={!a.emailValido} checked={dniSel.has(a.dni)}
                      onClick={e => e.stopPropagation()}
                      onChange={() => { const n = new Set(dniSel); n.has(a.dni) ? n.delete(a.dni) : n.add(a.dni); setDniSel(n); }} />
                  </td>
                  <td style={{ padding: 6 }}>
                    {a.coincidencia && <span title={`Horario ${COINC[a.coincidencia.estado].label} — Declara: ${a.coincidencia.declara} · Ficha: ${a.coincidencia.ficha}`}>{COINC[a.coincidencia.estado].dot} </span>}
                    {a.nombre} <span style={{ color: "#999" }}>({a.dni})</span>
                  </td>
                  <td style={{ padding: 6 }}>{a.servicio}</td>
                  <td style={{ padding: 6 }}>{a.ubicacion}</td>
                  <td style={{ textAlign: "center", padding: 6 }} title={a.dias.map(d => d.fecha).join(", ")}>{a.totalDias}</td>
                  <td style={{ padding: 6 }}>{a.email || "—"} {a.email && !a.emailValido && <span style={{ color: "#b02a37" }}>(inválido)</span>}</td>
                </tr>
              ))}
              {filtrados.length === 0 && !loading && <tr><td colSpan={6} style={{ padding: 14, textAlign: "center", color: "#999" }}>Sin resultados para el filtro</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Envío */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={confirmar} onChange={e => setConfirmar(e.target.checked)} />{" "}
            Confirmo enviar {seleccionados.length} mail(s) a los agentes seleccionados.
          </label>
          <button onClick={enviar} disabled={sending || !confirmar || seleccionados.length === 0}
            style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 6, border: "none",
              background: sending || !confirmar ? "#9bb" : "#1a7f37", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
            {sending ? "Enviando…" : `Enviar ${seleccionados.length} mail(s)`}
          </button>
        </div>

        {/* Resultado */}
        {resultado && (
          <div style={{ ...box, marginTop: 10, fontSize: 13 }}>
            <div>✅ Enviados: <strong>{resultado.enviados}</strong> / {resultado.total} {resultado.fallidos ? `— ❌ fallidos: ${resultado.fallidos}` : ""}</div>
            {resultado.aviso && <div style={{ color: "#b26a00" }}>{resultado.aviso}</div>}
            {resultado.resultados?.some(r => !r.ok) && (
              <div style={{ marginTop: 6, maxHeight: 120, overflow: "auto" }}>
                {resultado.resultados.filter(r => !r.ok).map(r => (
                  <div key={r.dni} style={{ color: "#b02a37" }}>{r.nombre} ({r.email}): {r.error}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {detalle && <DetalleFichaje detalle={detalle} onClose={() => setDetalle(null)} />}
    </div>
  );
}

// ── Panel de detalle: fichaje del mes con días sin salida en amarillo ──────────
function DetalleFichaje({ detalle, onClose }: { detalle: { agente: AgentePreview; loading: boolean; rows: FichajeRaw[]; fuente?: any }; onClose: () => void }) {
  const { agente, loading, rows, fuente } = detalle;
  const toast = useToast();
  const sinSalidaSet = useMemo(() => new Set(agente.dias.map(d => d.fecha)), [agente]);
  const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const diaSemana = (fecha: string) => DOW[new Date(fecha + "T00:00:00").getDay()];
  const fmtFecha = (fecha: string) => `${diaSemana(fecha)} ${fecha.split("-").reverse().join("/")}`;

  // agrupar por día
  const dias = useMemo(() => {
    const m: Record<string, { entrada: string | null; salida: string | null; marcas: FichajeRaw[] }> = {};
    for (const p of rows) {
      const d = (m[p.fecha] = m[p.fecha] || { entrada: null, salida: null, marcas: [] });
      d.marcas.push(p);
      if (p.tipo === "Entrada") { if (!d.entrada || p.hora < d.entrada) d.entrada = p.hora; }
      else { if (!d.salida || p.hora > d.salida) d.salida = p.hora; }
    }
    return Object.entries(m).map(([fecha, v]) => ({ fecha, ...v })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [rows]);

  // resumen de los días
  const resumenDias = useMemo(() => {
    let conSalida = 0, sinSalida = 0;
    for (const d of dias) {
      const ss = sinSalidaSet.has(d.fecha) || (!!d.entrada && !d.salida);
      if (ss) sinSalida++; else if (d.entrada || d.salida) conSalida++;
    }
    return { total: dias.length, conSalida, sinSalida };
  }, [dias, sinSalidaSet]);

  // lista de días sin salida (para el mensaje de WhatsApp)
  const diasSinSalidaLista = useMemo(
    () => dias.filter(d => sinSalidaSet.has(d.fecha) || (!!d.entrada && !d.salida)).map(d => fmtFecha(d.fecha)),
    [dias, sinSalidaSet], // eslint-disable-line
  );
  const copiarMensaje = () => {
    if (diasSinSalidaLista.length === 0) { toast.error("No hay días sin salida para este agente"); return; }
    const ok = copiarTexto(mensajeWhatsapp(agente.nombre, diasSinSalidaLista));
    if (ok) toast.ok(`Mensaje copiado (${diasSinSalidaLista.length} día/s)`); else toast.error("No se pudo copiar");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto", padding: 24 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", color: "#222", borderRadius: 10, width: "min(560px, 94vw)", padding: 16, boxShadow: "0 10px 40px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{agente.nombre} <span style={{ color: "#999" }}>({agente.dni})</span></h3>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        {agente.horario && (
          <div style={{ fontSize: 12.5, marginBottom: 8, padding: "8px 10px", background: "#f6f6f6", border: "1px solid #dcdcdc", borderRadius: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11,
                background: (TIPO_COLOR[agente.horario.tipo] || TIPO_COLOR.Semana).bg,
                color: (TIPO_COLOR[agente.horario.tipo] || TIPO_COLOR.Semana).fg }}>{agente.horario.tipo}</span>
              <span>📋 {agente.horario.diasSemana} día{agente.horario.diasSemana === 1 ? "" : "s"} · {agente.horario.horasSemana}h/sem</span>
            </div>
            <div style={{ color: "#333" }}>{agente.horario.resumen || "(sin horario cargado)"}</div>
            <div style={{ marginTop: 4, color: "#555" }}>{agente.servicio} · {agente.ubicacion}</div>
          </div>
        )}
        {agente.coincidencia && (
          <div style={{ fontSize: 12.5, marginBottom: 8, padding: "8px 10px", borderRadius: 6, border: `1px solid ${COINC[agente.coincidencia.estado].color}`, background: COINC[agente.coincidencia.estado].color + "14" }}>
            <div style={{ fontWeight: 700, color: COINC[agente.coincidencia.estado].color, marginBottom: 3 }}>
              {COINC[agente.coincidencia.estado].dot} Horario declarado vs fichado: {COINC[agente.coincidencia.estado].label}
              <span style={{ marginLeft: 10, fontWeight: 400 }}>
                <span style={{ color: agente.coincidencia.dias ? "#1a7f37" : "#b02a37" }}>Días {agente.coincidencia.dias ? "✓" : "✗"}</span>
                {" · "}
                <span style={{ color: agente.coincidencia.hora ? "#1a7f37" : "#b02a37" }}>Hora {agente.coincidencia.hora ? "✓" : "✗"}</span>
              </span>
            </div>
            <div style={{ color: "#333" }}>
              <strong>Declara:</strong> {agente.coincidencia.declara}{"  "}
              <strong style={{ marginLeft: 8 }}>Ficha:</strong>{" "}
              <span style={{ color: COINC[agente.coincidencia.estado].color, fontWeight: 600 }}>{agente.coincidencia.ficha}</span>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          Fichaje del período — <span style={{ background: "#fff3a3", padding: "1px 6px", borderRadius: 3 }}>amarillo</span> = no fichó la salida.
          {" "}Fuente: fichaje sincronizado (todos los relojes){fuente ? "" : ""}.
        </div>
        {!loading && (
          <div style={{ fontSize: 12.5, marginBottom: 8, display: "flex", gap: 16, alignItems: "center" }}>
            <span>Días con fichaje: <strong>{resumenDias.total}</strong></span>
            <span style={{ color: "#1a7f37" }}>Con salida: <strong>{resumenDias.conSalida}</strong></span>
            <span style={{ color: "#b02a37" }}>Sin salida: <strong>{resumenDias.sinSalida}</strong></span>
            <button onClick={copiarMensaje} disabled={diasSinSalidaLista.length === 0}
              title="Copia el mensaje para enviar por WhatsApp con la lista de días sin salida"
              style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 6, border: "none", cursor: diasSinSalidaLista.length ? "pointer" : "default", background: diasSinSalidaLista.length ? "#25D366" : "#bbb", color: "#fff", fontWeight: 600 }}>
              📋 Copiar mensaje WhatsApp
            </button>
          </div>
        )}
        {loading ? <div style={{ padding: 20, textAlign: "center", color: "#888" }}>Cargando fichajes…</div> : (
          <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid #e0e0e0", borderRadius: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead style={{ position: "sticky", top: 0, background: "#eee" }}>
                <tr><th style={{ textAlign: "left", padding: 6 }}>Día / Fecha</th><th style={{ padding: 6 }}>Entrada</th><th style={{ padding: 6 }}>Salida</th></tr>
              </thead>
              <tbody>
                {dias.map(d => {
                  const sinSalida = sinSalidaSet.has(d.fecha) || (!!d.entrada && !d.salida);
                  const finde = [0, 6].includes(new Date(d.fecha + "T00:00:00").getDay());
                  return (
                    <tr key={d.fecha} style={{ borderTop: "1px solid #eee", background: sinSalida ? "#fff3a3" : "transparent" }}>
                      <td style={{ padding: 6 }}>
                        <span style={{ display: "inline-block", width: 34, fontWeight: 600, color: finde ? "#1e40af" : "#444" }}>{diaSemana(d.fecha)}</span>
                        {d.fecha.split("-").reverse().join("/")}
                      </td>
                      <td style={{ padding: 6, textAlign: "center" }}>{d.entrada || "—"}</td>
                      <td style={{ padding: 6, textAlign: "center", fontWeight: sinSalida ? 700 : 400, color: sinSalida ? "#b02a37" : "#222" }}>
                        {sinSalida
                          ? <span onClick={copiarMensaje} title="Copiar mensaje de WhatsApp con todos los días sin salida" style={{ cursor: "pointer", textDecoration: "underline dotted" }}>SIN SALIDA</span>
                          : (d.salida || "—")}
                      </td>
                    </tr>
                  );
                })}
                {dias.length === 0 && <tr><td colSpan={3} style={{ padding: 14, textAlign: "center", color: "#999" }}>Sin fichajes en el período</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

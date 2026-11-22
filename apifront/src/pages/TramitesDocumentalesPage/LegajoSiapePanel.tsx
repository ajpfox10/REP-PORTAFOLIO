import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Legajo Digital SIAPE: baja de SIAPE (Personas → Administración → LEGAJO DIGITAL, trámite
// "PASE A PLANTA PERMANENTE 2026") el CURRICULUM VITAE y la PLANILLA DE DATOS PERSONALES Y DE
// CONTACTOS (la de fecha más nueva) a DOCU\<dni>\Curriculum y \Planilla de datos personales.
// Lo hace el robot scripts/descargar_legajo_digital_siape.py (robots_config siape_legajo_digital):
// tarda ~6 min por agente y usa SIAPE, así que se lanza y se sigue el avance (respeta el turno de
// los demás robots de SIAPE). Back: GET/POST /tramites-documentales/tandas/legajo-digital.
// ─────────────────────────────────────────────────────────────────────────────

type Ultimo = { estado: string; sinTramite: boolean; detalle: string; fecha: string } | null;
type Row = { dni: number; apellido: string; nombre: string; cv: string | null; planilla: string | null; constancia: string | null; ultimo: Ultimo };
type Robot = {
  corriendo: boolean; enCola: boolean; noArranco?: boolean; pedidoAt?: string | null; tanda: string | null; total: number | null; hechos: number | null;
  actual: { dni: number; nombre: string } | null; inicio: string | null; fin: string | null;
  bajados: number | null; errores: number | null; error: string | null;
};
type Datos = { tanda: string; rows: Row[]; robot: Robot };

const BORDER = '1px solid rgba(255,255,255,0.1)';
const VERDE = '#22c55e';
const GRIS = '#64748b';
const AMBAR = '#f59e0b';
const ROJO = '#ef4444';

// "Curriculum SIAPE 16-11-2026.pdf" → "16/11/2026"
function fechaArchivo(f: string | null) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(f || '');
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

function hora(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function LegajoSiapePanel({ tanda, onCerrar }: { tanda: string; onCerrar: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [lanzando, setLanzando] = useState(false);
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<{ ok: boolean; data: Datos }>(`/tramites-documentales/tandas/legajo-digital?tanda=${encodeURIComponent(tanda)}`);
      setData(r.data);
    } catch (e: any) {
      toast.error('No se pudo leer el estado', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
  }, [tanda]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void cargar(); }, [cargar]);

  // mientras corre (o espera turno) se refresca solo
  const activo = !!data && (data.robot.corriendo || data.robot.enCola);
  useEffect(() => {
    if (!activo) return undefined;
    const id = window.setInterval(() => { void cargar(); }, 15000);
    return () => window.clearInterval(id);
  }, [activo, cargar]);

  const rows = data?.rows || [];
  const completo = (r: Row) => !!r.cv && !!r.planilla && !!r.constancia;
  const fuera = (r: Row) => !!r.ultimo?.sinTramite;
  const pendiente = (r: Row) => !completo(r) && !fuera(r);
  const filas = rows.filter((r) => !soloPendientes || pendiente(r) || r.ultimo?.estado === 'error');
  const nPend = rows.filter(pendiente).length;
  const nCompletos = rows.filter(completo).length;
  const nFuera = rows.filter((r) => fuera(r) && !completo(r)).length;
  // la última corrida dijo "<doc>: no esta en SIAPE" = en SIAPE figura en rojo, sin fecha: el agente no lo hizo
  const noHecho = (r: Row, doc: 'Curriculum' | 'Planilla de datos personales' | 'Constancia de Aceptacion SIAPE') =>
    !!r.ultimo && !r.ultimo.sinTramite && new RegExp(`${doc}: no esta en SIAPE`).test(r.ultimo.detalle);
  // el robot corta al agente si los antecedentes penales (provincial / reincidencia) están en rojo en SIAPE
  const sinDoc = (r: Row) => !!r.ultimo && /^sin_documentacion/.test(r.ultimo.detalle);
  const nSinDoc = rows.filter((r) => !completo(r) && sinDoc(r)).length;
  const nPlanillaNoHecha = rows.filter((r) => !r.planilla && noHecho(r, 'Planilla de datos personales')).length;
  const nCvNoHecho = rows.filter((r) => !r.cv && noHecho(r, 'Curriculum')).length;
  const conCv = rows.filter((r) => !!r.cv).length;
  const conPlanilla = rows.filter((r) => !!r.planilla).length;

  async function lanzar() {
    if (!data) return;
    const dnis = elegidos.size ? Array.from(elegidos) : undefined;
    const cuantos = dnis ? dnis.length : nPend;
    if (!cuantos) return;
    const min = cuantos * 6;
    if (!window.confirm(
      `Se va a abrir SIAPE y bajar el CV, la Planilla de datos personales y la Constancia acepto designación de ${cuantos} agente(s)` +
      `${dnis ? ' elegidos' : ' a los que les falta algo'} de "${tanda}".\n\n` +
      `Tarda unos 6 minutos por agente (~${min >= 60 ? `${Math.round(min / 60 * 10) / 10} h` : `${min} min`}). ` +
      `Mientras corre no uses SIAPE en esta máquina. Si otro robot de SIAPE está corriendo, espera su turno.\n\n¿Seguir?`,
    )) return;
    setLanzando(true);
    try {
      await apiFetch('/tramites-documentales/tandas/legajo-digital', {
        method: 'POST',
        body: JSON.stringify({ tanda, ...(dnis ? { dnis } : {}) }),
      });
      toast.ok('Legajo SIAPE', 'Robot lanzado. El avance se actualiza solo.');
      setElegidos(new Set());
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo lanzar el robot', e?.message || 'Error');
    } finally {
      setLanzando(false);
    }
  }

  function toggle(dni: number) {
    setElegidos((prev) => {
      const s = new Set(prev);
      if (s.has(dni)) s.delete(dni); else s.add(dni);
      return s;
    });
  }

  const rb = data?.robot;
  const bloqueado = lanzando || activo || (elegidos.size === 0 && nPend === 0);

  return (
    <div style={{ border: BORDER, borderRadius: 10, padding: 12, background: 'rgba(3,105,161,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0' }}>⬇️ Legajo SIAPE — "{tanda}"</b>
        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>CV, Planilla de datos personales y Constancia acepto designación · PASE A PLANTA PERMANENTE 2026</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => { setCargando(true); void cargar(); }} style={btn(false)}>↻ Actualizar</button>
        <button type="button" onClick={onCerrar} style={btn(false)}>Cerrar</button>
      </div>

      <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
        Entra a SIAPE (Personas → Administración → <b>LEGAJO DIGITAL</b>), elige el trámite <b>PASE A PLANTA PERMANENTE 2026</b> y
        baja el <b>CURRICULUM VITAE</b>, la <b>PLANILLA DE DATOS PERSONALES Y DE CONTACTOS</b> y la <b>CONSTANCIA ACEPTO DESIGNACION</b> de fecha más nueva a{' '}
        <code>DOCU\&lt;dni&gt;\Curriculum</code>, <code>\Planilla de datos personales</code> y <code>\Constancia de Aceptacion SIAPE</code> (crea las carpetas si no están).
        Si los antecedentes penales están en rojo en SIAPE, solo baja la constancia.
        Quien no tiene ese trámite en SIAPE no está en la tanda 2026. No borra ni pisa nada. El <b>📦 Pase a planta</b> los toma de ahí.
      </div>

      {rb && (rb.corriendo || rb.enCola) ? (
        <div style={{ fontSize: '0.8rem', color: '#e2e8f0', background: 'rgba(96,165,250,0.12)', border: BORDER, borderRadius: 8, padding: '6px 10px' }}>
          {rb.corriendo ? (
            <>⏳ Corriendo{rb.tanda && rb.tanda !== tanda ? ` (tanda "${rb.tanda}")` : ''}: {rb.hechos ?? 0} de {rb.total ?? '?'}
              {rb.actual ? <> · ahora con <b>{rb.actual.nombre}</b> (DNI {rb.actual.dni})</> : null}
              <span style={{ color: '#94a3b8' }}> · desde {hora(rb.inicio)} · ~6 min por agente</span></>
          ) : (
            <>🕒 En cola: espera que termine otro robot de SIAPE para arrancar.</>
          )}
        </div>
      ) : rb?.noArranco ? (
        <div style={{ fontSize: '0.8rem', color: '#fde68a', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 8, padding: '6px 10px' }}>
          ⚠️ El pedido de las {hora(rb.pedidoAt ?? null)} no arrancó (ningún robot de SIAPE lo está haciendo esperar). Volvé a tocar <b>Bajar de SIAPE</b>;
          si se repite, mirá el banner de robots fallidos en el inicio.
        </div>
      ) : rb?.fin ? (
        <div style={{ fontSize: '0.78rem', color: rb.error || rb.errores ? AMBAR : '#94a3b8' }}>
          Última corrida{rb.tanda ? ` ("${rb.tanda}")` : ''}: terminó {hora(rb.fin)}
          {rb.bajados != null ? ` · ${rb.bajados} con descargas` : ''}{rb.errores ? ` · ${rb.errores} con error` : ''}
          {rb.error ? ` · se cortó: ${rb.error}` : ''}
        </div>
      ) : null}

      {cargando && !data ? (
        <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Leyendo…</div>
      ) : data ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: '0.8rem', color: '#cbd5e1' }}>
            <span>{rows.length} agente(s)</span>
            <span style={{ color: VERDE }}>✅ {nCompletos} completos</span>
            <span>CV {conCv} · Planilla {conPlanilla}</span>
            {nSinDoc ? (
              <span style={{ color: ROJO }} title="Antecedentes penales en rojo en SIAPE: el robot no baja nada de ellos">
                ✗ sin antecedentes penales: {nSinDoc}
              </span>
            ) : null}
            {nPlanillaNoHecha || nCvNoHecho ? (
              <span style={{ color: ROJO }} title="En SIAPE figura en rojo (sin fecha): el agente todavía no lo hizo">
                ✗ no hechos en SIAPE: {nPlanillaNoHecha ? `Planilla ${nPlanillaNoHecha}` : ''}{nPlanillaNoHecha && nCvNoHecho ? ' · ' : ''}{nCvNoHecho ? `CV ${nCvNoHecho}` : ''}
              </span>
            ) : null}
            {nFuera ? <span style={{ color: GRIS }}>{nFuera} sin trámite 2026 en SIAPE</span> : null}
            <span style={{ color: AMBAR }}>{nPend} con algo pendiente</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
              ver solo pendientes
            </label>
            <span style={{ flex: 1 }} />
            {elegidos.size ? (
              <button type="button" onClick={() => setElegidos(new Set())} style={btn(false)}>Quitar selección ({elegidos.size})</button>
            ) : null}
            <button type="button" onClick={() => void lanzar()} disabled={bloqueado}
              title={activo ? 'Ya está corriendo o en cola' : 'Abre SIAPE y baja lo que falta'}
              style={{ ...btn(bloqueado), background: bloqueado ? 'rgba(255,255,255,0.06)' : '#0369a1', color: '#fff' }}>
              {lanzando ? 'Lanzando…' : elegidos.size ? `⬇️ Bajar de SIAPE (${elegidos.size} elegido/s)` : `⬇️ Bajar de SIAPE (${nPend} pendiente/s)`}
            </button>
          </div>

          <div style={{ maxHeight: 380, overflow: 'auto', border: BORDER, borderRadius: 8 }}>
            {!filas.length ? (
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: 10 }}>No queda nada pendiente.</div>
            ) : filas.map((r) => {
              const enCurso = rb?.corriendo && rb.actual?.dni === r.dni;
              const err = r.ultimo?.estado === 'error';
              return (
                <div key={r.dni} style={{
                  padding: '6px 10px', borderBottom: BORDER, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                  background: enCurso ? 'rgba(96,165,250,0.12)' : 'transparent',
                }}>
                  <input type="checkbox" checked={elegidos.has(r.dni)} onChange={() => toggle(r.dni)} disabled={activo}
                    title="Elegir para bajar solo estos (aunque ya tengan los archivos)" />
                  <span style={{ color: '#e2e8f0', fontSize: '0.8rem', minWidth: 260 }}>
                    {r.apellido}, {r.nombre} <span style={{ color: GRIS }}>· DNI {r.dni}</span>
                    {enCurso ? <span style={{ color: '#60a5fa' }}> · ⏳ ahora</span> : null}
                  </span>
                  <span title={r.cv || (noHecho(r, 'Curriculum') ? 'En SIAPE figura en rojo: el agente no lo hizo' : '')}
                    style={{ color: r.cv ? VERDE : noHecho(r, 'Curriculum') ? ROJO : GRIS, fontSize: '0.78rem', minWidth: 120 }}>
                    CV: {r.cv ? `✓ ${fechaArchivo(r.cv)}` : noHecho(r, 'Curriculum') ? '✗ no hecho' : '—'}
                  </span>
                  <span title={r.planilla || (noHecho(r, 'Planilla de datos personales') ? 'En SIAPE figura en rojo: el agente no la hizo' : '')}
                    style={{ color: r.planilla ? VERDE : noHecho(r, 'Planilla de datos personales') ? ROJO : GRIS, fontSize: '0.78rem', minWidth: 140 }}>
                    Planilla: {r.planilla ? `✓ ${fechaArchivo(r.planilla)}` : noHecho(r, 'Planilla de datos personales') ? '✗ no hecha' : '—'}
                  </span>
                  <span title={r.constancia || (noHecho(r, 'Constancia de Aceptacion SIAPE') ? 'En SIAPE figura en rojo: el agente no la hizo' : '')}
                    style={{ color: r.constancia ? VERDE : noHecho(r, 'Constancia de Aceptacion SIAPE') ? ROJO : GRIS, fontSize: '0.78rem', minWidth: 150 }}>
                    Constancia: {r.constancia ? `✓ ${fechaArchivo(r.constancia)}` : noHecho(r, 'Constancia de Aceptacion SIAPE') ? '✗ no hecha' : '—'}
                  </span>
                  {r.ultimo ? (
                    <span title={r.ultimo.detalle} style={{ color: err ? ROJO : r.ultimo.sinTramite ? GRIS : '#94a3b8', fontSize: '0.74rem', flex: 1, minWidth: 200 }}>
                      {r.ultimo.sinTramite
                        ? 'No está en la tanda 2026 de SIAPE'
                        : sinDoc(r)
                          ? <span style={{ color: ROJO }}>✗ No hizo los antecedentes penales en SIAPE: no se bajó CV ni Planilla (solo la constancia)</span>
                        : err ? `❌ ${r.ultimo.detalle.replace(/^error:\s*/, '').slice(0, 160)}`
                          : /no esta en SIAPE/.test(r.ultimo.detalle) && !(r.cv && r.planilla && r.constancia)
                            ? 'Lo que está en ✗ no lo hizo en SIAPE (figura en rojo)'
                            : ''}
                      <span style={{ color: '#475569' }}> {hora(r.ultimo.fecha)}</span>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function btn(disabled: boolean): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 8, padding: '5px 10px',
    color: disabled ? '#475569' : '#e2e8f0', fontSize: '0.78rem', cursor: disabled ? 'default' : 'pointer',
  };
}

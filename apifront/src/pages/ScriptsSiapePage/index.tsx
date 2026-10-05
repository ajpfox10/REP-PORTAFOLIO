// src/pages/ScriptsSiapePage/index.tsx
// Robots de automatización (SIAPE, Intranet MS...): estado de la última corrida,
// historial completo de corridas, programación y a dónde deja cada uno su archivo.
// Catálogo y configuración: tabla robots_config · corridas: tabla script_runs.

import React, { useEffect, useMemo, useState } from 'react';
import { Layout }   from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { lanzarRobot, estaCorriendo } from '../../components/RobotsFallidosBanner';

interface EstadoTarea {
  existe: boolean;
  estado?: string;            // Ready / Running / Disabled
  proxima?: string | null;
  ultima?: string | null;
  ultimoResultado?: number | null;
}

interface Robot {
  script:           string;
  descripcion:      string;
  grupo:            string;
  comando:          string | null;
  reporta_solo:     number;
  prog_activa:      number;
  prog_dias:        string;
  prog_cada_n_dias: number | null;
  prog_hora:        string | null;
  tarea_windows:    string | null;
  destino_dir:      string | null;
  destino_nombre:   string | null;
  destino_editable: number;
  lo_leen:          string | null;
  notas:            string | null;
  estado:           'ok' | 'error' | null;
  motivo:           string | null;
  filas:            number | null;
  archivo:          string | null;
  duracion_seg:     number | null;
  actualizado_at:   string | null;
  corridas:         number;
  errores:          number;
  run_id:           number | null;
  items:            number;
  items_error:      number;
  tarea?:           EstadoTarea;          // su tarea propia \Robots\<script>
  tarea_vieja?:     EstadoTarea | null;   // la tarea de Windows que lo corría antes
}

interface Item {
  id:          number;
  script:      string;
  descripcion: string | null;
  dni:         string | null;
  nombre:      string | null;
  novedad:     string | null;
  desde:       string | null;
  hasta:       string | null;
  estado:      'ok' | 'error' | 'aviso';
  detalle:     string | null;
  creado_at:   string;
}

interface Corrida {
  id:             number;
  items:          number;
  items_error:    number;
  items_aviso:    number;
  script:         string;
  descripcion:    string | null;
  estado:         'ok' | 'error';
  motivo:         string | null;
  filas:          number | null;
  archivo:        string | null;
  duracion_seg:   number | null;
  actualizado_at: string;
}

const DIAS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO'];

const S: Record<string, React.CSSProperties> = {
  card:    { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 20, marginBottom: 16 },
  titulo:  { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, color: '#94a3b8' },
  table:   { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  th:      { textAlign: 'left' as const, padding: '8px 10px', color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.10)' },
  td:      { padding: '10px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'top' as const },
  tagGreen:{ background: '#14532d', color: '#86efac', borderRadius: 6, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, display: 'inline-block' },
  tagRed:  { background: '#450a0a', color: '#fca5a5', borderRadius: 6, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, display: 'inline-block' },
  tagGris: { background: 'rgba(255,255,255,0.06)', color: '#94a3b8', borderRadius: 6, padding: '3px 10px', fontSize: '0.72rem', display: 'inline-block' },
  muted:   { color: '#64748b', fontSize: '0.75rem' },
  input:   { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: 'inherit', padding: '4px 8px', fontSize: '0.8rem' },
  btn:     { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: 'inherit', padding: '4px 12px', fontSize: '0.78rem', cursor: 'pointer' },
  aviso:   { background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#fcd34d', borderRadius: 8, padding: '8px 12px', fontSize: '0.78rem', marginBottom: 12 },
};

function fmtFechaHora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuracion(seg: number | null): string {
  if (seg == null) return '';
  if (seg < 60) return `${seg}s`;
  const m = Math.floor(seg / 60);
  return m < 60 ? `${m}m ${seg % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function textoProgramacion(r: Robot): string {
  if (!r.prog_hora) return 'Sin programar';
  const cuando = r.prog_cada_n_dias
    ? (r.prog_cada_n_dias === 1 ? 'Todos los días' : `Cada ${r.prog_cada_n_dias} días`)
    : (r.prog_dias ? r.prog_dias.split(',').join(' ') : 'Todos los días');
  return `${cuando} · ${r.prog_hora}`;
}

function EstadoTag({ estado, filas }: { estado: 'ok' | 'error' | null; filas?: number | null }) {
  if (estado === 'ok') return <span style={S.tagGreen}>OK{filas != null ? ` · ${filas}` : ''}</span>;
  if (estado === 'error') return <span style={S.tagRed}>ERROR</span>;
  return <span style={{ color: '#64748b', fontSize: '0.78rem' }}>sin datos aún</span>;
}

// ── Lanzar ahora (robot cuya última corrida falló) ──────────────────────────

function BotonLanzar({ script, runId, lanzable }: { script: string; runId: number | null; lanzable: boolean }) {
  const [, refrescar] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const h = () => refrescar(n => n + 1);
    window.addEventListener('robots:lanzado', h);
    return () => window.removeEventListener('robots:lanzado', h);
  }, []);

  if (!lanzable) return <div style={{ ...S.muted, marginTop: 4 }}>se lanza desde su pantalla</div>;
  const corriendo = estaCorriendo(script, runId);
  if (corriendo) {
    const hora = new Date(corriendo.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return <div style={{ color: '#fcd34d', fontSize: '0.72rem', marginTop: 4, whiteSpace: 'nowrap' }}>⏳ Corriendo… ({hora})</div>;
  }
  const lanzar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setEnviando(true);
    setError('');
    try { await lanzarRobot(script, runId); }
    catch (err: any) { setError(err?.message || 'No se pudo lanzar'); }
    finally { setEnviando(false); }
  };
  return (
    <div style={{ marginTop: 4 }}>
      <button style={{ ...S.btn, color: '#fca5a5', borderColor: '#ef4444', whiteSpace: 'nowrap' }} disabled={enviando} onClick={lanzar}>
        {enviando ? 'Lanzando…' : '▶ Lanzar ahora'}
      </button>
      {error && <div style={{ color: '#fde047', fontSize: '0.72rem' }}>⚠️ {error}</div>}
    </div>
  );
}

// ── Detalle por agente (script_run_items) ───────────────────────────────────

function Detalle({ runId, script, soloErroresInicial, conRobot }:
  { runId?: number; script?: string; soloErroresInicial?: boolean; conRobot?: boolean }) {
  const [filtro, setFiltro] = useState<'' | 'error' | 'aviso' | 'ok'>(soloErroresInicial ? 'error' : '');
  const [texto, setTexto] = useState('');
  const [datos, setDatos] = useState<Item[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams();
    if (runId) q.set('run_id', String(runId));
    if (script) q.set('script', script);
    if (filtro) q.set('estado', filtro);
    if (texto.trim()) q.set('q', texto.trim());
    if (!runId && !script && !filtro) q.set('estado', 'error');
    q.set('limit', '1000');
    setCargando(true);
    apiFetch<any>(`/script-runs/items?${q.toString()}`)
      .then(r => setDatos(r?.ok ? r.data || [] : []))
      .catch(() => setDatos([]))
      .finally(() => setCargando(false));
  }, [runId, script, filtro, texto]);

  const color = (e: Item['estado']) => e === 'error' ? '#fca5a5' : e === 'aviso' ? '#fcd34d' : '#86efac';
  const etiqueta = (f: string) => f === 'error' ? '❌ Errores' : f === 'aviso' ? '⚠️ Avisos' : f === 'ok' ? '✅ OK' : 'Todos';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        {(['error', 'aviso', 'ok', ''] as const).map(f => (
          <button key={f || 'todos'} style={{ ...S.btn, background: filtro === f ? '#1d4ed8' : S.btn.background }}
                  onClick={() => setFiltro(f)}>
            {etiqueta(f)}
          </button>
        ))}
        <input placeholder="Buscar DNI, nombre o motivo" style={{ ...S.input, minWidth: 220 }}
               value={texto} onChange={e => setTexto(e.target.value)} />
        <span style={S.muted}>{cargando ? 'Cargando…' : `${datos.length} fila(s)`}</span>
      </div>
      {datos.length === 0 && !cargando ? (
        <div style={S.muted}>{filtro === 'error' ? 'Sin errores de carga. 🎉' : 'Sin filas con ese filtro.'}</div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {conRobot && <th style={S.th}>Robot</th>}
                <th style={S.th}>Agente</th>
                <th style={S.th}>Novedad</th>
                <th style={S.th}>Desde</th>
                <th style={S.th}>Hasta</th>
                <th style={S.th}>Resultado</th>
                <th style={S.th}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {datos.map(it => (
                <tr key={it.id}>
                  {conRobot && <td style={{ ...S.td, ...S.muted }}>{it.descripcion || it.script}<div>{fmtFechaHora(it.creado_at)}</div></td>}
                  <td style={S.td}>
                    <div>{it.nombre || '—'}</div>
                    <div style={S.muted}>{it.dni || ''}</div>
                  </td>
                  <td style={{ ...S.td, fontSize: '0.78rem' }}>{it.novedad || '—'}</td>
                  <td style={{ ...S.td, ...S.muted, whiteSpace: 'nowrap' }}>{it.desde || ''}</td>
                  <td style={{ ...S.td, ...S.muted, whiteSpace: 'nowrap' }}>{it.hasta || ''}</td>
                  <td style={{ ...S.td, color: color(it.estado), fontWeight: 700, fontSize: '0.75rem' }}>{it.estado.toUpperCase()}</td>
                  <td style={{ ...S.td, fontSize: '0.78rem', color: it.estado === 'error' ? '#fca5a5' : '#cbd5e1' }}>{it.detalle || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Historial de un robot (o de todos) ──────────────────────────────────────

function Historial({ script, robots }: { script?: string; robots: Robot[] }) {
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [datos, setDatos] = useState<Corrida[]>([]);
  const [cargando, setCargando] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);

  const cargar = () => {
    const q = new URLSearchParams();
    if (script) q.set('script', script);
    if (estado) q.set('estado', estado);
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    q.set('limit', '200');
    setCargando(true);
    apiFetch<any>(`/script-runs/historial?${q.toString()}`)
      .then(r => setDatos(r?.ok ? r.data || [] : []))
      .catch(() => setDatos([]))
      .finally(() => setCargando(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargar, [script, estado, desde, hasta]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <select style={S.input} value={estado} onChange={e => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="ok">Solo OK</option>
          <option value="error">Solo errores</option>
        </select>
        <span style={S.muted}>Desde</span>
        <input type="date" style={S.input} value={desde} onChange={e => setDesde(e.target.value)} />
        <span style={S.muted}>Hasta</span>
        <input type="date" style={S.input} value={hasta} onChange={e => setHasta(e.target.value)} />
        <button style={S.btn} onClick={cargar}>↻ Actualizar</button>
        <span style={S.muted}>{cargando ? 'Cargando…' : `${datos.length} corrida(s)`}</span>
      </div>
      {datos.length === 0 && !cargando ? (
        <div style={S.muted}>No hay corridas registradas con ese filtro.</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Fecha</th>
              {!script && <th style={S.th}>Robot</th>}
              <th style={S.th}>Estado</th>
              <th style={S.th}>Duración</th>
              <th style={S.th}>Detalle</th>
              <th style={S.th}>Por agente</th>
              <th style={S.th}>Archivo / log</th>
            </tr>
          </thead>
          <tbody>
            {datos.map(c => (
              <React.Fragment key={c.id}>
              <tr>
                <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{fmtFechaHora(c.actualizado_at)}</td>
                {!script && <td style={S.td}>{c.descripcion || c.script}</td>}
                <td style={S.td}>
                  <EstadoTag estado={c.estado} filas={c.filas} />
                  {c.estado === 'error' && (() => {
                    // solo en la última corrida del robot: una falla vieja ya resuelta no se relanza
                    const rob = robots.find(x => x.script === c.script);
                    return rob && rob.run_id === c.id
                      ? <BotonLanzar script={c.script} runId={c.id} lanzable={!!rob.comando} />
                      : null;
                  })()}
                </td>
                <td style={{ ...S.td, ...S.muted }}>{fmtDuracion(c.duracion_seg)}</td>
                <td style={{ ...S.td, fontSize: '0.78rem', color: c.estado === 'error' ? '#fca5a5' : '#cbd5e1' }}>{c.motivo || '—'}</td>
                <td style={S.td}>
                  {c.items > 0 ? (
                    <button style={{ ...S.btn, color: c.items_error ? '#fca5a5' : undefined }}
                            onClick={() => setAbierta(a => a === c.id ? null : c.id)}>
                      {c.items_error ? `❌ ${c.items_error} error(es)` : '✅ sin errores'} · {c.items} fila(s)
                    </button>
                  ) : <span style={S.muted}>—</span>}
                </td>
                <td style={{ ...S.td, ...S.muted, wordBreak: 'break-all' }}>{c.archivo || '—'}</td>
              </tr>
              {abierta === c.id && (
                <tr>
                  <td colSpan={script ? 6 : 7} style={{ ...S.td, background: 'rgba(0,0,0,0.2)' }}>
                    <Detalle runId={c.id} soloErroresInicial={c.items_error > 0} />
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Configuración de un robot ───────────────────────────────────────────────

function Configuracion({ robot, onGuardado }: { robot: Robot; onGuardado: () => void }) {
  const [activa, setActiva] = useState(!!robot.prog_activa);
  const [modo, setModo] = useState<'dias' | 'cadaN'>(robot.prog_cada_n_dias ? 'cadaN' : 'dias');
  const [dias, setDias] = useState<string[]>(robot.prog_dias ? robot.prog_dias.split(',') : []);
  const [cadaN, setCadaN] = useState<string>(robot.prog_cada_n_dias ? String(robot.prog_cada_n_dias) : '1');
  const [hora, setHora] = useState(robot.prog_hora || '');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const toggleDia = (d: string) => setDias(prev => prev.includes(d) ? prev.filter(x => x !== d) : DIAS.filter(x => [...prev, d].includes(x)));

  const guardar = async () => {
    setGuardando(true);
    setMsg(null);
    try {
      const r = await apiFetch<any>(`/script-runs/config/${encodeURIComponent(robot.script)}`, {
        method: 'PUT',
        body: JSON.stringify({
          prog_activa: activa,
          prog_dias: modo === 'dias' ? dias.join(',') : '',
          prog_cada_n_dias: modo === 'cadaN' ? Number(cadaN) : null,
          prog_hora: hora || null,
        }),
      });
      if (!r?.ok) throw new Error(r?.error || 'Error');
      setMsg({ ok: true, texto: 'Programación guardada.' });
      onGuardado();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo guardar' });
    } finally {
      setGuardando(false);
    }
  };

  const ejecutar = async () => {
    if (!window.confirm(`¿Correr ahora "${robot.descripcion}"? Si hay otro robot del mismo recurso corriendo, espera su turno.`)) return;
    setMsg(null);
    try {
      const r = await apiFetch<any>(`/script-runs/ejecutar/${encodeURIComponent(robot.script)}`, { method: 'POST' });
      if (!r?.ok) throw new Error(r?.error || 'Error');
      setMsg({ ok: true, texto: 'Lanzado. El resultado aparece en el historial cuando termine.' });
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo lanzar' });
    }
  };

  const deshabilitarVieja = async () => {
    if (!window.confirm(`¿Deshabilitar la tarea de Windows "${robot.tarea_windows}"? Se puede volver a habilitar desde el Programador de tareas.`)) return;
    try {
      const r = await apiFetch<any>(`/script-runs/deshabilitar-vieja/${encodeURIComponent(robot.script)}`, { method: 'POST' });
      if (!r?.ok) throw new Error(r?.error || 'Error');
      setMsg({ ok: true, texto: `Tarea ${robot.tarea_windows} deshabilitada. Ya podés activar la programación propia.` });
      onGuardado();
    } catch (e: any) {
      setMsg({ ok: false, texto: e?.message || 'No se pudo deshabilitar' });
    }
  };

  const programable = !!robot.comando;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
      <div>
        <div style={S.titulo}>⏰ Programación</div>
        {!programable ? (
          <div style={S.muted}>Este robot no corre solo: lo lanza otra pantalla (por ejemplo, el comparador).</div>
        ) : (
          <>
            {robot.tarea_windows && robot.tarea_vieja?.existe && robot.tarea_vieja.estado !== 'Disabled' && (
              <div style={S.aviso}>
                Hoy lo corre la tarea de Windows vieja <b>{robot.tarea_windows}</b>
                {robot.tarea_vieja.proxima ? ` (próxima: ${fmtFechaHora(robot.tarea_vieja.proxima)})` : ''}.
                Para pasarlo a su tarea propia, primero deshabilitala así no corre dos veces.
                <div style={{ marginTop: 6 }}>
                  <button style={S.btn} onClick={deshabilitarVieja}>⏸ Deshabilitar {robot.tarea_windows}</button>
                </div>
              </div>
            )}
            <div style={{ ...S.muted, marginBottom: 10 }}>
              Tarea de Windows propia (<code>\Robots\{robot.script}</code>):{' '}
              {robot.tarea?.existe
                ? <>creada · {robot.tarea.estado}{robot.tarea.proxima ? ` · próxima ${fmtFechaHora(robot.tarea.proxima)}` : ''}</>
                : 'no existe (se crea al guardar con la programación activa)'}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: '0.82rem' }}>
              <input type="checkbox" checked={activa} onChange={e => setActiva(e.target.checked)} />
              Programación activa
            </label>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: '0.8rem' }}>
              <label><input type="radio" checked={modo === 'dias'} onChange={() => setModo('dias')} /> Días de la semana</label>
              <label><input type="radio" checked={modo === 'cadaN'} onChange={() => setModo('cadaN')} /> Cada N días</label>
            </div>
            {modo === 'dias' ? (
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {DIAS.map(d => (
                  <button key={d} type="button" onClick={() => toggleDia(d)}
                    style={{ ...S.btn, padding: '4px 8px', background: dias.includes(d) ? '#1d4ed8' : S.btn.background }}>
                    {d}
                  </button>
                ))}
                <span style={{ ...S.muted, alignSelf: 'center', marginLeft: 6 }}>{dias.length ? '' : '(ninguno = todos)'}</span>
              </div>
            ) : (
              <div style={{ marginBottom: 8, fontSize: '0.8rem' }}>
                Cada <input type="number" min={1} max={365} style={{ ...S.input, width: 60 }} value={cadaN} onChange={e => setCadaN(e.target.value)} /> día(s)
              </div>
            )}
            <div style={{ marginBottom: 10, fontSize: '0.8rem' }}>
              Hora <input type="time" style={S.input} value={hora} onChange={e => setHora(e.target.value)} />
            </div>
            <button style={S.btn} onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : '💾 Guardar programación'}</button>
            <button style={{ ...S.btn, marginLeft: 8 }} onClick={ejecutar} disabled={guardando}>▶ Ejecutar ahora</button>
            {msg && <span style={{ marginLeft: 10, fontSize: '0.78rem', color: msg.ok ? '#86efac' : '#fca5a5' }}>{msg.texto}</span>}
          </>
        )}
      </div>

      <div>
        <div style={S.titulo}>📁 Archivo que deja</div>
        {robot.destino_dir || robot.destino_nombre ? (
          <>
            <div style={{ fontSize: '0.8rem', marginBottom: 4 }}>
              <span style={S.muted}>Carpeta: </span><code>{robot.destino_dir || '—'}</code>
            </div>
            <div style={{ fontSize: '0.8rem', marginBottom: 8 }}>
              <span style={S.muted}>Nombre: </span><code>{robot.destino_nombre || '—'}</code>
            </div>
            {!robot.destino_editable && (
              <div style={S.muted}>🔒 Fijo por ahora: se habilita para cambiar después de probar los robots.</div>
            )}
            {robot.lo_leen && (
              <div style={{ ...S.aviso, marginTop: 8 }}>⚠️ Este archivo lo lee: {robot.lo_leen}. Cambiarle el nombre o la carpeta rompe esa lectura.</div>
            )}
          </>
        ) : (
          <div style={S.muted}>No descarga archivos.</div>
        )}
        {robot.notas && <div style={{ ...S.muted, marginTop: 8 }}>📝 {robot.notas}</div>}
        {robot.comando && <div style={{ ...S.muted, marginTop: 8 }}>Comando: <code>{robot.comando}</code></div>}
      </div>
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export function ScriptsSiapePage() {
  const [datos, setDatos] = useState<Robot[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [pestana, setPestana] = useState<'config' | 'historial'>('historial');
  const [verTodo, setVerTodo] = useState(false);
  const [verErrores, setVerErrores] = useState(false);

  const cargar = () => {
    apiFetch<any>('/script-runs/estado')
      .then(r => { if (r?.ok) setDatos(r.data || []); })
      .finally(() => setCargando(false));
  };
  useEffect(cargar, []);

  const grupos = useMemo(() => {
    const m = new Map<string, Robot[]>();
    for (const r of datos) m.set(r.grupo, [...(m.get(r.grupo) || []), r]);
    return [...m.entries()];
  }, [datos]);

  return (
    <Layout title="Herramientas">
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={S.titulo}>🤖 Robots — estado, historial y programación</div>
            <div style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: 16 }}>
              Hacé clic en un robot para ver todas sus corridas, cuándo corre y dónde deja el archivo.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn} onClick={() => setVerErrores(v => !v)}>{verErrores ? 'Ocultar errores' : '❌ Errores de carga'}</button>
            <button style={S.btn} onClick={() => setVerTodo(v => !v)}>{verTodo ? 'Ocultar' : '📜 Ver registro de todos'}</button>
          </div>
        </div>

        {verErrores && (
          <div style={{ ...S.card, background: 'rgba(0,0,0,0.15)' }}>
            <div style={S.titulo}>Errores de carga — todos los robots (más recientes primero)</div>
            <Detalle soloErroresInicial conRobot />
          </div>
        )}

        {verTodo && (
          <div style={{ ...S.card, background: 'rgba(0,0,0,0.15)' }}>
            <div style={S.titulo}>Registro de todos los robots</div>
            <Historial robots={datos} />
          </div>
        )}

        {cargando ? (
          <div style={{ color: '#64748b' }}>Cargando...</div>
        ) : (
          grupos.map(([grupo, robots]) => (
            <div key={grupo} style={{ marginBottom: 18 }}>
              <div style={{ ...S.titulo, color: '#cbd5e1', marginTop: 8 }}>{grupo}</div>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Robot</th>
                    <th style={S.th}>Última corrida</th>
                    <th style={S.th}>Estado</th>
                    <th style={S.th}>Programación</th>
                    <th style={S.th}>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {robots.map(r => (
                    <React.Fragment key={r.script}>
                      <tr style={{ cursor: 'pointer', background: abierto === r.script ? 'rgba(255,255,255,0.04)' : undefined }}
                          onClick={() => setAbierto(a => a === r.script ? null : r.script)}>
                        <td style={S.td}>
                          <div style={{ fontWeight: 600 }}>{abierto === r.script ? '▾' : '▸'} {r.descripcion}</div>
                          <div style={S.muted}>{r.script} · {r.corridas} corrida(s){r.errores ? ` · ${r.errores} con error` : ''}</div>
                        </td>
                        <td style={S.td}>
                          {fmtFechaHora(r.actualizado_at)}
                          {r.duracion_seg != null && <div style={S.muted}>{fmtDuracion(r.duracion_seg)}</div>}
                        </td>
                        <td style={S.td}>
                          <EstadoTag estado={r.estado} filas={r.filas} />
                          {r.estado === 'error' && <BotonLanzar script={r.script} runId={r.run_id} lanzable={!!r.comando} />}
                          {r.items_error > 0 && (
                            <div style={{ color: '#fca5a5', fontSize: '0.72rem', marginTop: 4 }}>❌ {r.items_error} error(es) de carga</div>
                          )}
                        </td>
                        <td style={S.td}>
                          {r.prog_activa
                            ? <span style={S.tagGreen}>{textoProgramacion(r)}</span>
                            : <span style={S.tagGris}>
                                {r.tarea_vieja?.existe && r.tarea_vieja.estado !== 'Disabled'
                                  ? `Tarea vieja: ${textoProgramacion(r)}`
                                  : textoProgramacion(r)}
                              </span>}
                          {(r.tarea?.proxima || (r.tarea_vieja?.estado !== 'Disabled' && r.tarea_vieja?.proxima)) && (
                            <div style={S.muted}>próxima: {fmtFechaHora((r.tarea?.proxima || r.tarea_vieja?.proxima) ?? null)}</div>
                          )}
                        </td>
                        <td style={{ ...S.td, color: r.estado === 'error' ? '#fca5a5' : '#64748b', fontSize: '0.78rem', maxWidth: 420 }}>
                          {r.motivo || '—'}
                        </td>
                      </tr>
                      {abierto === r.script && (
                        <tr>
                          <td colSpan={5} style={{ ...S.td, background: 'rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                              <button style={{ ...S.btn, background: pestana === 'historial' ? '#1d4ed8' : S.btn.background }}
                                      onClick={() => setPestana('historial')}>📜 Historial</button>
                              <button style={{ ...S.btn, background: pestana === 'config' ? '#1d4ed8' : S.btn.background }}
                                      onClick={() => setPestana('config')}>⚙️ Programación y archivo</button>
                            </div>
                            {pestana === 'historial'
                              ? <Historial script={r.script} robots={datos} />
                              : <Configuracion robot={r} onGuardado={cargar} />}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}

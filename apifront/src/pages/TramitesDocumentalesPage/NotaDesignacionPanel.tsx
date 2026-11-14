import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Nota de designación para GDEBA (IF) de los agentes de una tanda:
//  · Plantilla de la tanda: texto modelo con marcadores ({APELLIDO_NOMBRE}, {DNI}…).
//  · Texto por agente: se retoca una nota sola (queda "editada" y Generar la respeta).
//  · Generar: .docx en DOCU\<DNI>\Nota designacion GDEBA\ + texto para el robot.
//  · Estado: Generada → Enviada a firmar (robot o a mano) → Firmada (con número IF) / Error.
//  · Robot: carga en GDEBA y envía a firmar (🧪 prueba = 1 nota, frena antes de Aceptar).
// ─────────────────────────────────────────────────────────────────────────────

type Estado = 'GENERADA' | 'ENVIADA_FIRMA' | 'FIRMADA' | 'ERROR';
type Nota = {
  estado: Estado; archivo: string | null; texto: string; textoEditado: boolean;
  gdebaNumero: string | null; gdebaError: string | null;
  generadaAt: string | null; enviadaAt: string | null; firmadaAt: string | null; estadoAt: string | null;
};
type Fila = {
  dni: number; tratamiento: string; apellidoNombre: string; establecimiento: string;
  horas: string; cargo: string; agrupamiento: string; categoria: string; faltan: string[];
  textoPlantilla: string | null; nota: Nota | null;
};
type Plantilla = { plantilla: string; propia: boolean; modelo: string; marcadores: Array<{ clave: string; descripcion: string }> };

const BORDER = '1px solid rgba(255,255,255,0.1)';
const ESTADO: Record<Estado, { txt: string; color: string }> = {
  GENERADA: { txt: 'Generada', color: '#22c55e' },
  ENVIADA_FIRMA: { txt: 'Enviada a firmar', color: '#38bdf8' },
  FIRMADA: { txt: 'Firmada', color: '#a78bfa' },
  ERROR: { txt: 'Error', color: '#ef4444' },
};
const FILTROS = [['todas', 'Todas'], ['sin', 'Sin nota'], ['GENERADA', 'Generadas'], ['ENVIADA_FIRMA', 'Enviadas a firmar'],
  ['FIRMADA', 'Firmadas'], ['ERROR', 'Con error'], ['editadas', 'Editadas a mano']] as const;
type Filtro = typeof FILTROS[number][0];

const corto = (e: string) => e.replace('UNIDAD DE PRONTA ATENCIÓN ', 'UPA ').replace('HIGA SIMPLEMENTE EVITA', 'HIGA Evita');
const btn = (dis: boolean, bg = 'rgba(255,255,255,0.08)'): React.CSSProperties => ({
  padding: '5px 12px', fontSize: '0.78rem', borderRadius: 6, border: BORDER, color: '#e2e8f0',
  background: dis ? 'rgba(255,255,255,0.04)' : bg, cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.6 : 1,
});
const area: React.CSSProperties = {
  width: '100%', minHeight: 220, fontFamily: 'Consolas, monospace', fontSize: '0.78rem', lineHeight: 1.45,
  background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', border: BORDER, borderRadius: 6, padding: 8, boxSizing: 'border-box',
};
const NUM_RE = /^[A-Z]{2,5}-\d{4}-\d{5,10}-GDEBA-[A-Z0-9]+$/;

export function NotaDesignacionPanel({ tanda, onCerrar }: { tanda: string; onCerrar: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [lanzando, setLanzando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  // plantilla de la tanda
  const [plant, setPlant] = useState<Plantilla | null>(null);
  const [verPlant, setVerPlant] = useState(false);
  const [plantTxt, setPlantTxt] = useState('');
  const [guardandoPlant, setGuardandoPlant] = useState(false);
  // texto de un agente
  const [editDni, setEditDni] = useState<number | null>(null);
  const [editTxt, setEditTxt] = useState('');
  const [guardandoTxt, setGuardandoTxt] = useState(false);
  // número IF al marcar Firmada
  const [numDni, setNumDni] = useState<number | null>(null);
  const [numTxt, setNumTxt] = useState('');

  const cargar = useCallback(async (seleccionar = false) => {
    setCargando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: Fila[] }>(`/tramites-documentales/tandas/nota-designacion?tanda=${encodeURIComponent(tanda)}`);
      setRows(r.data);
      // por defecto: los completos que todavía no tienen nota
      if (seleccionar) setElegidos(new Set(r.data.filter((f) => !f.faltan.length && !f.nota).map((f) => f.dni)));
    } catch (e: any) {
      toast.error('No se pudieron armar las notas', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
  }, [tanda, toast]);

  const cargarPlantilla = useCallback(async () => {
    try {
      const r = await apiFetch<{ ok: boolean; data: Plantilla }>(`/tramites-documentales/tandas/nota-designacion/plantilla?tanda=${encodeURIComponent(tanda)}`);
      setPlant(r.data);
      setPlantTxt(r.data.plantilla);
    } catch (e: any) {
      toast.error('No se pudo leer la plantilla', e?.message || 'Error');
    }
  }, [tanda, toast]);

  useEffect(() => { void cargar(true); void cargarPlantilla(); }, [cargar, cargarPlantilla]);

  const conteo = useMemo(() => {
    const c: Record<string, number> = { sin: 0, GENERADA: 0, ENVIADA_FIRMA: 0, FIRMADA: 0, ERROR: 0, editadas: 0 };
    for (const f of rows) {
      if (!f.nota) c.sin += 1; else c[f.nota.estado] += 1;
      if (f.nota?.textoEditado) c.editadas += 1;
    }
    return c;
  }, [rows]);
  const visibles = rows.filter((f) => filtro === 'todas' ? true
    : filtro === 'sin' ? !f.nota
    : filtro === 'editadas' ? !!f.nota?.textoEditado
    : f.nota?.estado === filtro);

  const bloqueada = (f: Fila) => !!f.faltan.length || f.nota?.estado === 'ENVIADA_FIRMA' || f.nota?.estado === 'FIRMADA';
  const elegibles = visibles.filter((f) => !bloqueada(f));
  const toggle = (dni: number) => setElegidos((s) => { const n = new Set(s); if (n.has(dni)) n.delete(dni); else n.add(dni); return n; });
  const todos = elegibles.length > 0 && elegibles.every((f) => elegidos.has(f.dni));
  const paraGdeba = rows.filter((f) => f.nota && (f.nota.estado === 'GENERADA' || f.nota.estado === 'ERROR')).length;

  async function generar() {
    if (!elegidos.size) return;
    setGenerando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: { generadas: Array<{ editada: boolean }>; salteadas: Array<{ nombre: string; motivo: string }> } }>(
        '/tramites-documentales/tandas/nota-designacion',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tanda, dnis: [...elegidos] }) },
      );
      const { generadas, salteadas } = r.data;
      const ed = generadas.filter((g) => g.editada).length;
      toast.ok('Nota GDEBA', `${generadas.length} nota(s) generada(s)${ed ? ` (${ed} con texto editado, respetado)` : ''}${salteadas.length ? ` · ${salteadas.length} salteada(s)` : ''}`);
      if (salteadas.length) toast.error('Salteadas', salteadas.slice(0, 5).map((s) => `${s.nombre}: ${s.motivo}`).join(' · '));
      setElegidos(new Set());
      await cargar();
    } catch (e: any) {
      toast.error('No se pudieron generar las notas', e?.message || 'Error');
    } finally {
      setGenerando(false);
    }
  }

  async function guardarPlantilla(volverAlModelo = false) {
    setGuardandoPlant(true);
    try {
      await apiFetch('/tramites-documentales/tandas/nota-designacion/plantilla', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tanda, plantilla: volverAlModelo ? null : plantTxt }),
      });
      toast.ok('Plantilla', volverAlModelo ? 'Volvió al modelo original' : 'Guardada. Apretá "Generar" para rehacer las notas (las editadas a mano no se pisan).');
      await cargarPlantilla();
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo guardar la plantilla', e?.message || 'Error');
    } finally {
      setGuardandoPlant(false);
    }
  }

  function abrirEditor(f: Fila) {
    if (!f.nota) { toast.error('Sin nota', 'Primero generá la nota de este agente'); return; }
    setEditDni(f.dni);
    setEditTxt(f.nota.texto);
  }

  async function guardarTexto(volverAPlantilla = false) {
    if (editDni == null) return;
    setGuardandoTxt(true);
    try {
      await apiFetch('/tramites-documentales/tandas/nota-designacion/texto', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tanda, dni: editDni, texto: volverAPlantilla ? null : editTxt }),
      });
      toast.ok('Texto', volverAPlantilla ? 'Volvió al texto de la plantilla' : 'Guardado y .docx actualizado');
      setEditDni(null);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo guardar el texto', e?.message || 'Error');
    } finally {
      setGuardandoTxt(false);
    }
  }

  async function cambiarEstado(f: Fila, estado: Estado, gdebaNumero?: string) {
    if (estado === 'FIRMADA' && gdebaNumero === undefined) { setNumDni(f.dni); setNumTxt(f.nota?.gdebaNumero || ''); return; }
    try {
      await apiFetch('/tramites-documentales/tandas/nota-designacion/estado', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tanda, dni: f.dni, estado, gdebaNumero: gdebaNumero || null }),
      });
      setNumDni(null);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo cambiar el estado', e?.message || 'Error');
    }
  }

  async function lanzarGdeba(prueba: boolean) {
    if (!prueba && !window.confirm(
      `Se van a ENVIAR A FIRMAR en GDEBA ${paraGdeba} nota(s) de "${tanda}" (firmante: Valeria Silvina Fernandez Viña · VSFERNANDEZV).\n\n` +
      'No se puede deshacer. ¿Seguir?')) return;
    setLanzando(true);
    try {
      await apiFetch('/tramites-documentales/tandas/nota-designacion/gdeba', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tanda, prueba }),
      });
      toast.ok('Robot GDEBA lanzado', prueba
        ? 'Modo prueba en el servidor: carga 1 nota, elige el firmante y frena antes de Aceptar.'
        : 'Corre en el servidor: carga cada nota y la envía a firmar. Avance en la página Robots.');
    } catch (e: any) {
      toast.error('No se pudo lanzar el robot', e?.message || 'Error');
    } finally {
      setLanzando(false);
    }
  }

  async function bajar(f: Fila) {
    if (!f.nota?.archivo) return;
    try {
      const { blob } = await apiFetchBlobWithMeta(`/tramites-documentales/docu-file?dni=${f.dni}&path=${encodeURIComponent(f.nota.archivo)}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `NOTA DESIGNACION GDEBA_${f.dni}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) {
      toast.error('No se pudo bajar la nota', e?.message || 'Error');
    }
  }

  const filaEdit = editDni != null ? rows.find((f) => f.dni === editDni) : null;

  return (
    <div style={{ border: BORDER, borderRadius: 10, padding: 12, background: 'rgba(14,116,144,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0' }}>🏛️ Nota de designación GDEBA (IF) — "{tanda}"</b>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setVerPlant((v) => !v)} style={btn(false)}>
          📝 Plantilla de la tanda{plant?.propia ? ' (propia)' : ''}
        </button>
        <button type="button" onClick={() => void generar()} disabled={generando || !elegidos.size}
          style={btn(generando || !elegidos.size, '#0e7490')}>
          {generando ? 'Generando…' : `Generar ${elegidos.size || ''} nota(s)`}
        </button>
        <button type="button" onClick={onCerrar} disabled={generando} style={btn(generando)}>Cerrar</button>
      </div>

      {/* Contadores = filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.74rem' }}>
        {FILTROS.map(([k, label]) => {
          const n = k === 'todas' ? rows.length : conteo[k];
          const color = k in ESTADO ? ESTADO[k as Estado].color : '#cbd5e1';
          return (
            <button key={k} type="button" onClick={() => setFiltro(k)}
              style={{ ...btn(false), padding: '3px 10px', borderColor: filtro === k ? color : 'rgba(255,255,255,0.1)',
                background: filtro === k ? 'rgba(255,255,255,0.12)' : 'transparent' }}>
              <span style={{ color }}>{label}</span> <b>{n}</b>
            </button>
          );
        })}
      </div>

      {verPlant && plant ? (
        <div style={{ border: BORDER, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            Texto modelo de <b>{tanda}</b>. Los marcadores se reemplazan con los datos de cada agente.
            Al guardar, apretá <b>Generar</b> para rehacer las notas; las <b>editadas a mano</b> no se pisan.
          </div>
          <textarea value={plantTxt} onChange={(e) => setPlantTxt(e.target.value)} style={area} spellCheck={false} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.7rem', color: '#94a3b8' }}>
            {plant.marcadores.map((m) => (
              <button key={m.clave} type="button" title={m.descripcion}
                onClick={() => setPlantTxt((t) => `${t}${m.clave}`)}
                style={{ ...btn(false), padding: '1px 6px', fontSize: '0.7rem', fontFamily: 'Consolas, monospace' }}>{m.clave}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => void guardarPlantilla()} disabled={guardandoPlant || plantTxt === plant.plantilla}
              style={btn(guardandoPlant || plantTxt === plant.plantilla, '#0e7490')}>Guardar plantilla</button>
            <button type="button" onClick={() => void guardarPlantilla(true)} disabled={guardandoPlant || !plant.propia}
              title="Descarta la plantilla propia de la tanda y vuelve al texto de la nota original"
              style={btn(guardandoPlant || !plant.propia)}>Volver al modelo original</button>
            <button type="button" onClick={() => setPlantTxt(plant.plantilla)} disabled={plantTxt === plant.plantilla}
              style={btn(plantTxt === plant.plantilla)}>Deshacer cambios</button>
          </div>
        </div>
      ) : null}

      {filaEdit?.nota ? (
        <div style={{ border: '1px solid #0e7490', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: '#e2e8f0' }}>
            <b>✎ Texto de {filaEdit.apellidoNombre}</b>
            <span style={{ color: '#64748b' }}>· DNI {filaEdit.dni}</span>
            {filaEdit.nota.textoEditado ? <span style={{ color: '#f59e0b' }}>· editado a mano</span> : <span style={{ color: '#64748b' }}>· según la plantilla</span>}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setEditDni(null)} style={btn(false)}>Cerrar</button>
          </div>
          <textarea value={editTxt} onChange={(e) => setEditTxt(e.target.value)} style={area} spellCheck />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => void guardarTexto()} disabled={guardandoTxt || editTxt === filaEdit.nota.texto}
              style={btn(guardandoTxt || editTxt === filaEdit.nota.texto, '#0e7490')}>Guardar texto (rehace el .docx)</button>
            <button type="button" onClick={() => void guardarTexto(true)} disabled={guardandoTxt || !filaEdit.nota.textoEditado}
              title="Descarta el retoque y vuelve al texto que sale de la plantilla de la tanda"
              style={btn(guardandoTxt || !filaEdit.nota.textoEditado)}>Volver a la plantilla</button>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.75rem', color: '#94a3b8' }}>
        <b style={{ color: '#cbd5e1' }}>▶ Robot GDEBA</b>
        <span>{paraGdeba} para enviar · IF · DPTRH · firmante VSFERNANDEZV (Valeria Silvina Fernandez Viña) · corre en el servidor</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => void lanzarGdeba(true)} disabled={lanzando || !paraGdeba}
          title="Carga UNA nota, elige el firmante y frena antes de Aceptar. No envía nada."
          style={btn(lanzando || !paraGdeba, '#0e7490')}>🧪 Probar con 1</button>
        <button type="button" onClick={() => void lanzarGdeba(false)} disabled={lanzando || !paraGdeba}
          title="Carga y ENVÍA A FIRMAR las notas Generadas (o con error) de la tanda"
          style={btn(lanzando || !paraGdeba, '#b45309')}>🚀 Enviar a firmar</button>
        <button type="button" onClick={() => void cargar()} disabled={cargando} style={btn(cargando)} title="Actualizar">↻</button>
      </div>

      <div style={{ border: BORDER, borderRadius: 8, maxHeight: 460, overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: BORDER, fontSize: '0.72rem', color: '#64748b', position: 'sticky', top: 0, background: '#0f172a', zIndex: 1 }}>
          <input type="checkbox" checked={todos} disabled={generando || !elegibles.length} aria-label="Elegir todos"
            onChange={() => setElegidos(todos ? new Set() : new Set(elegibles.map((f) => f.dni)))} />
          <span style={{ flex: 2 }}>Agente</span>
          <span style={{ width: 80 }}>Destino</span>
          <span style={{ flex: 2 }}>Cargo</span>
          <span style={{ width: 110 }}>Agrup. / Cat.</span>
          <span style={{ width: 32 }}>Hs</span>
          <span style={{ width: 250 }}>Estado</span>
          <span style={{ width: 64 }} />
        </div>
        {cargando ? <div style={{ padding: 12, fontSize: '0.8rem', color: '#94a3b8' }}>Cargando…</div>
          : !visibles.length ? <div style={{ padding: 12, fontSize: '0.8rem', color: '#94a3b8' }}>Nada en este filtro.</div>
          : visibles.map((f) => {
          const n = f.nota;
          return (
            <div key={f.dni} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', borderBottom: BORDER, fontSize: '0.76rem', color: '#e2e8f0',
              background: editDni === f.dni ? 'rgba(14,116,144,0.18)' : 'transparent' }}>
              <input type="checkbox" checked={elegidos.has(f.dni)} disabled={generando || bloqueada(f)}
                onChange={() => toggle(f.dni)} aria-label={`Elegir ${f.apellidoNombre}`} />
              <span style={{ flex: 2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.tratamiento} {f.apellidoNombre} <span style={{ color: '#64748b' }}>· {f.dni}</span>
                {n?.textoEditado ? <span style={{ color: '#f59e0b' }} title="Texto retocado a mano"> ✎</span> : null}
                {f.faltan.length ? <span style={{ color: '#f59e0b' }}> · falta {f.faltan.join(', ')}</span> : null}
              </span>
              <span style={{ width: 80, color: '#94a3b8' }} title={f.establecimiento}>{corto(f.establecimiento)}</span>
              <span style={{ flex: 2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.cargo}>{f.cargo}</span>
              <span style={{ width: 110, color: '#94a3b8' }}>{f.agrupamiento} / {f.categoria}</span>
              <span style={{ width: 32, color: '#94a3b8' }}>{f.horas}</span>
              <span style={{ width: 250, display: 'flex', gap: 4, alignItems: 'center' }}>
                {!n ? <span style={{ color: '#64748b' }}>Sin nota</span>
                  : numDni === f.dni ? (
                    <>
                      <input value={numTxt} onChange={(e) => setNumTxt(e.target.value.toUpperCase())} placeholder="IF-2026-…-GDEBA-HPDIGAMSALGP"
                        style={{ width: 170, fontSize: '0.7rem', background: 'rgba(0,0,0,0.3)', color: '#e2e8f0', border: BORDER, borderRadius: 4, padding: '2px 4px' }} />
                      <button type="button" disabled={!!numTxt && !NUM_RE.test(numTxt)} onClick={() => void cambiarEstado(f, 'FIRMADA', numTxt)}
                        title={numTxt && !NUM_RE.test(numTxt) ? 'Formato: IF-2026-40518978-GDEBA-HPDIGAMSALGP' : 'Marcar firmada'}
                        style={{ ...btn(!!numTxt && !NUM_RE.test(numTxt), '#6d28d9'), padding: '1px 6px' }}>✓</button>
                      <button type="button" onClick={() => setNumDni(null)} style={{ ...btn(false), padding: '1px 6px' }}>✕</button>
                    </>
                  ) : (
                    <>
                      <select value={n.estado} onChange={(e) => void cambiarEstado(f, e.target.value as Estado)}
                        title={[n.gdebaError, n.enviadaAt && `Enviada ${n.enviadaAt}`, n.firmadaAt && `Firmada ${n.firmadaAt}`, n.generadaAt && `Generada ${n.generadaAt}`].filter(Boolean).join(' · ')}
                        style={{ fontSize: '0.72rem', background: '#0f172a', color: ESTADO[n.estado].color, border: BORDER, borderRadius: 4, padding: '1px 2px' }}>
                        {(Object.keys(ESTADO) as Estado[]).map((k) => <option key={k} value={k} style={{ color: ESTADO[k].color }}>{ESTADO[k].txt}</option>)}
                      </select>
                      {n.estado === 'FIRMADA' && n.gdebaNumero
                        ? <span style={{ color: '#a78bfa', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.gdebaNumero}>{n.gdebaNumero}</span>
                        : n.estado === 'ERROR' && n.gdebaError
                          ? <span style={{ color: '#fca5a5', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.gdebaError}>{n.gdebaError}</span>
                          : n.enviadaAt ? <span style={{ color: '#64748b', fontSize: '0.68rem' }}>{n.enviadaAt.slice(5)}</span> : null}
                    </>
                  )}
              </span>
              <span style={{ width: 64, display: 'flex', gap: 4 }}>
                {n ? <button type="button" onClick={() => abrirEditor(f)} title="Ver / editar el texto de la nota"
                  style={{ ...btn(false), padding: '1px 6px' }}>✎</button> : null}
                {n?.archivo ? <button type="button" onClick={() => void bajar(f)} title="Bajar el .docx" style={{ ...btn(false), padding: '1px 6px' }}>⬇</button> : null}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
        .docx en <code>DOCU\&lt;DNI&gt;\Nota designacion GDEBA\</code>. Las notas Enviadas a firmar / Firmadas no se regeneran ni se editan
        (para corregir una, pasala a Generada).
      </div>
    </div>
  );
}

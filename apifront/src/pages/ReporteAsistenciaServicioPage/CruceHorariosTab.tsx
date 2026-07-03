// src/pages/ReporteAsistenciaServicioPage/CruceHorariosTab.tsx
// Cruce horarios × servicios × agentes a partir del archivo de horarios del
// Ministerio. Clasifica turnos (mañana/tarde/noche/24hs, nocturno = salida <
// entrada) y marca franqueros (solo sábado/domingo) y la ley de revista.
import React, { useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import XLSXStyle from 'xlsx-js-style';
import { saveAs } from 'file-saver';

interface Servicio { id: number; nombre: string; }

interface DiaCruce { entrada: string | null; salida: string | null; turno: string | null; horas: number; }

interface AgenteCruce {
  dni: string;
  nombre_xlsx: string;
  regimen: string;
  planta_xlsx: string;
  revista: string;
  agrupamiento: string;
  estructura: string;
  dias: Record<string, DiaCruce>;
  turnos: string[];
  esFranquero: boolean;
  hsSemanales: number;
  diasTrabajados: number;
  en_sistema: boolean;
  apellido: string | null;
  nombre: string | null;
  estado_empleo: string | null;
  ley_nombre: string | null;
  planta_nombre: string | null;
  ocupacion_id: number | null;
  ocupacion_nombre: string | null;
  servicio_id: number | null;
  servicio_nombre: string | null;
  dependencia_id: number | null;
  dependencia_nombre: string | null;
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const;
const DIAS_LBL: Record<string, string> = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb', domingo: 'Dom' };

const TURNO_LBL: Record<string, string> = { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche', '24hs': '24hs' };
const TURNO_COLOR: Record<string, { bg: string; fg: string }> = {
  manana: { bg: 'rgba(56,189,248,0.16)', fg: '#7dd3fc' },
  tarde:  { bg: 'rgba(245,158,11,0.16)', fg: '#fbbf24' },
  noche:  { bg: 'rgba(129,140,248,0.18)', fg: '#a5b4fc' },
  '24hs': { bg: 'rgba(244,114,182,0.18)', fg: '#f9a8d4' },
};

// Titular (trámites SIAPE): por BD ley 10430 o 10471 con planta PERMANENTE;
// si no está en la BD, por el xlsx (PLANTA=PERMANENTE y revista de planta).
function esTitular(a: AgenteCruce): boolean {
  const ley = String(a.ley_nombre || '').toLowerCase();
  if (ley.includes('10430')) return true;
  if (ley.includes('10471')) return String(a.planta_nombre || '').toUpperCase() === 'PERMANENTE';
  if (!a.en_sistema || !a.ley_nombre) {
    return a.planta_xlsx === 'PERMANENTE' && ['PLANTA', 'CON ESTABILIDAD', 'GUARDIA'].includes(a.revista);
  }
  return false;
}

function revistaLabel(a: AgenteCruce): string {
  if (esTitular(a)) return 'TITULAR';
  if (a.revista) return a.revista;            // INTERINO / TRANSITORIA / BECAS...
  const ley = String(a.ley_nombre || '').toLowerCase();
  if (ley.includes('10471')) return 'INTERINO';
  if (ley.includes('beca') || ley.includes('programa')) return 'BECA';
  if (ley.includes('residente')) return 'RESIDENTE';
  return 'SIN DATO';
}

function grupoLey(a: AgenteCruce): 'carrera' | '10430' | 'beca' | 'otro' {
  const t = `${a.ley_nombre || ''} ${a.regimen || ''}`.toLowerCase();
  if (t.includes('10471') || t.includes('carrera hospitalaria')) return 'carrera';
  if (t.includes('10430') || t.includes('10.430')) return '10430';
  if (t.includes('beca') || t.includes('programa') || t.includes('residente')) return 'beca';
  return 'otro';
}

// Nombre de ley exacto del agente (BD primero, sino régimen del xlsx)
const leyExacta = (a: AgenteCruce): string => a.ley_nombre || a.regimen || 'Sin ley';

// Agrupa los días con el mismo horario: "Lun·Mié·Vie 08:00-14:00"
function horariosAgrupados(a: AgenteCruce) {
  const groups: { key: string; ent: string; sal: string; turno: string; dias: string[] }[] = [];
  for (const d of DIAS) {
    const dia = a.dias[d];
    if (!dia?.entrada || !dia?.salida) continue;
    const key = `${dia.entrada}-${dia.salida}`;
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, ent: dia.entrada, sal: dia.salida, turno: dia.turno || '', dias: [] }; groups.push(g); }
    g.dias.push(DIAS_LBL[d]);
  }
  return groups;
}

export function CruceHorariosTab({ servicios, horariosFile }: { servicios: Servicio[]; horariosFile: string }) {
  const toast = useToast();
  const [agentes, setAgentes] = useState<AgenteCruce[] | null>(null);
  const [archivo, setArchivo] = useState('');
  const [loading, setLoading] = useState(false);

  // Filtros — fLey: 'todos' | 'g:<grupo>' | 'l:<nombre exacto de ley/programa>'
  const [fServicio, setFServicio]       = useState('');
  const [fDependencia, setFDependencia] = useState('');
  const [fOcupacion, setFOcupacion]     = useState('');
  const [fTurno, setFTurno]             = useState<'todos' | 'manana' | 'tarde' | 'noche' | '24hs' | 'rotativo'>('todos');
  const [fModalidad, setFModalidad]     = useState<'todos' | 'franqueros' | 'semana'>('todos');
  const [fLey, setFLey]                 = useState('todos');
  const [fRevista, setFRevista]         = useState<'todos' | 'titulares' | 'no_titulares'>('todos');
  const [fTexto, setFTexto]             = useState('');
  const [pagina, setPagina]             = useState(1);
  const PAGE = 50;

  const cargar = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (horariosFile) params.set('horariosFile', horariosFile);
      const r = await apiFetch<any>(`/asistencia/cruce-horarios?${params}`);
      if (!r?.ok) throw new Error(r?.error || 'Error del servidor');
      setAgentes(r.agentes);
      setArchivo(r.archivo);
      setPagina(1);
      toast.ok('Cruce generado', `${r.total} agentes en ${r.archivo}`);
    } catch (e: any) { toast.error('Error generando cruce', e?.message); }
    finally { setLoading(false); }
  };

  const filtrados = useMemo(() => {
    if (!agentes) return [];
    const txt = fTexto.trim().toLowerCase();
    return agentes.filter(a => {
      if (fServicio && String(a.servicio_id ?? '') !== fServicio) return false;
      if (fDependencia && String(a.dependencia_id ?? '') !== fDependencia) return false;
      if (fOcupacion && (a.ocupacion_nombre || 'Sin ocupación') !== fOcupacion) return false;
      if (fTurno === 'rotativo') { if (a.turnos.length < 2) return false; }
      else if (fTurno !== 'todos' && !a.turnos.includes(fTurno)) return false;
      if (fModalidad === 'franqueros' && !a.esFranquero) return false;
      if (fModalidad === 'semana' && a.esFranquero) return false;
      if (fLey.startsWith('g:') && grupoLey(a) !== fLey.slice(2)) return false;
      if (fLey.startsWith('l:') && leyExacta(a) !== fLey.slice(2)) return false;
      if (fRevista === 'titulares' && !esTitular(a)) return false;
      if (fRevista === 'no_titulares' && esTitular(a)) return false;
      if (txt) {
        const nom = `${a.apellido || ''} ${a.nombre || ''} ${a.nombre_xlsx || ''} ${a.dni}`.toLowerCase();
        if (!nom.includes(txt)) return false;
      }
      return true;
    });
  }, [agentes, fServicio, fDependencia, fOcupacion, fTurno, fModalidad, fLey, fRevista, fTexto]);

  const ocupacionesOpts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agentes ?? []) {
      const k = a.ocupacion_nombre || 'Sin ocupación';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [agentes]);

  // Opciones dinámicas: leyes/programas y dependencias presentes en los datos
  const leyesDetalle = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agentes ?? []) m.set(leyExacta(a), (m.get(leyExacta(a)) || 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [agentes]);

  const dependenciasOpts = useMemo(() => {
    const m = new Map<string, { id: number; nombre: string; cant: number }>();
    for (const a of agentes ?? []) {
      if (a.dependencia_id == null) continue;
      const k = String(a.dependencia_id);
      const cur = m.get(k) || { id: a.dependencia_id, nombre: a.dependencia_nombre || `Dep #${k}`, cant: 0 };
      cur.cant++;
      m.set(k, cur);
    }
    return [...m.values()].sort((x, y) => y.cant - x.cant);
  }, [agentes]);

  const stats = useMemo(() => {
    const s = { manana: 0, tarde: 0, noche: 0, h24: 0, rotativos: 0, franqueros: 0 };
    for (const a of filtrados) {
      if (a.turnos.includes('manana')) s.manana++;
      if (a.turnos.includes('tarde')) s.tarde++;
      if (a.turnos.includes('noche')) s.noche++;
      if (a.turnos.includes('24hs')) s.h24++;
      if (a.turnos.length > 1) s.rotativos++;
      if (a.esFranquero) s.franqueros++;
    }
    return s;
  }, [filtrados]);

  const totalPags = Math.max(1, Math.ceil(filtrados.length / PAGE));
  const pagActual = Math.min(pagina, totalPags);
  const visibles = filtrados.slice((pagActual - 1) * PAGE, pagActual * PAGE);

  const exportar = () => {
    if (!filtrados.length) return toast.error('Sin datos para exportar');
    const FILL_HEADER = { patternType: 'solid', fgColor: { rgb: '2C3E50' } };
    const FONT_HEADER = { bold: true, color: { rgb: 'FFFFFF' } };
    const hdr = ['Agente', 'DNI', 'Ley', 'Situación', 'Ocupación', 'Servicio', 'Dependencia', 'Turnos', 'Franquero',
      ...DIAS.map(d => DIAS_LBL[d]), 'Régimen (xlsx)', 'Agrupamiento', 'Estructura (xlsx)'];
    const aoa: any[][] = [hdr.map(h => ({ v: h, s: { fill: FILL_HEADER, font: FONT_HEADER } }))];
    for (const a of filtrados) {
      aoa.push([
        a.apellido ? `${a.apellido}, ${a.nombre}` : a.nombre_xlsx,
        a.dni,
        a.ley_nombre || a.regimen || '',
        revistaLabel(a),
        a.ocupacion_nombre || '',
        a.servicio_nombre || '',
        a.dependencia_nombre || '',
        a.turnos.map(t => TURNO_LBL[t]).join(' + '),
        a.esFranquero ? 'SÍ' : '',
        ...DIAS.map(d => a.dias[d]?.entrada ? `${a.dias[d].entrada}-${a.dias[d].salida}` : ''),
        a.regimen, a.agrupamiento, a.estructura,
      ]);
    }
    const wb = XLSXStyle.utils.book_new();
    XLSXStyle.utils.book_append_sheet(wb, XLSXStyle.utils.aoa_to_sheet(aoa), 'Cruce horarios');
    const out = XLSXStyle.write(wb, { type: 'array', bookType: 'xlsx' });
    saveAs(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `cruce-horarios-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const chip = (label: string, color: { bg: string; fg: string }, title?: string) => (
    <span title={title} style={{ background: color.bg, color: color.fg, borderRadius: 5, padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
  );

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="h2" style={{ marginBottom: 4 }}>Cruce de horarios</div>
        <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 12 }}>
          Horarios del archivo del Ministerio cruzados con servicio y ley de revista del sistema.
          Turnos: Mañana (entrada 05–12) · Tarde (12–18) · Noche (desde 18 o salida &lt; entrada) · 24hs (salida = entrada). Franquero: solo sábado/domingo.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={cargar} disabled={loading}>
            {loading ? 'Generando...' : agentes ? '↻ Regenerar cruce' : '▶ Generar cruce'}
          </button>
          {agentes && (
            <>
              <button className="btn" type="button" onClick={exportar} style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
                ⬇ Exportar Excel ({filtrados.length})
              </button>
              <span className="muted" style={{ fontSize: '0.78rem' }}>Archivo: {archivo} · {agentes.length} agentes</span>
            </>
          )}
        </div>
      </div>

      {agentes && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <div>
                <label htmlFor="ch-dependencia" style={lbl}>Dependencia</label>
                <select id="ch-dependencia" className="input" value={fDependencia} onChange={e => { setFDependencia(e.target.value); setPagina(1); }}>
                  <option value="">Todas</option>
                  {dependenciasOpts.map(d => <option key={d.id} value={d.id}>{d.nombre} ({d.cant})</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ch-servicio" style={lbl}>Servicio</label>
                <select id="ch-servicio" className="input" value={fServicio} onChange={e => { setFServicio(e.target.value); setPagina(1); }}>
                  <option value="">Todos</option>
                  {servicios.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ch-ocupacion" style={lbl}>Ocupación</label>
                <select id="ch-ocupacion" className="input" value={fOcupacion} onChange={e => { setFOcupacion(e.target.value); setPagina(1); }}>
                  <option value="">Todas</option>
                  {ocupacionesOpts.map(([nombre, cant]) => <option key={nombre} value={nombre}>{nombre} ({cant})</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ch-turno" style={lbl}>Turno</label>
                <select id="ch-turno" className="input" value={fTurno} onChange={e => { setFTurno(e.target.value as any); setPagina(1); }}>
                  <option value="todos">Todos</option>
                  <option value="manana">Mañana (05–12)</option>
                  <option value="tarde">Tarde (12–18)</option>
                  <option value="noche">Noche</option>
                  <option value="24hs">Guardia 24hs</option>
                  <option value="rotativo">Rotativo (turnos mixtos)</option>
                </select>
              </div>
              <div>
                <label htmlFor="ch-modalidad" style={lbl}>Modalidad</label>
                <select id="ch-modalidad" className="input" value={fModalidad} onChange={e => { setFModalidad(e.target.value as any); setPagina(1); }}>
                  <option value="todos">Todos</option>
                  <option value="franqueros">Solo franqueros (sáb/dom)</option>
                  <option value="semana">Sin franqueros</option>
                </select>
              </div>
              <div>
                <label htmlFor="ch-ley" style={lbl}>Ley / Régimen</label>
                <select id="ch-ley" className="input" value={fLey} onChange={e => { setFLey(e.target.value); setPagina(1); }}>
                  <option value="todos">Todas</option>
                  <optgroup label="Grupos">
                    <option value="g:carrera">Carrera Hospitalaria (10471)</option>
                    <option value="g:10430">Ley 10430</option>
                    <option value="g:beca">Becas / Programas / Residentes (todas)</option>
                    <option value="g:otro">Otras</option>
                  </optgroup>
                  <optgroup label="Ley / programa puntual">
                    {leyesDetalle.map(([nombre, cant]) => (
                      <option key={nombre} value={`l:${nombre}`}>{nombre} ({cant})</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div>
                <label htmlFor="ch-revista" style={lbl}>Situación de revista</label>
                <select id="ch-revista" className="input" value={fRevista} onChange={e => { setFRevista(e.target.value as any); setPagina(1); }}>
                  <option value="todos">Todas</option>
                  <option value="titulares">Titulares</option>
                  <option value="no_titulares">Interinos / becas / etc.</option>
                </select>
              </div>
              <div>
                <label htmlFor="ch-texto" style={lbl}>Buscar</label>
                <input id="ch-texto" className="input" placeholder="DNI o apellido" value={fTexto} onChange={e => { setFTexto(e.target.value); setPagina(1); }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.84rem' }}>{filtrados.length} agentes</strong>
              {chip(`Mañana ${stats.manana}`, TURNO_COLOR.manana)}
              {chip(`Tarde ${stats.tarde}`, TURNO_COLOR.tarde)}
              {chip(`Noche ${stats.noche}`, TURNO_COLOR.noche)}
              {chip(`24hs ${stats.h24}`, TURNO_COLOR['24hs'])}
              {chip(`Rotativos ${stats.rotativos}`, { bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' })}
              {chip(`Franqueros ${stats.franqueros}`, { bg: 'rgba(251,191,36,0.16)', fg: '#fbbf24' })}
            </div>
          </div>

          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.76rem' }}>
                <thead>
                  <tr>
                    <th>Agente</th>
                    <th>DNI</th>
                    <th>Ley / Revista</th>
                    <th>Servicio · Dependencia</th>
                    <th>Turnos</th>
                    <th>Horarios</th>
                    <th>Ocupación</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(a => {
                    const titular = esTitular(a);
                    const grupos = horariosAgrupados(a);
                    return (
                      <tr key={a.dni}>
                        <td style={{ fontWeight: 600, padding: '5px 8px' }}>
                          {a.apellido ? `${a.apellido}, ${a.nombre}` : a.nombre_xlsx}
                          {!a.en_sistema && (
                            <span title="No figura en el sistema (solo en el xlsx)" style={{ fontSize: '0.62rem', color: '#94a3b8', marginLeft: 5 }}>(no en sistema)</span>
                          )}
                        </td>
                        <td style={{ padding: '5px 8px' }}>{a.dni}</td>
                        <td style={{ padding: '5px 8px', maxWidth: 160 }}>
                          <span title={a.ley_nombre || a.regimen || undefined} style={{ fontSize: '0.7rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {a.ley_nombre || a.regimen || '—'}
                          </span>
                          <span style={titular
                            ? { fontSize: '0.62rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(129,140,248,0.16)', color: '#a5b4fc' }
                            : { fontSize: '0.62rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(251,191,36,0.16)', color: '#fbbf24' }}>
                            {revistaLabel(a)}
                          </span>
                        </td>
                        <td style={{ padding: '5px 8px', maxWidth: 180 }} title={a.estructura || undefined}>
                          <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.servicio_nombre || '—'}</span>
                          {a.dependencia_nombre && (
                            <span className="muted" style={{ fontSize: '0.64rem' }}>{a.dependencia_nombre}</span>
                          )}
                        </td>
                        <td style={{ padding: '5px 8px' }}>
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {a.turnos.map(t => chip(TURNO_LBL[t], TURNO_COLOR[t]))}
                            {a.esFranquero && chip('FRANQ', { bg: 'rgba(251,191,36,0.16)', fg: '#fbbf24' }, 'Franquero: trabaja solo sábado y domingo')}
                            {!a.turnos.length && <span className="muted">—</span>}
                          </div>
                        </td>
                        <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                          {grupos.length ? grupos.map(g => {
                            const col = TURNO_COLOR[g.turno];
                            return (
                              <div key={g.key} style={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                                <span style={{ color: col?.fg, fontWeight: 700 }}>{g.dias.join('·')}</span>
                                <span style={{ marginLeft: 5 }}>{g.ent}–{g.sal}</span>
                              </div>
                            );
                          }) : <span className="muted">—</span>}
                        </td>
                        <td style={{ padding: '5px 8px', maxWidth: 150 }} title={`${a.hsSemanales || 0} hs semanales`}>
                          <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.72rem' }}>
                            {a.ocupacion_nombre || '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!visibles.length && (
                    <tr><td colSpan={7} className="muted" style={{ padding: 14, textAlign: 'center' }}>Sin agentes para los filtros seleccionados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {totalPags > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 10px' }} disabled={pagActual === 1} onClick={() => setPagina(p => Math.max(1, p - 1))}>← Ant</button>
                <span className="muted" style={{ fontSize: '0.78rem' }}>Página {pagActual} de {totalPags}</span>
                <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 10px' }} disabled={pagActual === totalPags} onClick={() => setPagina(p => Math.min(totalPags, p + 1))}>Sig →</button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

const lbl: React.CSSProperties = { fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: 4 };

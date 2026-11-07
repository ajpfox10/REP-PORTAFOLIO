// src/pages/AsistenciaPage/AusentesMesSection.tsx
// Pestaña "Ausentes del mes": los AUSENTE SIN AVISO del mes sacados de los ARCHIVOS QUE BAJAN LOS ROBOTS
// (SIAPE.XLS + MINISTERIO/UPA4/UPA18.xls, última corrida del comparador 2.0), cruzados por día con las fichadas
// del reloj, Salud Laboral (reconocimientos + turnos), ART y lo cargado por el jefe.
// Doble clic en la celda "Fichó" → horarios cargados del agente.
// Backend: GET /fichajes-agentes/ausentes, GET /fichajes-agentes/horarios

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

interface DiaAus {
  fecha: string; dow: number; siape: boolean; ministerio: boolean; estado: string; motivo: string;
  horario: string | null; aprox: boolean; marcas: { h: string; t: 'E' | 'S' | null }[];
  turno: 'DIA' | 'NOCHE' | 'GUARDIA' | null; fichaje: Fichaje; entrada: string | null; salida: string | null; motivosFichaje: string[];
  reconocido: string[]; saludLaboral: string[]; jefe: string[]; art: string[]; otras: string[];
}
interface AgenteAus {
  dni: string; nombre: string; dependencia: string; ley: string | null; servicio: string | null; ocupacion: string | null;
  estadoEmpleo: string | null; residente: boolean; enReloj: boolean; enPadronArt: boolean;
  ausentes: number; enSiape: number; enMinisterio: number; fichoDias: number; reconocidoDias: number;
  saludLaboralDias: number; artDias: number; jefeDias: number; otrasDias: number; dias: DiaAus[];
  fichoCompletoDias: number; turnos: string[]; planta: string | null; becado: boolean;
}
type Fichaje = 'COMPLETO' | 'SOLO_ENTRADA' | 'SOLO_SALIDA' | 'NO' | 'NO_LE_TOCA' | 'SIN_TURNO' | 'FICHO_SIN_TURNO';
const FICHAJE: Record<Fichaje, { label: string; color: string }> = {
  COMPLETO: { label: 'Fichó entrada y salida', color: '#ef4444' },
  SOLO_ENTRADA: { label: 'Solo entrada', color: '#ef4444' },
  SOLO_SALIDA: { label: 'Solo salida', color: '#ef4444' },
  FICHO_SIN_TURNO: { label: 'Fichó (sin turno ese día)', color: '#ef4444' },
  NO: { label: 'No fichó', color: '#475569' },
  NO_LE_TOCA: { label: 'Semana que no le toca', color: '#94a3b8' },
  SIN_TURNO: { label: 'Sin turno ese día', color: '#94a3b8' },
};
const TURNO: Record<string, string> = { DIA: 'Día', NOCHE: 'Noche', GUARDIA: 'Guardia' };
const revistaDe = (a: { residente: boolean; becado: boolean; planta: string | null }) =>
  a.residente ? 'RESIDENTE' : a.becado ? 'BECADO' : (a.planta || 'SIN DATO').toUpperCase();
interface Resp {
  ok: boolean; error?: string; desde: string; hasta: string; avisos?: string[];
  corrida: { id: number; creado_en: string; archivo_siape: string; siape_modificado: string; archivo_ministerio: string; ministerio_modificado: string } | null;
  agentes: AgenteAus[];
}
interface Tramo { desde: string; hasta: string; fotos: number; regimen: string | null; estructura: string | null; semana: { dia: string; entrada: string | null; salida: string | null }[] }

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIA_CORTO: Record<string, string> = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb', domingo: 'Dom' };
const fmtFecha = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const th: React.CSSProperties = {
  textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,.08)', fontWeight: 700,
  fontSize: '0.72rem', color: '#94a3b8', cursor: 'pointer', whiteSpace: 'nowrap', position: 'sticky', top: 0,
  background: 'var(--bg, #0f172a)',
};
const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '0.78rem', verticalAlign: 'top' };

// número de días con algo; rojo cuando contradice el ausente
const Cant = ({ v, de, alerta }: { v: number; de: number; alerta?: boolean }) =>
  v ? <b style={{ color: alerta ? '#ef4444' : '#60a5fa' }}>{v === de ? `Sí (${v})` : `${v} de ${de}`}</b> : <span style={{ color: '#475569' }}>No</span>;

const Tag = ({ txt, color }: { txt: string; color: string }) => (
  <span style={{ background: `${color}22`, border: `1px solid ${color}66`, color, borderRadius: 8, padding: '0 6px', fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{txt}</span>
);

// ── horarios cargados (doble clic en Fichó) ──────────────────────────────────
function HorariosModal({ agente, onClose }: { agente: AgenteAus; onClose: () => void }) {
  const toast = useToast();
  const [tramos, setTramos] = useState<Tramo[] | null>(null);
  useEffect(() => {
    apiFetch<any>(`/fichajes-agentes/horarios?dni=${agente.dni}`)
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Error'); setTramos(r.tramos); })
      .catch(e => { toast.error('Error al traer los horarios', e?.message); setTramos([]); });
  }, [agente.dni]);
  const conMarca = agente.dias.filter(d => d.marcas.length);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 12px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} className="card gp-card-14" style={{ width: 'min(1000px, 100%)', padding: 18 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Horarios cargados · {agente.nombre}</div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>DNI {agente.dni} · fotos de SIAPE (Horario Administrativo), agrupadas cuando el horario no cambia</div>
          </div>
          <button className="btn" onClick={onClose}>✕</button>
        </div>

        {conMarca.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 4 }}>Fichadas en días de ausente</div>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{['Fecha', 'Día', 'Horario ese día', 'Marcas del reloj'].map(h => <th key={h} style={{ ...th, position: 'static', cursor: 'default' }}>{h}</th>)}</tr></thead>
              <tbody>
                {conMarca.map(d => (
                  <tr key={d.fecha}>
                    <td style={td}>{fmtFecha(d.fecha)}</td>
                    <td style={td}>{DOW[d.dow]}</td>
                    <td style={td}>{d.horario || <span style={{ color: '#475569' }}>no trabaja</span>}{d.aprox ? ' ≈' : ''}</td>
                    <td style={{ ...td, color: '#ef4444', fontWeight: 600 }}>{d.marcas.map(m => `${m.h}${m.t ? ` ${m.t}` : ''}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          {!tramos ? <div style={{ color: '#94a3b8' }}>Cargando…</div> : !tramos.length ? <div style={{ color: '#94a3b8' }}>Sin horarios cargados para este agente.</div> : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>{['Vigente', ...tramos[0].semana.map(s => DIA_CORTO[s.dia]), 'Régimen'].map(h => <th key={h} style={{ ...th, position: 'static', cursor: 'default' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {tramos.map((t, i) => (
                  <tr key={i} style={{ background: i === 0 ? 'rgba(245,158,11,.06)' : undefined }}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {fmtFecha(t.desde)} → {i === 0 ? 'hoy' : fmtFecha(t.hasta)}
                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{t.fotos} foto(s)</div>
                    </td>
                    {t.semana.map(s => (
                      <td key={s.dia} style={{ ...td, whiteSpace: 'nowrap', color: s.entrada ? undefined : '#475569' }}>
                        {s.entrada ? `${s.entrada}–${s.salida || '?'}` : '—'}
                      </td>
                    ))}
                    <td style={{ ...td, fontSize: '0.7rem', color: '#94a3b8' }}>{t.regimen || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── detalle día por día (clic en la fila) ────────────────────────────────────
function DiasAgente({ a }: { a: AgenteAus }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', background: 'rgba(255,255,255,.02)' }}>
      <thead>
        <tr>{['Fecha', 'Día', 'En archivos', 'Horario / turno', 'Fichaje del turno', 'Reconocido', 'Salud Laboral', 'ART', 'Jefe', 'Otra novedad (archivos)'].map(h => <th key={h} style={{ ...th, position: 'static', cursor: 'default' }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {a.dias.map(d => (
          <tr key={d.fecha}>
            <td style={td}>{fmtFecha(d.fecha)}</td>
            <td style={td}>{DOW[d.dow]}</td>
            <td style={td}>
              {d.siape ? <Tag txt="SIAPE" color="#f59e0b" /> : <Tag txt="falta en SIAPE" color="#ef4444" />}{' '}
              {d.ministerio ? <Tag txt="Ministerio 28" color="#22c55e" /> : <Tag txt="falta en Ministerio" color="#ef4444" />}
            </td>
            <td style={td}>
              {d.horario || <span style={{ color: '#475569' }}>sin turno</span>}{d.aprox ? ' ≈' : ''}
              {d.turno && <div><Tag txt={TURNO[d.turno]} color={d.turno === 'DIA' ? '#94a3b8' : '#a78bfa'} /></div>}
            </td>
            <td style={td} title={d.motivosFichaje?.join('; ') || undefined}>
              <span style={{ color: FICHAJE[d.fichaje]?.color, fontWeight: 600 }}>{FICHAJE[d.fichaje]?.label ?? d.fichaje}</span>
              {(d.entrada || d.salida) && (
                <div style={{ fontSize: '0.72rem', color: '#ef4444' }}>
                  {d.entrada ? `E ${d.entrada}` : 'E —'} · {d.salida ? `S ${d.salida}` : 'S —'}
                </div>
              )}
              {d.marcas.length > 0 && <div style={{ fontSize: '0.68rem', color: '#64748b' }}>marcas del día: {d.marcas.map(m => `${m.h}${m.t ? ` ${m.t}` : ''}`).join(' · ')}</div>}
            </td>
            {[d.reconocido, d.saludLaboral, d.art, d.jefe, d.otras].map((xs, i) => (
              <td key={i} style={{ ...td, color: xs.length ? '#ef4444' : '#475569' }}>{xs.length ? xs.join(' · ') : '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sel({ v, set, todos, ops, w = 170 }: { v: string; set: (x: string) => void; todos: string; ops: { v: string; l: string }[]; w?: number }) {
  return (
    <select className="input" value={v} onChange={e => set(e.target.value)} style={{ width: w, borderColor: v ? '#f59e0b' : undefined }}>
      <option value="">{todos}</option>
      {ops.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

type ColKey = 'nombre' | 'ley' | 'servicio' | 'residente' | 'ausentes' | 'enSiape' | 'enMinisterio' | 'fichoDias' | 'reconocidoDias' | 'saludLaboralDias' | 'artDias' | 'jefeDias' | 'otrasDias';
const COLS: { key: ColKey; label: string; title: string }[] = [
  { key: 'nombre', label: 'Agente', title: 'Apellido y nombre' },
  { key: 'ley', label: 'Ley', title: 'Ley del agente' },
  { key: 'servicio', label: 'Servicio', title: 'Servicio actual' },
  { key: 'residente', label: 'Revista', title: 'Residente (ley RESIDENTES u ocupación RESIDENTE), becado o planta según el archivo' },
  { key: 'ausentes', label: 'Ausentes', title: 'Días de AUSENTE SIN AVISO en el mes (SIAPE.XLS y/o 28 en los archivos del Ministerio)' },
  { key: 'enSiape', label: 'En SIAPE', title: 'Días que figuran como AUSENTE SIN AVISO en SIAPE.XLS' },
  { key: 'enMinisterio', label: 'En Ministerio', title: 'Días que ya figuran con el 28 en los archivos del Ministerio' },
  { key: 'fichoDias', label: 'Fichó', title: 'Días de ausente en que fichó su turno (noche/guardia: entrada del día anterior o salida del siguiente) · doble clic: horarios cargados' },
  { key: 'reconocidoDias', label: 'Reconocido', title: 'Reconocimiento médico (Salud Laboral) que cubre el día' },
  { key: 'saludLaboralDias', label: 'Salud Laboral', title: 'Turno de Salud Laboral que cubre el día' },
  { key: 'artDias', label: 'ART', title: 'Accidente de trabajo en los archivos (SIAPE / Ministerio) ese día · abajo: si está en el padrón de la ART' },
  { key: 'jefeDias', label: 'Jefe', title: 'Cargado por el jefe ese día (FC, Art. 26, examen, pre-examen, pap, permiso, prácticas, novedades)' },
  { key: 'otrasDias', label: 'Otra novedad', title: 'Otra novedad en los archivos el mismo día' },
];

export default function AusentesMesSection() {
  const toast = useToast();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState('');
  const [soloConAlgo, setSoloConAlgo] = useState(false);
  const [fLey, setFLey] = useState('');
  const [fOcup, setFOcup] = useState('');
  const [fServ, setFServ] = useState('');
  const [fDep, setFDep] = useState('');
  const [fRevista, setFRevista] = useState('');
  const [fTurno, setFTurno] = useState('');
  const [fCarga, setFCarga] = useState('');
  const [fFicho, setFFicho] = useState('');
  const [orden, setOrden] = useState<{ key: ColKey; desc: boolean }>({ key: 'ausentes', desc: true });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<AgenteAus | null>(null);

  const cargar = useCallback(() => {
    setLoading(true);
    apiFetch<Resp>(`/fichajes-agentes/ausentes?anio=${anio}&mes=${mes}`)
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Error'); setData(r); })
      .catch(e => toast.error('Error al traer los ausentes', e?.message))
      .finally(() => setLoading(false));
  }, [anio, mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const contradice = (a: AgenteAus) => a.fichoDias + a.reconocidoDias + a.saludLaboralDias + a.artDias + a.jefeDias + a.otrasDias > 0;

  const filas = useMemo(() => {
    const q = busca.trim().toUpperCase();
    let fs = (data?.agentes || []).filter(a =>
      (!q || a.nombre.toUpperCase().includes(q) || a.dni.includes(q) || (a.servicio || '').toUpperCase().includes(q) || (a.ley || '').toUpperCase().includes(q)) &&
      (!soloConAlgo || contradice(a)) &&
      (!fLey || (a.ley || '') === fLey) && (!fOcup || (a.ocupacion || '') === fOcup) &&
      (!fServ || (a.servicio || '') === fServ) && (!fDep || a.dependencia === fDep) &&
      (!fRevista || revistaDe(a) === fRevista) && (!fTurno || a.turnos.includes(fTurno)) &&
      (!fCarga || (fCarga === 'FALTA_MIN' ? a.enMinisterio < a.ausentes : fCarga === 'FALTA_SIAPE' ? a.enSiape < a.ausentes : a.enSiape === a.ausentes && a.enMinisterio === a.ausentes)) &&
      (!fFicho || (fFicho === 'SI' ? a.fichoDias > 0 : fFicho === 'COMPLETO' ? a.fichoCompletoDias > 0 : a.fichoDias === 0)));
    const { key, desc } = orden;
    fs = [...fs].sort((a, b) => {
      const va = a[key] ?? '', vb = b[key] ?? '';
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb
        : typeof va === 'boolean' ? Number(va) - Number(vb) : String(va).localeCompare(String(vb));
      return (desc ? -c : c) || b.ausentes - a.ausentes;
    });
    return fs;
  }, [data, busca, soloConAlgo, fLey, fOcup, fServ, fDep, fRevista, fTurno, fCarga, fFicho, orden]);

  // opciones de los filtros (de lo que vino en el mes)
  const opciones = useMemo(() => {
    const ag = data?.agentes || [];
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
    return {
      ley: uniq(ag.map(a => a.ley)), ocup: uniq(ag.map(a => a.ocupacion)), serv: uniq(ag.map(a => a.servicio)),
      dep: uniq(ag.map(a => a.dependencia)), revista: uniq(ag.map(revistaDe)), turno: uniq(ag.flatMap(a => a.turnos)),
    };
  }, [data]);
  const hayFiltro = !!(fLey || fOcup || fServ || fDep || fRevista || fTurno || fCarga || fFicho || busca || soloConAlgo);
  const limpiar = () => { setFLey(''); setFOcup(''); setFServ(''); setFDep(''); setFRevista(''); setFTurno(''); setFCarga(''); setFFicho(''); setBusca(''); setSoloConAlgo(false); };
  const op = (xs: string[]) => xs.map(x => ({ v: x, l: x }));

  const ordenar = (key: ColKey) => setOrden(o => ({ key, desc: o.key === key ? !o.desc : key !== 'nombre' && key !== 'ley' && key !== 'servicio' }));

  const exportar = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['DNI', 'Agente', 'Ley', 'Revista', 'Ocupación', 'Servicio', 'Dependencia', 'Fecha', 'SIAPE', 'Ministerio 28', 'Horario', 'Turno', 'Fichaje', 'Entrada', 'Salida', 'Marcas del día', 'Reconocido', 'Salud Laboral', 'ART', 'Padrón ART', 'Jefe', 'Otra novedad'],
      ...filas.flatMap(a => a.dias.map(d => [Number(a.dni), a.nombre, a.ley || '', revistaDe(a), a.ocupacion || '', a.servicio || '', a.dependencia, fmtFecha(d.fecha),
        d.siape ? 'SI' : 'NO', d.ministerio ? 'SI' : 'NO', d.horario || '', d.turno ? TURNO[d.turno] : '', FICHAJE[d.fichaje]?.label ?? d.fichaje,
        d.entrada || '', d.salida || '', d.marcas.map(m => m.h).join(' '), d.reconocido.join(' | '),
        d.saludLaboral.join(' | '), d.art.join(' | '), a.enPadronArt ? 'SI' : 'NO', d.jefe.join(' | '), d.otras.join(' | ')])),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Ausentes ${MESES[mes - 1]} ${anio}`.slice(0, 31));
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([out], { type: 'application/octet-stream' }), `ausentes_${anio}-${String(mes).padStart(2, '0')}.xlsx`);
  };

  const anios = Array.from({ length: 4 }, (_, i) => hoy.getFullYear() - i);
  const c = data?.corrida;
  const tot = (k: keyof AgenteAus) => filas.reduce((s, a) => s + (a[k] as number), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card gp-card-14" style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ width: 100 }}>
          {anios.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input" value={mes} onChange={e => setMes(Number(e.target.value))} style={{ width: 140 }}>
          {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input className="input" placeholder="Buscar nombre, DNI, servicio, ley…" value={busca} onChange={e => setBusca(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloConAlgo} onChange={e => setSoloConAlgo(e.target.checked)} /> solo con algo que contradice
        </label>
        <button className="btn" onClick={cargar} disabled={loading}>{loading ? 'Cargando…' : '↻ Actualizar'}</button>
        <button className="btn" onClick={exportar} disabled={!filas.length}>⬇ Excel</button>
        <div style={{ flexBasis: '100%', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Sel v={fLey} set={setFLey} todos="Ley: todas" ops={op(opciones.ley)} w={190} />
          <Sel v={fRevista} set={setFRevista} todos="Revista: todas" ops={opciones.revista.map(x => ({ v: x, l: x === 'BECADO' ? 'Becados' : x === 'RESIDENTE' ? 'Residentes' : x }))} w={160} />
          <Sel v={fOcup} set={setFOcup} todos="Ocupación: todas" ops={op(opciones.ocup)} w={200} />
          <Sel v={fServ} set={setFServ} todos="Servicio: todos" ops={op(opciones.serv)} w={230} />
          <Sel v={fDep} set={setFDep} todos="Dependencia: todas" ops={op(opciones.dep)} w={160} />
          <Sel v={fTurno} set={setFTurno} todos="Turno: todos" ops={opciones.turno.map(x => ({ v: x, l: TURNO[x] || x }))} w={140} />
          <Sel v={fCarga} set={setFCarga} todos="Carga: todas" w={190} ops={[
            { v: 'FALTA_MIN', l: 'Falta en Ministerio' }, { v: 'FALTA_SIAPE', l: 'Falta en SIAPE' }, { v: 'OK', l: 'En los dos' }]} />
          <Sel v={fFicho} set={setFFicho} todos="Fichaje: todos" w={190} ops={[
            { v: 'SI', l: 'Fichó algún día' }, { v: 'COMPLETO', l: 'Fichó entrada y salida' }, { v: 'NO', l: 'No fichó ningún día' }]} />
          {hayFiltro && <button className="btn" onClick={limpiar}>✕ Limpiar filtros</button>}
        </div>
      </div>

      {data && (
        <div style={{ fontSize: '0.76rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>
            {filas.length} agentes · {tot('ausentes')} días de ausente · {tot('enSiape')} en SIAPE · {tot('enMinisterio')} ya en el Ministerio · {tot('fichoDias')} con fichada del turno.
            {' '}Clic en un agente: día por día · doble clic en "Fichó": horarios cargados.
          </span>
          {c ? (
            <span>
              Fuente: archivos bajados — {c.archivo_siape.split('\\').pop()} ({c.siape_modificado}) y {c.archivo_ministerio} ({c.ministerio_modificado}) ·
              comparación #{c.id} del {c.creado_en}. Si el mes no está en esos archivos, no aparece nada.
            </span>
          ) : <b style={{ color: '#f59e0b' }}>Todavía no hay ninguna comparación de los archivos bajados.</b>}
          {data.avisos?.map((x, i) => <b key={i} style={{ color: '#f59e0b' }}>{x}</b>)}
        </div>
      )}

      <div className="card gp-card-14" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: 300, width: '100%' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {COLS.map(col => (
                <th key={col.key} title={col.title} style={th} onClick={() => ordenar(col.key)}>
                  {col.label}{orden.key === col.key ? (orden.desc ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map(a => (
              <React.Fragment key={a.dni}>
                <tr onClick={() => setAbierto(x => (x === a.dni ? null : a.dni))} style={{ cursor: 'pointer', background: abierto === a.dni ? 'rgba(245,158,11,.06)' : undefined }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{a.nombre}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                      {a.dni} · {a.dependencia}
                      {a.estadoEmpleo && a.estadoEmpleo !== 'ACTIVO' && <span style={{ color: '#f59e0b' }}> · {a.estadoEmpleo}</span>}
                      {!a.enReloj && <span style={{ color: '#ef4444' }}> · no está en el reloj</span>}
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: '0.72rem' }}>{a.ley || '—'}</td>
                  <td style={{ ...td, fontSize: '0.72rem', color: '#94a3b8' }}>{a.servicio || '—'}{a.ocupacion ? <div style={{ color: '#64748b' }}>{a.ocupacion}</div> : null}</td>
                  <td style={td}>
                    {a.residente ? <Tag txt="Residente" color="#a78bfa" /> : a.becado ? <Tag txt="Becado" color="#2dd4bf" />
                      : <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{a.planta || '—'}</span>}
                    {a.turnos.filter(t => t !== 'DIA').map(t => <div key={t} style={{ marginTop: 2 }}><Tag txt={TURNO[t]} color="#a78bfa" /></div>)}
                  </td>
                  <td style={td}><b>{a.ausentes}</b><div style={{ fontSize: '0.68rem', color: '#64748b' }}>{a.dias.map(d => d.fecha.slice(8)).join(', ')}</div></td>
                  <td style={td}>
                    <span style={{ color: a.enSiape === a.ausentes ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>{a.enSiape} de {a.ausentes}</span>
                  </td>
                  <td style={td}>
                    <span style={{ color: a.enMinisterio === a.ausentes ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{a.enMinisterio} de {a.ausentes}</span>
                  </td>
                  <td style={{ ...td, userSelect: 'none' }} title="Doble clic: horarios cargados"
                      onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); setHorarios(a); }}>
                    <Cant v={a.fichoDias} de={a.ausentes} alerta /> <span style={{ fontSize: '0.68rem', color: '#64748b' }}>🕐</span>
                    {a.fichoDias > 0 && <div style={{ fontSize: '0.66rem', color: '#94a3b8' }}>{a.fichoCompletoDias} completo(s)</div>}
                  </td>
                  <td style={td}><Cant v={a.reconocidoDias} de={a.ausentes} alerta /></td>
                  <td style={td}><Cant v={a.saludLaboralDias} de={a.ausentes} alerta /></td>
                  <td style={td}>
                    <Cant v={a.artDias} de={a.ausentes} alerta />
                    <div style={{ fontSize: '0.66rem', color: a.enPadronArt ? '#64748b' : '#f59e0b' }}>{a.enPadronArt ? 'en padrón' : 'no está en padrón'}</div>
                  </td>
                  <td style={td}><Cant v={a.jefeDias} de={a.ausentes} alerta /></td>
                  <td style={td}><Cant v={a.otrasDias} de={a.ausentes} alerta /></td>
                </tr>
                {abierto === a.dni && (
                  <tr><td colSpan={COLS.length} style={{ padding: '4px 8px 12px' }}><DiasAgente a={a} /></td></tr>
                )}
              </React.Fragment>
            ))}
            {!loading && !filas.length && (
              <tr><td style={{ ...td, color: '#64748b' }} colSpan={COLS.length}>Sin ausentes para mostrar.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {horarios && <HorariosModal agente={horarios} onClose={() => setHorarios(null)} />}
    </div>
  );
}

// src/pages/AsistenciaPage/FichajesSection.tsx
// Pestaña "Fichajes": fichadas de todos los agentes mes por mes contra el horario que tenían ese día (tabla
// horarios_historial) y lo que dice SIAPE. Resumen por agente para detectar gente + detalle día por día.
// Backend: GET /fichajes-agentes, /fichajes-agentes/detalle, /fichajes-agentes/anual

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

interface Resumen {
  debia: number; trabajados: number; incompletas: number; faltas: number; presenteSinFichar: number; tarde: number;
  minTarde: number; antes: number; despues: number; otroHorario: number; sinSalida: number; sinEntrada: number;
  licencias: number; extra: number; fichoConLicencia: number; diasAprox: number;
}
interface FilaAgente extends Resumen {
  dni: string; nombre: string; servicio: string | null; estructura: string | null; regimen: string | null;
  sinHorario: boolean; enReloj: boolean;
}
interface RespResumen {
  ok: boolean; error?: string; desde: string; hasta: string; tolerancia: number; errorFichadas: string | null;
  horarios: { fotos: number; primera: string | null; ultima: string | null };
  agentes: FilaAgente[];
}
type Estado = 'OK' | 'TARDE' | 'ANTES' | 'TARDE_ANTES' | 'DESPUES' | 'OTRO_HORARIO' | 'INCOMPLETA' | 'FALTA' | 'LICENCIA'
  | 'FERIADO' | 'EXTRA' | 'NO_TRABAJA' | 'HOY';
interface Dia {
  fecha: string; dow: number; horario: string | null; aprox: boolean; marcas: { h: string; t: 'E' | 'S' | null }[];
  entrada: string | null; salida: string | null; tardeMin: number; antesMin: number; despuesMin: number; motivos: string[]; estado: Estado;
  justifica: string | null; siape: string[]; feriado: string | null; presenteSinFichar: boolean; fichoConLicencia: boolean;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const ANIO_MIN = 2020;   // primeras fichadas: 03/2020

const ESTADOS: Record<Estado, { label: string; color: string }> = {
  OK: { label: 'OK', color: '#22c55e' },
  TARDE: { label: 'Tarde', color: '#f59e0b' },
  ANTES: { label: 'Se fue antes', color: '#f59e0b' },
  TARDE_ANTES: { label: 'Tarde + se fue antes', color: '#f97316' },
  DESPUES: { label: 'Se fue después', color: '#f59e0b' },
  OTRO_HORARIO: { label: 'Ficha otro horario', color: '#94a3b8' },
  INCOMPLETA: { label: 'Fichada incompleta', color: '#eab308' },
  FALTA: { label: 'Falta', color: '#ef4444' },
  LICENCIA: { label: 'Licencia', color: '#60a5fa' },
  FERIADO: { label: 'Feriado', color: '#a78bfa' },
  EXTRA: { label: 'Fichó sin horario', color: '#2dd4bf' },
  NO_TRABAJA: { label: '—', color: '#64748b' },
  HOY: { label: 'En curso', color: '#94a3b8' },
};

type ColKey = keyof Resumen | 'nombre' | 'servicio';
const COLS: { key: ColKey; label: string; title: string; num?: boolean }[] = [
  { key: 'nombre', label: 'Agente', title: 'Apellido y nombre (SIAPE)' },
  { key: 'servicio', label: 'Servicio', title: 'Servicio actual (pase abierto)' },
  { key: 'debia', label: 'Debía', title: 'Días con turno según el horario de ese día', num: true },
  { key: 'trabajados', label: 'Fichó', title: 'Días con turno en que fichó entrada y salida', num: true },
  { key: 'incompletas', label: 'Incompletas', title: 'Fichó solo la entrada o solo la salida (no cuenta como "Fichó")', num: true },
  { key: 'faltas', label: 'Faltas', title: 'Debía venir, no fichó y no tiene licencia, franco ni feriado', num: true },
  { key: 'presenteSinFichar', label: 'PRESENTE sin fichar', title: 'SIAPE dice PRESENTE y no hay ninguna fichada', num: true },
  { key: 'tarde', label: 'Tarde', title: 'Llegadas tarde (más que la tolerancia)', num: true },
  { key: 'minTarde', label: 'Min tarde', title: 'Minutos de tarde sumados', num: true },
  { key: 'antes', label: 'Se fue antes', title: 'Salidas antes de hora (más que la tolerancia)', num: true },
  { key: 'despues', label: 'Se fue después', title: 'Salidas después de hora (más que la tolerancia)', num: true },
  { key: 'otroHorario', label: 'Otro horario', title: 'La salida cae fuera de la ventana del turno: ficha otro horario', num: true },
  { key: 'sinSalida', label: 'Sin salida', title: 'Fichó la entrada y no la salida', num: true },
  { key: 'sinEntrada', label: 'Sin entrada', title: 'Fichó la salida y no la entrada', num: true },
  { key: 'licencias', label: 'Licencia', title: 'Días justificados (SIAPE, Salud Laboral, FC, Art. 26, Ministerio)', num: true },
  { key: 'extra', label: 'Sin horario', title: 'Días en que fichó sin tener turno', num: true },
  { key: 'fichoConLicencia', label: 'Fichó con lic.', title: 'Fichó un día que figura de licencia', num: true },
];

const th: React.CSSProperties = {
  textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,.08)', fontWeight: 700,
  fontSize: '0.72rem', color: '#94a3b8', cursor: 'pointer', whiteSpace: 'nowrap', position: 'sticky', top: 0,
  background: 'var(--bg, #0f172a)',
};
const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '0.78rem' };
const fmtFecha = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

function Badge({ estado, detalle }: { estado: Estado; detalle?: string }) {
  const e = ESTADOS[estado];
  return (
    <span style={{
      background: `${e.color}22`, border: `1px solid ${e.color}66`, color: e.color,
      borderRadius: 8, padding: '1px 8px', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap',
    }}>{e.label}{detalle ? ` · ${detalle}` : ''}</span>
  );
}

// tipo que registró el reloj: E = entrada, S = salida
const TIPO_MARCA: Record<'E' | 'S', { label: string; color: string; title: string }> = {
  E: { label: 'E', color: '#22c55e', title: 'Reloj de entrada' },
  S: { label: 'S', color: '#f472b6', title: 'Reloj de salida' },
};

const Num = ({ v, alerta }: { v: number; alerta?: boolean }) => (
  <span style={{ color: v ? (alerta ? '#ef4444' : undefined) : '#475569', fontWeight: v && alerta ? 700 : 400 }}>{v}</span>
);

// ── detalle de un agente ──────────────────────────────────────────────────────
function DetalleAgente({ agente, anio0, mes0, onClose }: { agente: FilaAgente; anio0: number; mes0: number; onClose: () => void }) {
  const toast = useToast();
  const [anio, setAnio] = useState(anio0);
  const [mes, setMes] = useState(mes0);
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [loading, setLoading] = useState(false);
  const [verAnio, setVerAnio] = useState(false);
  const [anual, setAnual] = useState<(Resumen & { mes: number })[] | null>(null);
  const [soloNovedad, setSoloNovedad] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>(`/fichajes-agentes/detalle?dni=${agente.dni}&anio=${anio}&mes=${mes}`)
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Error'); setDias(r.dias); setResumen(r.resumen); })
      .catch(e => toast.error('Error al traer el detalle', e?.message))
      .finally(() => setLoading(false));
  }, [agente.dni, anio, mes]);

  useEffect(() => {
    if (!verAnio) return;
    setAnual(null);
    apiFetch<any>(`/fichajes-agentes/anual?dni=${agente.dni}&anio=${anio}`)
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Error'); setAnual(r.meses); })
      .catch(e => toast.error('Error al traer el año', e?.message));
  }, [verAnio, agente.dni, anio]);

  const mover = (n: number) => {
    let m = mes + n, a = anio;
    if (m < 1) { m = 12; a--; } else if (m > 12) { m = 1; a++; }
    if (a < ANIO_MIN) return;
    setMes(m); setAnio(a);
  };

  const visibles = (dias || []).filter(d => !soloNovedad || !['OK', 'NO_TRABAJA', 'HOY'].includes(d.estado));

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex',
      alignItems: 'flex-start', justifyContent: 'center', padding: '24px 12px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} className="card gp-card-14" style={{ width: 'min(1150px, 100%)', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{agente.nombre}</div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              DNI {agente.dni} · {agente.servicio || agente.estructura || 'sin servicio'}{agente.regimen ? ` · ${agente.regimen}` : ''}
              {!agente.enReloj && <span style={{ color: '#ef4444' }}> · no está dado de alta en el reloj</span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn" onClick={() => mover(-1)}>◀</button>
            <span style={{ minWidth: 130, textAlign: 'center', fontWeight: 700 }}>{MESES[mes - 1]} {anio}</span>
            <button className="btn" onClick={() => mover(1)}>▶</button>
            <button className="btn" onClick={() => setVerAnio(v => !v)}>{verAnio ? 'Ocultar año' : `Ver ${anio} completo`}</button>
            <button className="btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {verAnio && (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            {!anual ? <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Cargando año…</div> : (
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>{['Mes', 'Debía', 'Fichó', 'Incompletas', 'Faltas','PRESENTE sin fichar', 'Tarde', 'Se fue antes', 'Sin salida', 'Licencia', 'Sin horario'].map(h => <th key={h} style={{ ...th, cursor: 'default', position: 'static' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {anual.map(m => (
                    <tr key={m.mes} onClick={() => setMes(m.mes)} style={{ cursor: 'pointer', background: m.mes === mes ? 'rgba(245,158,11,.08)' : undefined }}>
                      <td style={td}>{MESES[m.mes - 1]}</td>
                      <td style={td}><Num v={m.debia} /></td>
                      <td style={td}><Num v={m.trabajados} /></td>
                      <td style={td}><Num v={m.incompletas} /></td>
                      <td style={td}><Num v={m.faltas} alerta /></td>
                      <td style={td}><Num v={m.presenteSinFichar} alerta /></td>
                      <td style={td}><Num v={m.tarde} /></td>
                      <td style={td}><Num v={m.antes} /></td>
                      <td style={td}><Num v={m.sinSalida} /></td>
                      <td style={td}><Num v={m.licencias} /></td>
                      <td style={td}><Num v={m.extra} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {resumen && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: '0.8rem' }}>
            <span>Debía <b>{resumen.debia}</b></span>
            <span>Fichó <b>{resumen.trabajados}</b></span>
            <span style={{ color: resumen.incompletas ? '#eab308' : undefined }}>
              Incompletas <b>{resumen.incompletas}</b>{resumen.incompletas ? ` (sin salida ${resumen.sinSalida} · sin entrada ${resumen.sinEntrada})` : ''}
            </span>
            <span style={{ color: resumen.faltas ? '#ef4444' : undefined }}>Faltas <b>{resumen.faltas}</b></span>
            <span style={{ color: resumen.presenteSinFichar ? '#ef4444' : undefined }}>PRESENTE sin fichar <b>{resumen.presenteSinFichar}</b></span>
            <span>Tarde <b>{resumen.tarde}</b> ({resumen.minTarde} min)</span>
            <span>Se fue antes <b>{resumen.antes}</b></span>
            <span>Se fue después <b>{resumen.despues}</b></span>
            <span>Otro horario <b>{resumen.otroHorario}</b></span>
            <span>Licencia <b>{resumen.licencias}</b></span>
            <span>Sin horario <b>{resumen.extra}</b></span>
            <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={soloNovedad} onChange={e => setSoloNovedad(e.target.checked)} /> solo días con algo
            </label>
          </div>
        )}
        {resumen && resumen.diasAprox > 0 && (
          <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#f59e0b' }}>
            ≈ {resumen.diasAprox} día(s) usan un horario posterior (todavía no está bajado el historial de horarios de esa fecha).
          </div>
        )}

        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          {loading && !dias ? <div style={{ color: '#94a3b8' }}>Cargando…</div> : (
            <table style={{ borderCollapse: 'collapse', width: '100%', opacity: loading ? 0.5 : 1 }}>
              <thead>
                <tr>{['Fecha', 'Día', 'Horario', 'Entrada', 'Salida', 'Diferencia', 'Estado', 'Marcas del día', 'SIAPE / justificación'].map(h => <th key={h} style={{ ...th, cursor: 'default', position: 'static' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {visibles.map(d => {
                  const grisado = d.estado === 'NO_TRABAJA';
                  return (
                    <tr key={d.fecha} style={{ opacity: grisado ? 0.55 : 1, background: d.presenteSinFichar ? 'rgba(239,68,68,.08)' : undefined }}>
                      <td style={td}>{fmtFecha(d.fecha)}</td>
                      <td style={td}>{DOW[d.dow]}</td>
                      <td style={td} title={d.aprox ? 'Horario posterior a la fecha (aproximado)' : undefined}>
                        {d.horario || <span style={{ color: '#475569' }}>no trabaja</span>}{d.aprox ? ' ≈' : ''}
                      </td>
                      <td style={{ ...td, color: d.tardeMin ? '#f59e0b' : undefined }}>{d.entrada || '—'}</td>
                      <td style={{ ...td, color: d.antesMin || d.despuesMin ? '#f59e0b' : undefined }}>{d.salida || '—'}</td>
                      <td style={td}>
                        {d.tardeMin ? <span style={{ color: '#f59e0b' }}>+{d.tardeMin}′ tarde </span> : null}
                        {d.antesMin ? <span style={{ color: '#f59e0b' }}>−{d.antesMin}′ antes</span> : null}
                        {d.despuesMin ? <span style={{ color: '#f59e0b' }}>+{d.despuesMin}′ después</span> : null}
                        {!d.tardeMin && !d.antesMin && !d.despuesMin && d.motivos?.length
                          ? <span style={{ color: '#94a3b8' }}>{d.motivos.join('; ')}</span> : null}
                      </td>
                      <td style={td}>
                        <Badge estado={d.estado} detalle={d.estado === 'INCOMPLETA' ? (d.entrada ? 'sin salida' : 'sin entrada') : undefined} />
                      </td>
                      <td style={{ ...td, color: '#94a3b8' }}>
                        {d.marcas.length ? d.marcas.map((x, i) => (
                          <span key={i}>
                            {i > 0 && ' · '}{x.h}
                            {x.t && <sup title={TIPO_MARCA[x.t].title} style={{ color: TIPO_MARCA[x.t].color, fontWeight: 700, marginLeft: 1 }}>{TIPO_MARCA[x.t].label}</sup>}
                          </span>
                        )) : '—'}
                      </td>
                      <td style={td}>
                        {d.presenteSinFichar && <b style={{ color: '#ef4444' }}>PRESENTE en SIAPE sin fichar · </b>}
                        {d.fichoConLicencia && <b style={{ color: '#60a5fa' }}>fichó con licencia · </b>}
                        {d.justifica || (d.siape.length ? d.siape.join(', ') : '')}
                        {d.feriado ? ` (feriado: ${d.feriado})` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── resumen del mes ───────────────────────────────────────────────────────────
export default function FichajesSection() {
  const toast = useToast();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [data, setData] = useState<RespResumen | null>(null);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState('');
  const [soloProblemas, setSoloProblemas] = useState(true);
  const [ocultarSinReloj, setOcultarSinReloj] = useState(false);
  const [orden, setOrden] = useState<{ key: ColKey; desc: boolean }>({ key: 'presenteSinFichar', desc: true });
  const [limite, setLimite] = useState(200);
  const [sel, setSel] = useState<FilaAgente | null>(null);

  const cargar = useCallback((refresh = false) => {
    setLoading(true);
    apiFetch<RespResumen>(`/fichajes-agentes?anio=${anio}&mes=${mes}${refresh ? '&refresh=1' : ''}`)
      .then(r => { if (!r?.ok) throw new Error(r?.error || 'Error'); setData(r); setLimite(200); })
      .catch(e => toast.error('Error al traer los fichajes', e?.message))
      .finally(() => setLoading(false));
  }, [anio, mes]);

  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => {
    const q = busca.trim().toUpperCase();
    let fs = (data?.agentes || []).filter(a =>
      (!q || a.nombre.toUpperCase().includes(q) || a.dni.includes(q) ||
        (a.servicio || '').toUpperCase().includes(q) || (a.estructura || '').toUpperCase().includes(q)) &&
      (!soloProblemas || a.faltas || a.presenteSinFichar || a.tarde || a.antes || a.incompletas || a.fichoConLicencia) &&
      (!ocultarSinReloj || a.enReloj));
    const { key, desc } = orden;
    fs = [...fs].sort((a, b) => {
      const va = a[key] ?? '', vb = b[key] ?? '';
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return (desc ? -c : c) || b.faltas - a.faltas;
    });
    return fs;
  }, [data, busca, soloProblemas, ocultarSinReloj, orden]);

  const ordenar = (key: ColKey) => setOrden(o => ({ key, desc: o.key === key ? !o.desc : !!COLS.find(c => c.key === key)?.num }));

  const exportar = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['DNI', 'Agente', 'Servicio', 'Estructura SIAPE', 'En reloj', ...COLS.slice(2).map(c => c.label)],
      ...filas.map(a => [Number(a.dni), a.nombre, a.servicio || '', a.estructura || '', a.enReloj ? 'SI' : 'NO',
        ...COLS.slice(2).map(c => a[c.key as keyof Resumen])]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${MESES[mes - 1]} ${anio}`);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([out], { type: 'application/octet-stream' }), `fichajes_${anio}-${String(mes).padStart(2, '0')}.xlsx`);
  };

  const anios = Array.from({ length: hoy.getFullYear() - ANIO_MIN + 1 }, (_, i) => hoy.getFullYear() - i);
  const h = data?.horarios;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card gp-card-14" style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ width: 100 }}>
          {anios.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input" value={mes} onChange={e => setMes(Number(e.target.value))} style={{ width: 140 }}>
          {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input className="input" placeholder="Buscar nombre, DNI, servicio…" value={busca} onChange={e => setBusca(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloProblemas} onChange={e => setSoloProblemas(e.target.checked)} /> solo con problemas
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={ocultarSinReloj} onChange={e => setOcultarSinReloj(e.target.checked)} /> ocultar los que no están en el reloj
        </label>
        <button className="btn" onClick={() => cargar(true)} disabled={loading}>{loading ? 'Cargando…' : '↻ Actualizar'}</button>
        <button className="btn" onClick={exportar} disabled={!filas.length}>⬇ Excel</button>
      </div>

      {data && (
        <div style={{ fontSize: '0.76rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>
            {filas.length} de {data.agentes.length} agentes · tolerancia {data.tolerancia} min · clic en un agente para ver su mes día por día.
          </span>
          <span>
            Horarios: {h?.fotos ? `${h.fotos} foto(s) del ${fmtFecha(h.primera)} al ${fmtFecha(h.ultima)}` : 'sin historial cargado'}.
            {h?.primera && data.hasta < h.primera && <b style={{ color: '#f59e0b' }}> Este mes es anterior al historial bajado: se compara con un horario posterior (≈), puede dar faltas o tardes falsas.</b>}
            {' '}Si el agente rota y SIAPE tiene el horario "de planta", también aparecen faltas que no son.
          </span>
          {data.errorFichadas && <b style={{ color: '#ef4444' }}>{data.errorFichadas}</b>}
        </div>
      )}

      <div className="card gp-card-14" style={{ padding: 0, overflow: 'auto', maxHeight: '70vh' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {COLS.map(c => (
                <th key={c.key} title={c.title} style={th} onClick={() => ordenar(c.key)}>
                  {c.label}{orden.key === c.key ? (orden.desc ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, limite).map(a => (
              <tr key={a.dni} onClick={() => setSel(a)} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{a.nombre}</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    {a.dni}
                    {!a.enReloj && <span style={{ color: '#ef4444' }}> · no está en el reloj</span>}
                    {a.sinHorario && <span style={{ color: '#f59e0b' }}> · sin horario en SIAPE</span>}
                    {a.diasAprox > 0 && <span style={{ color: '#f59e0b' }} title="Horario posterior a la fecha"> · ≈</span>}
                  </div>
                </td>
                <td style={{ ...td, fontSize: '0.72rem', color: '#94a3b8', maxWidth: 220 }}>{a.servicio || a.estructura || '—'}</td>
                {COLS.slice(2).map(c => (
                  <td key={c.key} style={td}>
                    <Num v={a[c.key as keyof Resumen] as number} alerta={c.key === 'faltas' || c.key === 'presenteSinFichar'} />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && !filas.length && (
              <tr><td style={{ ...td, color: '#64748b' }} colSpan={COLS.length}>Sin agentes para mostrar.</td></tr>
            )}
          </tbody>
        </table>
        {filas.length > limite && (
          <div style={{ padding: 10, textAlign: 'center' }}>
            <button className="btn" onClick={() => setLimite(l => l + 300)}>Ver más ({filas.length - limite} restantes)</button>
          </div>
        )}
      </div>

      {sel && <DetalleAgente agente={sel} anio0={anio} mes0={mes} onClose={() => setSel(null)} />}
    </div>
  );
}

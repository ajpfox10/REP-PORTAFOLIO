// src/pages/LicenciasPlusPage/index.tsx
// Licencias y Plus (Ley 10471): qué licencia descuenta del plus de Guardia / Planta y quién no cobra en el mes.
// Back: /plus-licencias (tabla licencias_plus_norma, mig 089). Se llega desde la card Asistencia del dashboard.
// Quién no cobra: pestaña Ministerio = MINISTERIO/UPA4/UPA18.xls que baja el robot; pestaña anual = ministerio_novedades_anual.
// Criterios del usuario: lo que la norma no nombra descuenta; la mezcla de dos o más licencias distintas descuenta.
// Ve: admin y reader (app:normativa:access). Edita: solo crud:*:*.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';

type Clase = 'EXCEPTUADA' | 'ENFERMEDAD' | 'NEUTRA' | 'DESCUENTA';
const CLASES: Clase[] = ['EXCEPTUADA', 'ENFERMEDAD', 'NEUTRA', 'DESCUENTA'];
const CLASE_INFO: Record<Clase, { label: string; color: string; ayuda: string }> = {
  EXCEPTUADA: { label: 'No descuenta', color: 'rgba(34,197,94,0.22)', ayuda: 'La norma dice que no es inasistencia' },
  ENFERMEDAD: { label: 'Escala enfermedad', color: 'rgba(234,179,8,0.22)', ayuda: 'Guardia: 1 guardia ok, 2→75%, 3→50%, 4→25% · Planta: 6 días ok, 12→75%, 18→50%, 24→25%' },
  NEUTRA: { label: 'No es ausencia', color: 'rgba(148,163,184,0.2)', ayuda: 'Franco, comisión, horas de salida, asueto' },
  DESCUENTA: { label: 'Descuenta', color: 'rgba(239,68,68,0.22)', ayuda: 'La norma no la nombra: es causal de descuento' },
};

interface Licencia {
  codigo: string; novedad: string; guardia: Clase; planta: Clase;
  norma_guardia: string | null; norma_planta: string | null; observacion: string | null;
  en_catalogo: number; sin_clasificar: number; usos_10471: number;
}
interface Opcion { codigo: string; novedad: string; siape: string | null }
interface FilaNoCobra {
  mes: string; dni: number; nombre: string; profesion: string | null; tipo: 'GUARDIA' | 'PLANTA'; pct: number | null; motivos: string[]; sin_horario: boolean;
  licencias: { codigo: string; novedad: string; clase: Clase; cantidad: number; fechas: string[] }[];
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.12)' };
const td: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.84rem', verticalAlign: 'top' };
const sel: React.CSSProperties = { padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b', color: 'inherit', fontSize: '0.8rem' };

function Chip({ c }: { c: Clase }) {
  return <span className="badge" title={CLASE_INFO[c].ayuda} style={{ background: CLASE_INFO[c].color, whiteSpace: 'nowrap' }}>{CLASE_INFO[c].label}</span>;
}

function mesAnterior(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function TabLicencias({ puedeEditar }: { puedeEditar: boolean }) {
  const toast = useToast();
  const [lic, setLic] = useState<Licencia[]>([]);
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'todas' | 'descuentan' | 'normadas'>('todas');
  const [q, setQ] = useState('');
  const [nueva, setNueva] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [r, o] = await Promise.all([
        apiFetch<{ ok: boolean; licencias: Licencia[] }>('/plus-licencias'),
        apiFetch<{ ok: boolean; opciones: Opcion[] }>('/plus-licencias/opciones'),
      ]);
      setLic(r.licencias ?? []);
      setOpciones(o.opciones ?? []);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cargar la tabla');
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (l: Pick<Licencia, 'codigo' | 'novedad' | 'guardia' | 'planta' | 'observacion'>) => {
    try {
      await apiFetch(`/plus-licencias/${encodeURIComponent(l.codigo)}`, {
        method: 'PUT',
        body: JSON.stringify({ novedad: l.novedad, guardia: l.guardia, planta: l.planta, observacion: l.observacion }),
      });
      toast.ok(`${l.codigo} guardado`);
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar');
    }
  };

  const agregar = async () => {
    const o = opciones.find((x) => x.codigo === nueva);
    if (!o) return;
    await guardar({ codigo: o.codigo, novedad: o.novedad, guardia: 'DESCUENTA', planta: 'DESCUENTA', observacion: 'Agregada desde Mapeo de novedades: revisar' });
    setNueva('');
  };

  const lista = useMemo(() => {
    const nq = q.trim().toUpperCase();
    return lic.filter((l) => {
      if (filtro === 'descuentan' && l.guardia !== 'DESCUENTA' && l.planta !== 'DESCUENTA') return false;
      if (filtro === 'normadas' && !(l.norma_guardia || l.norma_planta)) return false;
      if (nq && !`${l.codigo} ${l.novedad}`.toUpperCase().includes(nq)) return false;
      return true;
    });
  }, [lic, filtro, q]);

  const sinNorma = lic.filter((l) => l.guardia === 'DESCUENTA' || l.planta === 'DESCUENTA').length;

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {([['todas', `Todas (${lic.length})`], ['descuentan', `Descuentan (${sinNorma})`], ['normadas', 'Normadas']] as const).map(([k, l]) => (
          <button key={k} type="button" className="btn" onClick={() => setFiltro(k)} style={{ opacity: filtro === k ? 1 : 0.55, fontWeight: filtro === k ? 700 : 400 }}>{l}</button>
        ))}
        <input placeholder="Buscar código o licencia…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...sel, padding: '6px 10px', minWidth: 220 }} />
        {puedeEditar && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={nueva} onChange={(e) => setNueva(e.target.value)} style={{ ...sel, maxWidth: 360 }}>
              <option value="">＋ Agregar desde Mapeo de novedades ({opciones.length})</option>
              {opciones.map((o) => (
                <option key={o.codigo} value={o.codigo}>{o.novedad}{o.siape ? ` ← ${o.siape}` : ''}</option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!nueva} onClick={agregar}>Agregar</button>
          </div>
        )}
      </div>
      <div className="muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>
        Rojo = la norma no la nombra, por lo tanto <b>descuenta</b>. Juntar dos o más licencias distintas en el mes también descuenta.
        Las agregadas desde el mapeo entran como "Descuenta" hasta que se clasifiquen.
        {!puedeEditar && ' Solo un administrador puede cambiar la clasificación.'}
      </div>

      {loading ? <div className="muted" style={{ marginTop: 12 }}>Cargando…</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
            <thead>
              <tr><th style={th}>Código</th><th style={th}>Licencia</th><th style={th}>Plus Guardia</th><th style={th}>Plus Planta</th><th style={th}>Norma</th><th style={{ ...th, textAlign: 'right' }}>Usos</th></tr>
            </thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.codigo}>
                  <td style={{ ...td, fontWeight: 700 }}>{l.codigo}</td>
                  <td style={td}>
                    {l.novedad.replace(/^[^-]+-/, '')}
                    {!!l.sin_clasificar && <span className="badge" style={{ marginLeft: 6, background: 'rgba(249,115,22,0.25)' }}>nueva</span>}
                    {l.observacion && <div className="muted" style={{ fontSize: '0.72rem' }}>{l.observacion}</div>}
                  </td>
                  {(['guardia', 'planta'] as const).map((campo) => (
                    <td key={campo} style={td}>
                      {puedeEditar ? (
                        <select value={l[campo]} style={{ ...sel, background: CLASE_INFO[l[campo]].color }}
                          onChange={(e) => guardar({ ...l, [campo]: e.target.value as Clase })}>
                          {CLASES.map((c) => <option key={c} value={c}>{CLASE_INFO[c].label}</option>)}
                        </select>
                      ) : <Chip c={l[campo]} />}
                    </td>
                  ))}
                  <td style={{ ...td, fontSize: '0.76rem' }}>
                    {l.norma_guardia && <div>G: {l.norma_guardia}</div>}
                    {l.norma_planta && <div>P: {l.norma_planta}</div>}
                    {!l.norma_guardia && !l.norma_planta && <span style={{ color: '#f87171' }}>No normada</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{l.usos_10471 || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const nombreMes = (aaaamm: string) => `${MESES[Number(aaaamm.slice(5, 7)) - 1]} ${aaaamm.slice(0, 4)}`;

interface RespNoCobran {
  filas: FilaNoCobra[];
  total_agentes: number;
  aviso_horario: string | null;
  cubre_desde: string | null;
  archivos: { archivo: string; filas: number; desde: string | null; hasta: string | null; error?: string }[];
}

type Estado = 'nocobra' | 'reducido' | 'revisar' | 'completo';
const estadoDe = (f: FilaNoCobra): Estado => f.pct === null ? 'revisar' : f.pct === 0 ? 'nocobra' : f.pct < 100 ? 'reducido' : 'completo';

function TabNoCobran({ fuente }: { fuente: 'archivo' | 'anual' }) {
  const toast = useToast();
  const ini = mesAnterior();
  const [anio, setAnio] = useState(Number(ini.slice(0, 4)));
  const [mes, setMes] = useState<number | 0>(Number(ini.slice(5, 7))); // 0 = todo el año
  const [data, setData] = useState<RespNoCobran | null>(null);
  const [loading, setLoading] = useState(false);
  const [estados, setEstados] = useState<Set<Estado>>(new Set(['nocobra']));
  const toggleEstado = (e: Estado) => setEstados((s) => { const n = new Set(s); n.has(e) ? n.delete(e) : n.add(e); return n; });
  const [vista, setVista] = useState<'agente' | 'licencia'>('agente');
  const [abierto, setAbierto] = useState<Set<string>>(new Set());
  const [fProfesion, setFProfesion] = useState('');
  const [fPlus, setFPlus] = useState<'' | 'GUARDIA' | 'PLANTA'>('');
  const [fPct, setFPct] = useState(''); // '' = todos, 'revisar' o el % exacto
  const [buscar, setBuscar] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<any>(`/plus-licencias/no-cobran?fuente=${fuente}&anio=${anio}${mes ? `&mes=${mes}` : ''}`);
      if (!r?.ok) throw new Error(r?.error || 'Error');
      setData(r);
      setAbierto(new Set());
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo calcular');
    } finally {
      setLoading(false);
    }
  }, [fuente, anio, mes, toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const crudas = data?.filas ?? [];
  const profesiones = useMemo(() => [...new Set(crudas.map((f) => f.profesion || 'Sin profesión'))].sort((a, b) => a.localeCompare(b, 'es')), [crudas]);
  const porcentajes = useMemo(() => [...new Set(crudas.filter((f) => f.pct !== null).map((f) => f.pct as number))].sort((a, b) => a - b), [crudas]);
  // Filtros de profesión / plus / % / texto: se aplican antes que "Mostrar" y también a los contadores
  const q = buscar.trim().toUpperCase();
  const todas = crudas.filter((f) =>
    (!fProfesion || (f.profesion || 'Sin profesión') === fProfesion)
    && (!fPlus || f.tipo === fPlus)
    && (!fPct || (fPct === 'revisar' ? f.pct === null : f.pct === Number(fPct)))
    && (!q || f.nombre.toUpperCase().includes(q) || String(f.dni).includes(q)));
  const filas = todas.filter((f) => estados.has(estadoDe(f)));
  const cuenta = (pred: (f: FilaNoCobra) => boolean, lista = todas) => lista.filter(pred).length;
  const noCobra = (f: FilaNoCobra) => estadoDe(f) === 'nocobra';
  const reducido = (f: FilaNoCobra) => estadoDe(f) === 'reducido';
  const revisar = (f: FilaNoCobra) => estadoDe(f) === 'revisar';
  const completo = (f: FilaNoCobra) => estadoDe(f) === 'completo';

  // Resumen por mes cuando se pide el año entero
  const porMes = useMemo(() => {
    const m = new Map<string, FilaNoCobra[]>();
    for (const f of todas) {
      if (!m.has(f.mes)) m.set(f.mes, []);
      m.get(f.mes)!.push(f);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [todas]);

  // Vista por licencia: mes → licencia → agentes (de los filtrados por estado)
  const porLicencia = useMemo(() => {
    const m = new Map<string, Map<string, { novedad: string; clase: Clase; agentes: { f: FilaNoCobra; cantidad: number }[] }>>();
    for (const f of filas) {
      if (!m.has(f.mes)) m.set(f.mes, new Map());
      const lm = m.get(f.mes)!;
      for (const l of f.licencias) {
        if (!lm.has(l.codigo)) lm.set(l.codigo, { novedad: l.novedad, clase: l.clase, agentes: [] });
        lm.get(l.codigo)!.agentes.push({ f, cantidad: l.cantidad });
      }
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mesK, lm]) => ({
      mes: mesK,
      licencias: [...lm.entries()]
        .map(([codigo, v]) => ({ codigo, ...v }))
        .sort((a, b) => b.agentes.length - a.agentes.length || a.codigo.localeCompare(b.codigo)),
    }));
  }, [filas]);

  const periodo = mes ? nombreMes(`${anio}-${String(mes).padStart(2, '0')}`) : `año ${anio}`;
  const fueraDeCobertura = !!(data?.cubre_desde && mes && `${anio}-${String(mes).padStart(2, '0')}` < data.cubre_desde.slice(0, 7));

  const exportar = () => {
    const rows = filas.map((f) => ({
      Mes: nombreMes(f.mes), DNI: f.dni, Agente: f.nombre, Profesión: f.profesion ?? '', Plus: f.tipo, 'Cobra %': f.pct ?? 'revisar',
      Motivos: f.motivos.join('; '),
      Licencias: f.licencias.map((l) => `${l.codigo} (${l.cantidad}) ${CLASE_INFO[l.clase].label}`).join(' | '),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mes ? `${anio}-${String(mes).padStart(2, '0')}` : String(anio));
    const porLic = porLicencia.flatMap((g) => g.licencias.flatMap((l) => l.agentes.map(({ f, cantidad }) => ({
      Mes: nombreMes(g.mes), Licencia: l.novedad, 'Cuenta como': CLASE_INFO[l.clase].label,
      DNI: f.dni, Agente: f.nombre, Profesión: f.profesion ?? '', Plus: f.tipo, [f.tipo === 'GUARDIA' ? 'Guardias' : 'Días']: cantidad, 'Cobra %': f.pct ?? 'revisar',
    }))));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porLic), 'Por licencia');
    if (!mes) {
      const resumen = porMes.map(([m, l]) => ({
        Mes: nombreMes(m), 'No cobran': cuenta(noCobra, l), Reducido: cuenta(reducido, l), Revisar: cuenta(revisar, l),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen por mes');
    }
    const sufijo = mes ? `${anio}-${String(mes).padStart(2, '0')}` : String(anio);
    saveAs(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })]), `plus_no_cobran_${fuente}_${sufijo}.xlsx`);
  };

  const color = (p: number | null) => p === null ? 'rgba(249,115,22,0.25)' : p === 0 ? 'rgba(239,68,68,0.25)' : p < 100 ? 'rgba(234,179,8,0.25)' : 'rgba(34,197,94,0.2)';
  const anioActual = new Date().getFullYear();

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Año{' '}
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={sel}>
            {[anioActual - 1, anioActual].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Mes{' '}
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={sel}>
            <option value={0}>Todo el año</option>
            {MESES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
        </label>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>Mostrar
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={estados.size === 4}
              onChange={() => setEstados(estados.size === 4 ? new Set(['nocobra']) : new Set(['nocobra', 'reducido', 'revisar', 'completo']))} /> Todos
          </label>
          {([['nocobra', 'No cobran'], ['reducido', 'Reducido'], ['revisar', 'Revisar'], ['completo', 'Cobra 100%']] as const).map(([k, l]) => (
            <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={estados.has(k)} onChange={() => toggleEstado(k)} /> {l}
            </label>
          ))}
        </span>
        <label>Vista{' '}
          <select value={vista} onChange={(e) => setVista(e.target.value as any)} style={sel}>
            <option value="agente">Por agente</option>
            <option value="licencia">Por licencia</option>
          </select>
        </label>
        <label>Profesión{' '}
          <select value={fProfesion} onChange={(e) => setFProfesion(e.target.value)} style={sel}>
            <option value="">Todas</option>
            {profesiones.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>Plus{' '}
          <select value={fPlus} onChange={(e) => setFPlus(e.target.value as any)} style={sel}>
            <option value="">Todos</option>
            <option value="GUARDIA">Guardia</option>
            <option value="PLANTA">Planta</option>
          </select>
        </label>
        <label>Cobra{' '}
          <select value={fPct} onChange={(e) => setFPct(e.target.value)} style={sel}>
            <option value="">Todos</option>
            {porcentajes.map((p) => <option key={p} value={String(p)}>{p}%</option>)}
            <option value="revisar">Revisar</option>
          </select>
        </label>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar agente o DNI" style={{ ...sel, width: 160 }} />
        <button type="button" className="btn" onClick={exportar} disabled={!filas.length}>⬇️ Excel</button>
        {data && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['nocobra', 'No cobran', color(0), noCobra], ['reducido', 'Reducido', color(50), reducido],
              ['revisar', 'Revisar', color(null), revisar], ['completo', 'Cobra 100%', color(100), completo]] as const).map(([k, l, bg, pred]) => (
              <span key={k} className="badge" title="Click para mostrar/ocultar" onClick={() => toggleEstado(k)}
                style={{ background: bg, cursor: 'pointer', opacity: estados.has(k) ? 1 : 0.4 }}>{l}: {cuenta(pred)}</span>
            ))}
            <span className="badge">Agentes 10471: {data.total_agentes}</span>
          </div>
        )}
      </div>

      {data && (
        <div style={{ marginTop: 8, fontSize: '0.78rem' }} className="muted">
          <b>Fuente:</b>{' '}
          {data.archivos.map((a) => (
            <span key={a.archivo} style={{ marginRight: 12 }}>
              {a.archivo}: {a.error ? <b style={{ color: '#f87171' }}>{a.error}</b> : `${a.filas} novedades, ${a.desde ?? '—'} → ${a.hasta ?? '—'}`}
            </span>
          ))}
        </div>
      )}
      {fueraDeCobertura && (
        <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'rgba(239,68,68,0.15)', fontSize: '0.8rem' }}>
          {fuente === 'archivo'
            ? `El archivo del Ministerio empieza el ${data?.cubre_desde}: para ${periodo} usá la pestaña "Quién no cobra (anual)".`
            : `La descarga anual empieza el ${data?.cubre_desde}: no hay novedades para ${periodo}.`}
        </div>
      )}
      <div className="muted" style={{ fontSize: '0.76rem', marginTop: 8 }}>
        En guardia solo cuentan las licencias que caen en el día de guardia del agente (HORARIO_GUARDIA.xlsx).
        Guardia: 1 causal de descuento → 50%, 2 o más → no cobra. Planta: 1 inasistencia se tolera si no hubo otra licencia; si no, no cobra.
        La mezcla de dos o más licencias distintas cuenta como causal.
        {data?.aviso_horario && <b style={{ color: '#f87171' }}> {data.aviso_horario}</b>}
      </div>

      {!mes && !loading && porMes.length > 0 && (
        <table style={{ borderCollapse: 'collapse', marginTop: 10, minWidth: 420 }}>
          <thead><tr><th style={th}>Mes</th><th style={{ ...th, textAlign: 'right' }}>No cobran</th><th style={{ ...th, textAlign: 'right' }}>Reducido</th><th style={{ ...th, textAlign: 'right' }}>Revisar</th></tr></thead>
          <tbody>
            {porMes.map(([m, l]) => (
              <tr key={m}>
                <td style={td}>
                  {nombreMes(m)}
                  {data?.cubre_desde && m < data.cubre_desde.slice(0, 7) && (
                    <span className="muted" style={{ fontSize: '0.72rem' }}> · {fuente === 'archivo' ? 'el archivo no cubre este mes: ver anual' : 'sin datos'}</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{cuenta(noCobra, l)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{cuenta(reducido, l)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{cuenta(revisar, l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && vista === 'licencia' && (
        <div style={{ marginTop: 10 }}>
          {porLicencia.map((g) => (
            <div key={g.mes} style={{ marginTop: 12 }}>
              <div className="h2" style={{ margin: '0 0 6px', fontSize: '1rem' }}>{nombreMes(g.mes)}</div>
              {g.licencias.map((l) => (
                <div key={l.codigo} style={{ marginBottom: 10, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', background: 'rgba(255,255,255,0.03)' }}>
                    <Chip c={l.clase} /> <b>{l.novedad}</b>
                    <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.78rem' }}>{l.agentes.length} agente(s)</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {l.agentes.map(({ f, cantidad }) => (
                        <tr key={f.dni}>
                          <td style={{ ...td, fontWeight: 600, width: '26%' }}>{f.nombre}</td>
                          <td style={{ ...td, width: '10%' }}>{f.dni}</td>
                          <td style={{ ...td, width: '12%', fontSize: '0.78rem' }}>{f.profesion || '—'}</td>
                          <td style={{ ...td, width: '10%' }}>{f.tipo === 'GUARDIA' ? 'Guardia' : 'Planta'}</td>
                          <td style={{ ...td, width: '12%' }}>{cantidad} {f.tipo === 'GUARDIA' ? 'guardia(s)' : 'día(s)'}</td>
                          <td style={{ ...td, width: '10%', textAlign: 'right' }}><span className="badge" style={{ background: color(f.pct) }}>{f.pct === null ? 'revisar' : `${f.pct}%`}</span></td>
                          <td style={{ ...td, fontSize: '0.76rem' }} className="muted">{f.motivos.join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
          {!porLicencia.length && <div className="muted" style={{ textAlign: 'center', padding: 12 }}>Nadie pierde el plus en {periodo}.</div>}
        </div>
      )}

      {loading ? <div className="muted" style={{ marginTop: 12 }}>Calculando…</div> : vista === 'agente' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <thead><tr>
            {!mes && <th style={th}>Mes</th>}
            <th style={th}>Agente</th><th style={th}>DNI</th><th style={th}>Profesión</th><th style={th}>Plus</th><th style={{ ...th, textAlign: 'right' }}>Cobra</th><th style={th}>Motivo</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {filas.map((f) => {
              const key = `${f.mes}-${f.dni}`;
              const open = abierto.has(key);
              return (
                <React.Fragment key={key}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setAbierto((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; })}>
                    {!mes && <td style={{ ...td, whiteSpace: 'nowrap' }}>{nombreMes(f.mes)}</td>}
                    <td style={{ ...td, fontWeight: 600 }}>{f.nombre}</td>
                    <td style={td}>{f.dni}</td>
                    <td style={{ ...td, fontSize: '0.8rem' }}>{f.profesion || '—'}</td>
                    <td style={td}>{f.tipo === 'GUARDIA' ? 'Guardia' : 'Planta'}</td>
                    <td style={{ ...td, textAlign: 'right' }}><span className="badge" style={{ background: color(f.pct) }}>{f.pct === null ? 'revisar' : `${f.pct}%`}</span></td>
                    <td style={{ ...td, fontSize: '0.78rem' }}>{f.motivos.join(' · ') || '—'}</td>
                    <td style={td}>{open ? '▲' : '▼'}</td>
                  </tr>
                  {open && (
                    <tr><td colSpan={mes ? 7 : 8} style={{ ...td, background: 'rgba(255,255,255,0.02)' }}>
                      {f.licencias.map((l) => (
                        <div key={l.codigo} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: '0.8rem' }}>
                          <Chip c={l.clase} /> <b>{l.novedad}</b>
                          <span className="muted">{l.cantidad} {f.tipo === 'GUARDIA' ? 'guardia(s)' : 'día(s)'}: {l.fechas.map((x) => x.slice(8, 10) + '/' + x.slice(5, 7)).join(', ')}</span>
                        </div>
                      ))}
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
            {!filas.length && <tr><td colSpan={mes ? 7 : 8} style={{ ...td, textAlign: 'center' }} className="muted">Nadie pierde el plus en {periodo}.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function LicenciasPlusPage() {
  const { hasPerm } = useAuth();
  const puedeEditar = hasPerm('crud:*:*');
  const [tab, setTab] = useState<'archivo' | 'anual' | 'licencias'>('archivo');
  return (
    <Layout title="Licencias y Plus" showBack>
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div className="h2" style={{ margin: 0 }}>⚖️ Licencias y Plus de Guardia / Planta (Ley 10.471)</div>
        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
          Qué licencia descuenta según la norma y quién no cobra el plus. Detalle de los decretos en <Link to="/app/normativa" style={{ color: '#93c5fd' }}>Normativa</Link>.
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 12, borderBottom: '1px solid rgba(255,255,255,0.1)', flexWrap: 'wrap' }}>
          {([
            ['archivo', '🚫 Quién no cobra (Ministerio)'],
            ['anual', '📅 Quién no cobra (anual)'],
            ['licencias', '📋 Tabla de licencias'],
          ] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '10px 18px', fontSize: '0.9rem',
              fontWeight: tab === k ? 700 : 400, color: tab === k ? '#e2e8f0' : '#64748b',
              borderBottom: tab === k ? '2px solid #7c3aed' : '2px solid transparent',
            }}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'archivo' && <TabNoCobran key="archivo" fuente="archivo" />}
      {tab === 'anual' && <TabNoCobran key="anual" fuente="anual" />}
      {tab === 'licencias' && <TabLicencias puedeEditar={puedeEditar} />}
    </Layout>
  );
}

export default LicenciasPlusPage;

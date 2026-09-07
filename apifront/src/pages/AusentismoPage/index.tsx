// src/pages/AusentismoPage/index.tsx
// Nivel de ausentismo por dependencia / servicio / sector, abierto por régimen
// horario (Guardia = turno de más de 12 hs · Planta = 12 hs o menos).
//
// Ausencia NO PROGRAMADA: enfermedad, familiar enfermo, ausente sin aviso.
// Ausencia PROGRAMADA:    el resto de las licencias.
// Presentismo (llegó tarde, boleta de salida, error de sistema) va aparte y no
// suma al ausentismo.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import XLSXStyle from 'xlsx-js-style';
import { saveAs } from 'file-saver';
import { BarrasRegimen, BarrasUnidades, COLORES, Dona } from './Charts';

// ─── TIPOS ───────────────────────────────────────────────────────────────────
type Nivel = 'dependencia' | 'servicio' | 'sector';
type Regimen = 'GUARDIA' | 'PLANTA';

interface PorRegimen {
  agentes: number; turnosProg: number; turnosNoProg: number; turnosProgramada: number;
  horasProg: number; horasNoProg: number; pctNoProgramada: number; pctProgramada: number;
}
interface Grupo {
  clave: string; dependencia: string; servicio: string; sector: string;
  agentes: number; guardia: number; planta: number; conAusencia: number;
  turnosProg: number; horasProg: number;
  turnosNoProg: number; horasNoProg: number;
  turnosProgramada: number; horasProgramada: number; turnosPresentismo: number;
  pctNoProgramada: number; pctProgramada: number; pctTotal: number;
  porRegimen: Record<Regimen, PorRegimen>;
}
interface Agente {
  dni: string; nombre: string; agrupamiento: string; ocupacion: string | null;
  dependencia: string; servicio: string; sector: string;
  regimen: Regimen; horario: string; horasSemana: number;
  turnosProg: number; horasProg: number;
  turnosNoProg: number; horasNoProg: number;
  turnosProgramada: number; horasProgramada: number; turnosPresentismo: number;
  eventosNoProg: number; eventosProgramada: number;
  pctNoProgramada: number; pctProgramada: number; pctTotal: number;
}
interface Resultado {
  desde: string; hasta: string; nivel: Nivel;
  grupos: Grupo[]; agentes: Agente[];
  totales: Omit<Grupo, 'clave' | 'dependencia' | 'servicio' | 'sector'>;
  porNovedad: { novedad: string; categoria: string; turnos: number; eventos: number }[];
  advertencias: string[];
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt = (n: number) => (n ?? 0).toLocaleString('es-AR');
const pct = (n: number) => `${(n ?? 0).toFixed(2).replace('.', ',')}%`;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const nombreGrupo = (g: Grupo, nivel: Nivel) =>
  nivel === 'dependencia' ? g.dependencia
    : nivel === 'servicio' ? g.servicio
      : g.sector;

// niveles que permiten abrir el nivel siguiente con un clic
const permiteDrill = (nivel: Nivel) => nivel === 'dependencia' || nivel === 'servicio';

const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.74rem', color: '#94a3b8', fontWeight: 600 };
const th: React.CSSProperties = {
  textAlign: 'right', padding: '7px 8px', fontSize: '0.72rem',
  color: '#94a3b8', fontWeight: 700, whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: '0.8rem', whiteSpace: 'nowrap' };

function Kpi({ titulo, valor, detalle, color }: {
  titulo: string; valor: string; detalle?: string; color?: string;
}) {
  return (
    <div className="card" style={{ padding: '12px 16px', flex: '1 1 165px', minWidth: 165 }}>
      <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, letterSpacing: 0.3 }}>
        {titulo}
      </div>
      <div style={{ fontSize: '1.55rem', fontWeight: 800, color: color || '#e2e8f0', lineHeight: 1.25 }}>
        {valor}
      </div>
      {detalle && <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{detalle}</div>}
    </div>
  );
}

// ─── PÁGINA ──────────────────────────────────────────────────────────────────
export function AusentismoPage() {
  const toast = useToast();

  const hoy = new Date();
  const [modo, setModo] = useState<'anio' | 'meses'>('anio');
  const [anios, setAnios] = useState<number[]>([]);
  const [estructura, setEstructura] = useState<{ dependencia: string; servicios: { nombre: string; agentes: number }[] }[]>([]);
  const [ocupaciones, setOcupaciones] = useState<{ clave: string; nombre: string; agentes: number }[]>([]);
  const [ocupacion, setOcupacion] = useState<string>('');
  const [anio, setAnio] = useState<string>(String(hoy.getFullYear() - 1));
  const [mesDesde, setMesDesde] = useState<string>(`${hoy.getFullYear() - 1}-01`);
  const [mesHasta, setMesHasta] = useState<string>(`${hoy.getFullYear() - 1}-12`);

  const [nivel, setNivel] = useState<Nivel>('servicio');
  const [regimen, setRegimen] = useState<Regimen | 'TODOS'>('TODOS');
  const [dependencia, setDependencia] = useState<string>('');
  const [servicio, setServicio] = useState<string>('');

  const [data, setData] = useState<Resultado | null>(null);
  const [loading, setLoading] = useState(false);
  const [verAgentes, setVerAgentes] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] = useState<any | null>(null);
  const [orden, setOrden] = useState<'noProg' | 'prog' | 'agentes' | 'nombre'>('noProg');

  useEffect(() => {
    apiFetch<{ anios: number[] }>('/ausentismo/periodos')
      .then(r => {
        setAnios(r.anios || []);
        if (r.anios?.length && !r.anios.includes(Number(anio))) {
          setAnio(String(r.anios[0]));
          setMesDesde(`${r.anios[0]}-01`);
          setMesHasta(`${r.anios[0]}-12`);
        }
      })
      .catch(() => { /* el selector queda con el año por defecto */ });

    apiFetch<{
      dependencias: { dependencia: string; servicios: { nombre: string; agentes: number }[] }[];
      ocupaciones: { clave: string; nombre: string; agentes: number }[];
    }>('/ausentismo/estructura')
      .then(r => { setEstructura(r.dependencias || []); setOcupaciones(r.ocupaciones || []); })
      .catch(() => { /* sin combos: queda el drill-down por clic */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargar = useCallback(async (over?: {
    dependencia?: string; servicio?: string; ocupacion?: string;
    nivel?: Nivel; regimen?: Regimen | 'TODOS';
  }) => {
    const desde = modo === 'anio' ? anio : mesDesde;
    const hasta = modo === 'anio' ? anio : mesHasta;
    if (modo === 'meses' && mesDesde > mesHasta) {
      toast.error('El mes "desde" es posterior al mes "hasta"');
      return;
    }
    const nv = over?.nivel ?? nivel;
    const dep = over?.dependencia ?? dependencia;
    const srv = over?.servicio ?? servicio;
    const ocu = over?.ocupacion ?? ocupacion;

    setLoading(true);
    try {
      const qs = new URLSearchParams({ desde, hasta, nivel: nv, regimen: over?.regimen ?? regimen });
      if (dep) qs.set('dependencia', dep);
      if (srv) qs.set('servicio', srv);
      if (ocu) qs.set('ocupacion', ocu);
      const r = await apiFetch<Resultado>(`/ausentismo/resumen?${qs}`);
      setData(r);
      if (!r.grupos.length) toast.warning('No hay datos para ese período');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo calcular el ausentismo');
    } finally {
      setLoading(false);
    }
  }, [modo, anio, mesDesde, mesHasta, nivel, regimen, dependencia, servicio, ocupacion, toast]);

  // ── filtros de estructura (recalculan al cambiar) ──
  const serviciosDisponibles = useMemo(() => {
    if (dependencia) {
      return estructura.find(d => d.dependencia === dependencia)?.servicios ?? [];
    }
    const vistos = new Map<string, number>();
    for (const d of estructura) {
      for (const sv of d.servicios) vistos.set(sv.nombre, (vistos.get(sv.nombre) || 0) + sv.agentes);
    }
    return [...vistos.entries()]
      .map(([nombre, agentes]) => ({ nombre, agentes }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [estructura, dependencia]);

  const cambiarDependencia = (dep: string) => {
    setDependencia(dep);
    setServicio('');
    const nv: Nivel = dep ? 'servicio' : 'dependencia';
    setNivel(nv);
    cargar({ dependencia: dep, servicio: '', nivel: nv });
  };

  const cambiarOcupacion = (ocu: string) => {
    setOcupacion(ocu);
    cargar({ ocupacion: ocu });
  };

  const cambiarServicio = (srv: string) => {
    setServicio(srv);
    // no fuerzo el nivel a "sector": el sector está cargado en pocos agentes y
    // la vista quedaría casi toda en "Sin asignar". Sólo subo de dependencia
    // a servicio para que la fila elegida se vea.
    const nv: Nivel = srv && nivel === 'dependencia' ? 'servicio' : nivel;
    setNivel(nv);
    cargar({ servicio: srv, nivel: nv });
  };

  // ── drill-down ──
  const bajarNivel = (clave: string) => {
    if (!data) return;
    const g = data.grupos.find(x => x.clave === clave);
    if (!g) return;
    if (data.nivel === 'dependencia') {
      setDependencia(g.dependencia); setNivel('servicio');
      cargar({ dependencia: g.dependencia, nivel: 'servicio' });
    } else if (data.nivel === 'servicio') {
      setDependencia(g.dependencia); setServicio(g.servicio); setNivel('sector');
      cargar({ dependencia: g.dependencia, servicio: g.servicio, nivel: 'sector' });
    }
  };
  const volver = () => {
    if (servicio) {
      setServicio(''); setNivel('servicio');
      cargar({ servicio: '', nivel: 'servicio' });
    } else if (dependencia) {
      setDependencia(''); setNivel('dependencia');
      cargar({ dependencia: '', nivel: 'dependencia' });
    }
  };

  const gruposOrdenados = useMemo(() => {
    if (!data) return [];
    const gs = [...data.grupos];
    if (orden === 'noProg') gs.sort((a, b) => b.pctNoProgramada - a.pctNoProgramada);
    else if (orden === 'prog') gs.sort((a, b) => b.pctProgramada - a.pctProgramada);
    else if (orden === 'agentes') gs.sort((a, b) => b.agentes - a.agentes);
    else gs.sort((a, b) => nombreGrupo(a, data.nivel).localeCompare(nombreGrupo(b, data.nivel)));
    return gs;
  }, [data, orden]);

  const etiquetaPeriodo = data
    ? (modo === 'anio' ? `Año ${anio}` : `${MESES[Number(mesDesde.slice(5)) - 1]} ${mesDesde.slice(0, 4)} → ${MESES[Number(mesHasta.slice(5)) - 1]} ${mesHasta.slice(0, 4)}`)
    : '';

  // ── importar el export del SIAPE a la tabla historial ──
  const importar = async (modo: 'agregar' | 'reemplazar') => {
    const texto = modo === 'reemplazar'
      ? 'Va a BORRAR de la tabla historial las novedades del rango que cubren los archivos y cargarlas de nuevo desde los Excel.\n\nLo que los archivos no cubren no se toca.\n\n¿Seguir?'
      : 'Va a agregar a la tabla historial las novedades nuevas de los Excel. No borra nada.\n\n¿Seguir?';
    if (!window.confirm(texto)) return;
    setImportando(true);
    setResultadoImport(null);
    try {
      const r = await apiFetch<any>(`/ausentismo/importar-historial?modo=${modo}`, { method: 'POST' });
      setResultadoImport(r);
      toast.ok(`Importación lista: ${r.totales?.insertadas ?? 0} novedades nuevas`);
      if (data) cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo importar el historial');
    } finally {
      setImportando(false);
    }
  };

  // ── Excel ──
  const exportar = () => {
    if (!data) return;
    const wb = XLSXStyle.utils.book_new();
    const HDR = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '334155' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };
    const hoja = (aoa: any[][], nombre: string, anchos: number[]) => {
      const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
      ws['!cols'] = anchos.map(w => ({ wch: w }));
      for (let c = 0; c < aoa[0].length; c++) {
        const ref = XLSXStyle.utils.encode_cell({ r: 0, c });
        if (ws[ref]) ws[ref].s = HDR;
      }
      XLSXStyle.utils.book_append_sheet(wb, ws, nombre);
    };

    const nivelTit = data.nivel.charAt(0).toUpperCase() + data.nivel.slice(1);
    hoja([
      [nivelTit, 'Dependencia', 'Agentes', 'Guardia', 'Planta', 'Turnos programados',
        'Turnos no programada', 'Turnos programada', 'Presentismo',
        '% No programada', '% Programada', '% Total',
        '% No prog. GUARDIA', '% No prog. PLANTA',
        'Horas programadas', 'Horas perdidas no prog.'],
      ...gruposOrdenados.map(g => [
        nombreGrupo(g, data.nivel), g.dependencia, g.agentes, g.guardia, g.planta,
        g.turnosProg, g.turnosNoProg, g.turnosProgramada, g.turnosPresentismo,
        g.pctNoProgramada, g.pctProgramada, g.pctTotal,
        g.porRegimen.GUARDIA.pctNoProgramada, g.porRegimen.PLANTA.pctNoProgramada,
        g.horasProg, g.horasNoProg,
      ]),
    ], 'Resumen', [40, 30, 9, 9, 9, 18, 20, 18, 12, 15, 14, 10, 18, 18, 17, 20]);

    hoja([
      ['DNI', 'Nombre', 'Ocupación', 'Agrupamiento', 'Dependencia', 'Servicio', 'Sector',
        'Régimen', 'Horario', 'Horas/semana', 'Turnos programados',
        'Turnos no programada', 'Turnos programada', 'Presentismo',
        'Eventos no prog.', 'Eventos prog.', '% No programada', '% Programada', '% Total'],
      ...data.agentes
        .slice()
        .sort((a, b) => b.pctNoProgramada - a.pctNoProgramada)
        .map(a => [
          a.dni, a.nombre, a.ocupacion || '', a.agrupamiento, a.dependencia, a.servicio, a.sector,
          a.regimen, a.horario, a.horasSemana, a.turnosProg,
          a.turnosNoProg, a.turnosProgramada, a.turnosPresentismo,
          a.eventosNoProg, a.eventosProgramada, a.pctNoProgramada, a.pctProgramada, a.pctTotal,
        ]),
    ], 'Detalle por agente', [11, 32, 26, 16, 28, 32, 24, 10, 44, 12, 18, 20, 18, 12, 15, 14, 15, 14, 10]);

    hoja([
      ['Novedad', 'Categoría', 'Turnos afectados', 'Eventos'],
      ...data.porNovedad.map(n => [n.novedad, n.categoria, n.turnos, n.eventos]),
    ], 'Novedades', [48, 16, 17, 10]);

    hoja([
      ['Criterios del cálculo'],
      ['Período', `${data.desde} a ${data.hasta}`],
      ['Régimen', 'GUARDIA = algún turno de más de 12 hs · PLANTA = 12 hs o menos'],
      ['Ausencia no programada', 'Enfermedad, familiar enfermo, ausente sin aviso'],
      ['Ausencia programada', 'El resto de las licencias'],
      ['Presentismo (aparte)', 'Llegó tarde, boleta de salida, error de sistema — no suma al ausentismo'],
      ['Ignorado', 'Presente y franco compensatorio'],
      ['Denominador', 'Turnos programados según el Excel de horarios'],
      ['Dependencia', dependencia || 'Todas'],
      ['Servicio', servicio || 'Todos'],
      ['Ocupación', ocupacion ? (ocupaciones.find(o => o.clave === ocupacion)?.nombre ?? ocupacion) : 'Todas'],
      ['Régimen', regimen === 'TODOS' ? 'Todos' : regimen],
      [''],
      ['Advertencias'],
      ...data.advertencias.map(a => [a]),
    ], 'Criterios', [26, 90]);

    const out = XLSXStyle.write(wb, { type: 'array', bookType: 'xlsx' });
    const suf = modo === 'anio' ? anio : `${mesDesde}_${mesHasta}`;
    saveAs(new Blob([out], { type: 'application/octet-stream' }), `ausentismo-${data.nivel}-${suf}.xlsx`);
  };

  const t = data?.totales;
  const turnosCubiertos = t
    ? Math.max(0, t.turnosProg - t.turnosNoProg - t.turnosProgramada - t.turnosPresentismo)
    : 0;

  return (
    <Layout title="Nivel de ausentismo">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>📉 Nivel de ausentismo</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Por dependencia, servicio y sector, abierto por régimen horario.
          Guardia = turno de más de 12 hs · Planta = 12 hs o menos.
        </p>
      </div>

      {/* ── Filtros ── */}
      <div className="card" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div style={fg}>
            <label style={lbl} htmlFor="aus-modo">Período</label>
            <select id="aus-modo" className="input" value={modo} onChange={e => setModo(e.target.value as any)}>
              <option value="anio">Año completo</option>
              <option value="meses">Rango de meses</option>
            </select>
          </div>

          {modo === 'anio' ? (
            <div style={fg}>
              <label style={lbl} htmlFor="aus-anio">Año</label>
              <select id="aus-anio" className="input" value={anio} onChange={e => setAnio(e.target.value)}>
                {(anios.length ? anios : [hoy.getFullYear() - 1]).map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div style={fg}>
                <label style={lbl} htmlFor="aus-desde">Desde</label>
                <input id="aus-desde" className="input" type="month" value={mesDesde}
                  onChange={e => setMesDesde(e.target.value)} />
              </div>
              <div style={fg}>
                <label style={lbl} htmlFor="aus-hasta">Hasta</label>
                <input id="aus-hasta" className="input" type="month" value={mesHasta}
                  onChange={e => setMesHasta(e.target.value)} />
              </div>
            </>
          )}

          <div style={fg}>
            <label style={lbl} htmlFor="aus-dep">Dependencia</label>
            <select
              id="aus-dep" className="input" value={dependencia}
              onChange={e => cambiarDependencia(e.target.value)}
              style={{ maxWidth: 250 }}
            >
              <option value="">Todas</option>
              {estructura.map(d => (
                <option key={d.dependencia} value={d.dependencia}>{d.dependencia}</option>
              ))}
            </select>
          </div>

          <div style={fg}>
            <label style={lbl} htmlFor="aus-srv">Servicio</label>
            <select
              id="aus-srv" className="input" value={servicio}
              onChange={e => cambiarServicio(e.target.value)}
              style={{ maxWidth: 280 }}
            >
              <option value="">Todos</option>
              {serviciosDisponibles.map(sv => (
                <option key={sv.nombre} value={sv.nombre}>
                  {sv.nombre} ({sv.agentes})
                </option>
              ))}
            </select>
          </div>

          <div style={fg}>
            <label style={lbl} htmlFor="aus-ocup">Ocupación</label>
            <select
              id="aus-ocup" className="input" value={ocupacion}
              onChange={e => cambiarOcupacion(e.target.value)}
              style={{ maxWidth: 260 }}
            >
              <option value="">Todas</option>
              {ocupaciones.map(o => (
                <option key={o.clave} value={o.clave}>{o.nombre} ({o.agentes})</option>
              ))}
            </select>
          </div>

          <div style={fg}>
            <label style={lbl} htmlFor="aus-nivel">Agrupar por</label>
            <select
              id="aus-nivel" className="input" value={nivel}
              onChange={e => {
                const nv = e.target.value as Nivel;
                setNivel(nv);
                if (data) cargar({ nivel: nv });
              }}
            >
              <option value="dependencia">Dependencia</option>
              <option value="servicio">Servicio</option>
              <option value="sector">Sector</option>
            </select>
          </div>

          <div style={fg}>
            <label style={lbl} htmlFor="aus-regimen">Régimen</label>
            <select
              id="aus-regimen" className="input" value={regimen}
              onChange={e => {
                const rg = e.target.value as Regimen | 'TODOS';
                setRegimen(rg);
                if (data) cargar({ regimen: rg });
              }}
            >
              <option value="TODOS">Todos</option>
              <option value="GUARDIA">Sólo guardia (+12 hs)</option>
              <option value="PLANTA">Sólo planta (hasta 12 hs)</option>
            </select>
          </div>

          <button className="btn" type="button" onClick={() => cargar()} disabled={loading}>
            {loading ? 'Calculando…' : '▶ Calcular'}
          </button>
          {data && (
            <button
              className="btn" type="button" onClick={exportar}
              style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
            >
              ⬇ Descargar Excel
            </button>
          )}
          <button
            className="btn" type="button" disabled={importando}
            onClick={() => importar('agregar')}
            title="Agrega a la tabla historial las novedades nuevas de los historialsiape*.xlsx de la carpeta. No borra nada."
            style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
          >
            {importando ? 'Importando…' : '⟳ Actualizar novedades'}
          </button>
          <button
            className="btn" type="button" disabled={importando}
            onClick={() => importar('reemplazar')}
            title="Borra de la tabla el rango que cubren los Excel y lo vuelve a cargar. Lo que los archivos no cubren queda intacto."
            style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
          >
            ⟳ Recargar (reemplaza)
          </button>
        </div>

        {(dependencia || servicio || ocupacion) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {(dependencia || servicio) && (
              <button className="btn" type="button" onClick={volver} style={{ fontSize: '0.78rem', padding: '4px 10px' }}>
                ← Volver
              </button>
            )}
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {dependencia}{servicio ? ` › ${servicio}` : ''}
            </span>
            {ocupacion && (
              <span style={{
                background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                borderRadius: 6, padding: '2px 8px', fontSize: '0.78rem',
              }}>
                Ocupación: {ocupaciones.find(o => o.clave === ocupacion)?.nombre ?? ocupacion}
                {' '}
                <button
                  type="button" onClick={() => cambiarOcupacion('')}
                  title="Quitar el filtro de ocupación"
                  style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', padding: 0 }}
                >✕</button>
              </span>
            )}
          </div>
        )}
      </div>

      {resultadoImport && (
        <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#818cf8', marginBottom: 8 }}>
            RESULTADO DE LA IMPORTACIÓN ({resultadoImport.modo})
          </div>
          <div style={{ fontSize: '0.82rem', marginBottom: 8 }}>
            {fmt(resultadoImport.totales?.insertadas ?? 0)} novedades nuevas ·{' '}
            {fmt(resultadoImport.totales?.duplicadas ?? 0)} ya estaban ·{' '}
            {fmt(resultadoImport.borradas ?? 0)} borradas ·{' '}
            {fmt(resultadoImport.totales?.sinFk ?? 0)} sin DNI en el sistema
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORES.grid}` }}>
                  <th style={{ ...th, textAlign: 'left' }}>Archivo</th>
                  <th style={th}>Filas</th>
                  <th style={th}>Nuevas</th>
                  <th style={th}>Ya estaban</th>
                  <th style={th}>Sin DNI</th>
                  <th style={{ ...th, textAlign: 'left' }}>Rango</th>
                </tr>
              </thead>
              <tbody>
                {(resultadoImport.archivos || []).map((a: any) => (
                  <tr key={a.archivo} style={{ borderBottom: `1px solid ${COLORES.grid}` }}>
                    <td style={{ ...td, textAlign: 'left' }}>{a.archivo}</td>
                    <td style={td}>{fmt(a.filas)}</td>
                    <td style={{ ...td, color: '#10b981' }}>{fmt(a.insertadas)}</td>
                    <td style={td}>{fmt(a.duplicadas)}</td>
                    <td style={td}>{fmt(a.sinFk)}</td>
                    <td style={{ ...td, textAlign: 'left', color: '#94a3b8' }}>
                      {a.error ? <span style={{ color: '#f87171' }}>{a.error}</span> : `${a.desde ?? '—'} → ${a.hasta ?? '—'}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(resultadoImport.advertencias || []).length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.76rem', color: '#94a3b8' }}>
              {resultadoImport.advertencias.map((a: string, i: number) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </div>
      )}

      {loading && <div className="card" style={{ padding: 24, textAlign: 'center' }}>Calculando…</div>}

      {data && !loading && (
        <>
          {/* ── KPIs ── */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Kpi titulo="AUSENTISMO NO PROGRAMADO" valor={pct(t!.pctNoProgramada)}
              detalle={`${fmt(t!.turnosNoProg)} turnos perdidos`} color={COLORES.noProg} />
            <Kpi titulo="AUSENCIA PROGRAMADA" valor={pct(t!.pctProgramada)}
              detalle={`${fmt(t!.turnosProgramada)} turnos`} color={COLORES.prog} />
            <Kpi titulo="AGENTES" valor={fmt(t!.agentes)}
              detalle={`${fmt(t!.guardia)} guardia · ${fmt(t!.planta)} planta`} />
            <Kpi titulo="TURNOS PROGRAMADOS" valor={fmt(t!.turnosProg)}
              detalle={`${fmt(Math.round(t!.horasProg))} horas`} />
            <Kpi titulo="HORAS PERDIDAS" valor={fmt(Math.round(t!.horasNoProg))}
              detalle="por ausencia no programada" color={COLORES.noProg} />
            <Kpi titulo="PRESENTISMO" valor={fmt(t!.turnosPresentismo)}
              detalle="tardanzas / boletas de salida" color={COLORES.presentismo} />
          </div>

          {/* ── Gráficos ── */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div className="card" style={{ padding: 16, flex: '1 1 330px' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', marginBottom: 10 }}>
                COMPOSICIÓN DE LOS TURNOS · {etiquetaPeriodo}
              </div>
              <Dona
                titulo="Composición de los turnos"
                datos={[
                  { label: 'Cubiertos', valor: turnosCubiertos, color: COLORES.trabajado },
                  { label: 'Ausencia programada', valor: t!.turnosProgramada, color: COLORES.prog },
                  { label: 'Ausencia no programada', valor: t!.turnosNoProg, color: COLORES.noProg },
                  { label: 'Presentismo', valor: t!.turnosPresentismo, color: COLORES.presentismo },
                ]}
              />
            </div>

            <div className="card" style={{ padding: 16, flex: '1 1 330px' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', marginBottom: 10 }}>
                GUARDIA vs PLANTA · % sobre turnos programados
              </div>
              <BarrasRegimen guardia={t!.porRegimen.GUARDIA} planta={t!.porRegimen.PLANTA} />
            </div>
          </div>

          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8,
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8' }}>
                RANKING POR {data.nivel.toUpperCase()} — 🔴 no programada · 🟠 programada
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                {permiteDrill(data.nivel) ? 'Clic en una fila para abrir el nivel siguiente' : ''}
              </div>
            </div>
            <BarrasUnidades
              maxFilas={18}
              onClick={permiteDrill(data.nivel) ? bajarNivel : undefined}
              datos={gruposOrdenados.map(g => ({
                clave: g.clave, label: nombreGrupo(g, data.nivel) || '—',
                noProg: g.pctNoProgramada, prog: g.pctProgramada, agentes: g.agentes,
              }))}
            />
          </div>

          {/* ── Tabla ── */}
          <div className="card" style={{ padding: 0, marginBottom: 14, overflowX: 'auto' }}>
            <div style={{
              padding: '12px 14px', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', flexWrap: 'wrap', gap: 8,
            }}>
              <strong style={{ fontSize: '0.9rem' }}>
                Detalle por {data.nivel} ({gruposOrdenados.length})
              </strong>
              <select className="input" value={orden} onChange={e => setOrden(e.target.value as any)}
                style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}>
                <option value="noProg">Ordenar por % no programada</option>
                <option value="prog">Ordenar por % programada</option>
                <option value="agentes">Ordenar por cantidad de agentes</option>
                <option value="nombre">Ordenar por nombre</option>
              </select>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORES.grid}` }}>
                  <th style={{ ...th, textAlign: 'left' }}>
                    {data.nivel === 'dependencia' ? 'Dependencia' : data.nivel === 'servicio' ? 'Servicio' : 'Sector'}
                  </th>
                  <th style={th}>Agentes</th>
                  <th style={th}>Guardia</th>
                  <th style={th}>Planta</th>
                  <th style={th}>Turnos</th>
                  <th style={th}>No prog.</th>
                  <th style={th}>% No prog.</th>
                  <th style={th}>% Prog.</th>
                  <th style={th}>% G</th>
                  <th style={th}>% P</th>
                  <th style={th}>Hs perdidas</th>
                </tr>
              </thead>
              <tbody>
                {gruposOrdenados.map(g => (
                  <tr
                    key={g.clave}
                    onClick={permiteDrill(data.nivel) ? () => bajarNivel(g.clave) : undefined}
                    style={{
                      borderBottom: `1px solid ${COLORES.grid}`,
                      cursor: permiteDrill(data.nivel) ? 'pointer' : 'default',
                    }}
                  >
                    <td style={{ ...td, textAlign: 'left', maxWidth: 320, whiteSpace: 'normal' }}>
                      {nombreGrupo(g, data.nivel) || '—'}
                      {data.nivel === 'servicio' && (
                        <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{g.dependencia}</div>
                      )}
                    </td>
                    <td style={td}>{fmt(g.agentes)}</td>
                    <td style={{ ...td, color: COLORES.guardia }}>{fmt(g.guardia)}</td>
                    <td style={{ ...td, color: COLORES.planta }}>{fmt(g.planta)}</td>
                    <td style={td}>{fmt(g.turnosProg)}</td>
                    <td style={td}>{fmt(g.turnosNoProg)}</td>
                    <td style={{ ...td, color: COLORES.noProg, fontWeight: 700 }}>{pct(g.pctNoProgramada)}</td>
                    <td style={{ ...td, color: COLORES.prog }}>{pct(g.pctProgramada)}</td>
                    <td style={td}>{g.guardia ? pct(g.porRegimen.GUARDIA.pctNoProgramada) : '—'}</td>
                    <td style={td}>{g.planta ? pct(g.porRegimen.PLANTA.pctNoProgramada) : '—'}</td>
                    <td style={td}>{fmt(Math.round(g.horasNoProg))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Agentes ── */}
          <div className="card" style={{ padding: 0, marginBottom: 14 }}>
            <button
              className="btn" type="button" onClick={() => setVerAgentes(v => !v)}
              style={{ width: '100%', textAlign: 'left', borderRadius: 0, background: 'transparent' }}
            >
              {verAgentes ? '▾' : '▸'} Detalle por agente ({fmt(data.agentes.length)})
            </button>
            {verAgentes && (
              <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820, tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORES.grid}` }}>
                      <th style={{ ...th, textAlign: 'left' }}>Agente</th>
                      <th style={{ ...th, textAlign: 'left' }}>Servicio</th>
                      <th style={{ ...th, textAlign: 'left' }}>Horario</th>
                      <th style={th}>Régimen</th>
                      <th style={th}>Turnos</th>
                      <th style={th}>No prog.</th>
                      <th style={th}>Prog.</th>
                      <th style={th}>% No prog.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agentes
                      .slice()
                      .sort((a, b) => b.pctNoProgramada - a.pctNoProgramada)
                      .map(a => (
                        <tr key={a.dni} style={{ borderBottom: `1px solid ${COLORES.grid}` }}>
                          <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', maxWidth: 220, lineHeight: 1.35 }}>
                            {a.nombre}
                            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                              {a.dni}{a.ocupacion ? ` · ${a.ocupacion}` : ''}
                            </div>
                          </td>
                          <td style={{
                            ...td, textAlign: 'left', fontSize: '0.72rem', color: '#94a3b8',
                            whiteSpace: 'normal', maxWidth: 210, lineHeight: 1.35,
                          }}>
                            {a.servicio}
                          </td>
                          <td style={{
                            ...td, textAlign: 'left', fontSize: '0.7rem', color: '#94a3b8',
                            whiteSpace: 'normal', maxWidth: 250, lineHeight: 1.4,
                            overflowWrap: 'anywhere',
                          }}>
                            {a.horario}
                          </td>
                          <td style={{ ...td, color: a.regimen === 'GUARDIA' ? COLORES.guardia : COLORES.planta }}>
                            {a.regimen}
                          </td>
                          <td style={td}>{fmt(a.turnosProg)}</td>
                          <td style={td}>{fmt(a.turnosNoProg)}</td>
                          <td style={td}>{fmt(a.turnosProgramada)}</td>
                          <td style={{ ...td, color: COLORES.noProg, fontWeight: 700 }}>{pct(a.pctNoProgramada)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Advertencias ── */}
          {data.advertencias.length > 0 && (
            <div className="card" style={{ padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
                ⚠ CALIDAD DEL DATO
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: '#94a3b8' }}>
                {data.advertencias.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

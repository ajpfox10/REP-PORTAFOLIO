// src/pages/AusentesSeguidosPage/index.tsx
// /app/ausentes-seguidos (solo admin): agentes con N o más ausentes seguidos en días que les tocaba venir.
// Reglas (backend /fichajes-agentes/ausentes-seguidos): el día que no le toca no corta ni suma; el día que le toca
// sin ausente corta; ausente en día que no le toca no suma y queda como aviso; sin horario = se toma como que le tocaba.
import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Layout } from '../../components/Layout';
import { exportToExcelSheets } from '../../utils/export';
import { cargarSeguidos, diaCorto, fmtF, avisoLegible, FICHO, type RespSeguidos, type DiaRacha } from './shared';

const hoyIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const restar = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);

const TXT_FICHAJE: Record<string, string> = {
  COMPLETO: 'Fichó entrada y salida', SOLO_ENTRADA: 'Solo entrada', SOLO_SALIDA: 'Solo salida', FICHO_SIN_TURNO: 'Fichó (sin turno)',
  NO: 'No fichó', NO_LE_TOCA: 'No le toca', SIN_TURNO: 'Sin turno',
};

export function AusentesSeguidosPage() {
  const [hasta, setHasta] = useState(hoyIso());
  const [desde, setDesde] = useState(restar(hoyIso(), 59));
  const [min, setMin] = useState(3);
  const [d, setD] = useState<RespSeguidos | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [servicio, setServicio] = useState('TODOS');
  const [ley, setLey] = useState('TODAS');
  const [soloAvisos, setSoloAvisos] = useState(false);
  const [abierto, setAbierto] = useState<Set<string>>(new Set());

  const cargar = useCallback(async (refresh = false) => {
    setLoading(true); setError(null);
    try { setD(await cargarSeguidos({ desde, hasta, min, refresh })); }
    catch (e: any) { setError(e?.message || 'Error'); }
    finally { setLoading(false); }
  }, [desde, hasta, min]);
  useEffect(() => { void cargar(); }, [cargar]);

  const servicios = useMemo(() => [...new Set((d?.agentes ?? []).map(a => a.servicio).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [d]);
  const leyes = useMemo(() => [...new Set((d?.agentes ?? []).map(a => a.ley).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [d]);

  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.agentes ?? []).filter(a =>
      (!t || a.nombre.toLowerCase().includes(t) || a.dni.includes(t.replace(/\D/g, '') || '§'))
      && (servicio === 'TODOS' || a.servicio === servicio)
      && (ley === 'TODAS' || a.ley === ley)
      && (!soloAvisos || a.avisos.length > 0));
  }, [d, q, servicio, ley, soloAvisos]);

  const toggle = (k: string) => setAbierto(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const exportar = () => {
    const resumen = filas.flatMap(a => a.rachas.map(r => ({
      Agente: a.nombre, DNI: a.dni, Servicio: a.servicio || '', Ley: a.ley || '', Dependencia: a.dependencia || '',
      Seguidos: r.seguidos, Desde: fmtF(r.desde), Hasta: fmtF(r.hasta), 'Días que fichó': r.fichoDias,
      Avisos: r.avisos.map(avisoLegible).join(' | '),
    })));
    const detalle = filas.flatMap(a => a.rachas.flatMap(r => r.dias.map(x => ({
      Agente: a.nombre, DNI: a.dni, 'Racha desde': fmtF(r.desde), Fecha: fmtF(x.fecha), Día: diaCorto(x).split(' ')[0],
      Tipo: x.tipo === 'AUSENTE' ? 'Ausente (le tocaba)' : x.tipo === 'AUSENTE_NO_TOCA' ? 'Ausente (NO le tocaba)' : 'No le toca',
      Horario: x.horario || (x.sinHorario ? 'sin horario' : ''), Feriado: x.feriado || '',
      SIAPE: x.siape ? 'Sí' : '', Ministerio: x.ministerio ? 'Sí' : '', Fichaje: x.fichaje ? (TXT_FICHAJE[x.fichaje] || x.fichaje) : '',
      'Salud Laboral': [...(x.reconocido || []), ...(x.saludLaboral || [])].join(' | '), ART: (x.art || []).join(' | '),
      Jefe: (x.jefe || []).join(' | '), Otras: (x.otras || []).join(' | '),
    }))));
    exportToExcelSheets(`ausentes_seguidos_${desde}_${hasta}`, [
      { name: 'Rachas', rows: resumen, cols: [32, 11, 30, 26, 14, 9, 11, 11, 10, 60] },
      { name: 'Día por día', rows: detalle },
    ]);
  };

  const th: CSSProperties = { textAlign: 'left', padding: '7px 8px', fontSize: '0.72rem', textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.12)' };
  const td: CSSProperties = { padding: '7px 8px', fontSize: '0.82rem', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'top' };

  const celdaDia = (x: DiaRacha) => {
    const color = x.tipo === 'AUSENTE' ? '#fca5a5' : x.tipo === 'AUSENTE_NO_TOCA' ? '#fcd34d' : '#64748b';
    const fuentes = [x.siape && 'SIAPE', x.ministerio && 'Ministerio'].filter(Boolean).join(' + ');
    return (
      <tr key={x.fecha} style={{ background: x.tipo === 'NO_LE_TOCA' ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
        <td style={{ ...td, whiteSpace: 'nowrap', color }}>{diaCorto(x)}</td>
        <td style={{ ...td, color }}>
          {x.tipo === 'AUSENTE' ? '✗ Ausente' : x.tipo === 'AUSENTE_NO_TOCA' ? '⚠️ Ausente, NO le tocaba venir' : x.tipo === 'EN_CURSO' ? 'Turno en curso' : 'No le toca (no corta)'}
          {fuentes && <span className="muted"> · {fuentes}</span>}
        </td>
        <td style={td}>{x.horario || (x.sinHorario ? <span style={{ color: '#fcd34d' }}>sin horario</span> : '—')}{x.feriado ? <span className="muted"> · feriado {x.feriado}</span> : ''}</td>
        <td style={{ ...td, color: x.fichaje && FICHO.has(x.fichaje) ? '#86efac' : undefined }}>{x.fichaje ? (TXT_FICHAJE[x.fichaje] || x.fichaje) : ''}</td>
        <td style={{ ...td, fontSize: '0.75rem' }}>
          {[...(x.reconocido || []), ...(x.saludLaboral || []), ...(x.art || []), ...(x.jefe || []), ...(x.otras || [])].join(' · ')}
        </td>
      </tr>
    );
  };

  return (
    <Layout title="Ausentes seguidos" showBack fluid>
      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div className="h2" style={{ marginBottom: 4 }}>🚫 Ausentes seguidos</div>
            <div className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
              Ausentes cargados (SIAPE y/o 28 del Ministerio) en días que le tocaba venir, uno detrás del otro. El día que no le
              toca no corta la racha; un día que le tocaba sin ausente la corta. Un ausente en día que no le corresponde no suma y queda avisado.
              {d?.corrida && <> Archivos de la corrida del {d.corrida.creado_en}.</>}
            </div>
          </div>
          <label className="muted" style={{ fontSize: '0.75rem' }}>Desde<br />
            <input className="input" type="date" value={desde} max={hasta} onChange={e => e.target.value && setDesde(e.target.value)} /></label>
          <label className="muted" style={{ fontSize: '0.75rem' }}>Hasta<br />
            <input className="input" type="date" value={hasta} max={hoyIso()} onChange={e => e.target.value && setHasta(e.target.value)} /></label>
          <label className="muted" style={{ fontSize: '0.75rem' }}>Mínimo seguidos<br />
            <select className="input" value={min} onChange={e => setMin(Number(e.target.value))}>
              {[3, 4, 5, 6, 7, 10].map(n => <option key={n} value={n}>{n}</option>)}
            </select></label>
          <button className="btn" onClick={() => void cargar(true)} disabled={loading}>{loading ? 'Calculando…' : '↻ Actualizar'}</button>
          <button className="btn" onClick={exportar} disabled={!filas.length}>⬇ Excel</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
          <input className="input" style={{ flex: '1 1 240px' }} placeholder="Buscar por apellido, nombre o DNI…" value={q} onChange={e => setQ(e.target.value)} />
          <select className="input" value={servicio} onChange={e => setServicio(e.target.value)}>
            <option value="TODOS">Todos los servicios</option>
            {servicios.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={ley} onChange={e => setLey(e.target.value)}>
            <option value="TODAS">Todas las leyes</option>
            {leyes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label style={{ fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={soloAvisos} onChange={e => setSoloAvisos(e.target.checked)} /> Solo con avisos
          </label>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{filas.length} agente(s)</span>
        </div>
        {error && <div style={{ color: '#fca5a5', marginTop: 10 }}>{error}</div>}
        {(d?.avisos ?? []).map((a, i) => <div key={i} style={{ color: '#fcd34d', fontSize: '0.78rem', marginTop: 6 }}>⚠ {a}</div>)}
      </div>

      <div className="card" style={{ marginTop: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr>
            <th style={th}>Agente</th><th style={th}>Servicio / ley</th><th style={th}>Seguidos</th>
            <th style={th}>Racha</th><th style={th}>Fichó</th><th style={th}>Avisos</th>
          </tr></thead>
          <tbody>
            {loading && !d && <tr><td style={td} colSpan={6} className="muted">Calculando…</td></tr>}
            {!loading && !filas.length && <tr><td style={td} colSpan={6} className="muted">Nadie con {min} o más ausentes seguidos en el período.</td></tr>}
            {filas.map(a => a.rachas.map((r, i) => {
              const k = `${a.dni}|${r.desde}`;
              const ab = abierto.has(k);
              return (
                <Fragment key={k}>
                  <tr onClick={() => toggle(k)} style={{ cursor: 'pointer', background: ab ? 'rgba(249,115,22,0.08)' : undefined }}>
                    <td style={td}>
                      {i === 0 ? <><div style={{ fontWeight: 700 }}>{ab ? '▾' : '▸'} {a.nombre}</div><div className="muted" style={{ fontSize: '0.72rem' }}>DNI {a.dni}{a.dependencia ? ` · ${a.dependencia}` : ''}</div></>
                        : <div className="muted" style={{ fontSize: '0.75rem' }}>{ab ? '▾' : '▸'} otra racha</div>}
                    </td>
                    <td style={td}>{i === 0 && <><div>{a.servicio || '—'}</div><div className="muted" style={{ fontSize: '0.72rem' }}>{a.ley || ''}{a.ocupacion ? ` · ${a.ocupacion}` : ''}</div></>}</td>
                    <td style={{ ...td, fontWeight: 800, fontSize: '1rem', color: '#fdba74' }}>{r.seguidos}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtF(r.desde)} → {fmtF(r.hasta)}<div className="muted" style={{ fontSize: '0.72rem' }}>{r.dias.length} días corridos</div></td>
                    <td style={{ ...td, color: r.fichoDias ? '#86efac' : undefined }}>{r.fichoDias ? `${r.fichoDias} de ${r.seguidos}` : 'no'}</td>
                    <td style={{ ...td, color: '#fca5a5', fontSize: '0.75rem' }}>{r.avisos.map(avisoLegible).join(' · ')}</td>
                  </tr>
                  {ab && (
                    <tr><td colSpan={6} style={{ padding: '4px 8px 12px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={th}>Día</th><th style={th}>Qué tiene</th><th style={th}>Horario</th><th style={th}>Fichaje</th><th style={th}>Salud Laboral / ART / jefe / otras</th></tr></thead>
                        <tbody>{r.dias.map(celdaDia)}</tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              );
            }))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

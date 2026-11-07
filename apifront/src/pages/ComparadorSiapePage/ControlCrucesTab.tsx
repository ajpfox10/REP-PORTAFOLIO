// Pestaña "Control de cruces" del Comparador (04/11/2026): SIAPE vs Ministerio vs fichadas del reloj, por mes.
// Lo calcula el robot control_cruces (scripts/control_cruces.py) y lo guarda en la tabla control_cruces;
// acá solo se lee (GET /comparacion-v2/cruces) y se puede recalcular (POST /comparacion-v2/cruces/recalcular).
// Reglas de tardanza: más de 8 min = tarde; desde la 3ª tarde del mes cada tarde es ausente; más de 30 min = ausente.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';

interface Fila {
  categoria: string; dependencia: string; dni: number; nombre: string; ley: string; fecha: string;
  turno: string; entrada: string; tarde_min: number | null; siape: string; ministerio: string; detalle: string;
}
interface Resp {
  ok: boolean; error?: string; mes: string | null;
  meses: { mes: string; calculado_en: string; filas: number }[];
  filas: Fila[];
  ultimaCorrida: { estado: string; motivo: string; cuando: string } | null;
}

const CATS: Record<string, { label: string; color: string; ayuda: string; error: boolean }> = {
  C1:  { label: '28 en Ministerio sin ausente en SIAPE', color: '#ef4444', error: true,
         ayuda: 'Hay inasistencia en el Ministerio y SIAPE no tiene ausente ese día (suele ser un 28 de varios días contra un solo día en SIAPE).' },
  C2:  { label: 'Ausente en SIAPE sin cargar', color: '#f59e0b', error: true,
         ayuda: 'SIAPE tiene AUSENTE SIN AVISO y el Ministerio no tiene nada ese día.' },
  C2B: { label: 'Ausente borrado del Ministerio', color: '#f97316', error: true,
         ayuda: 'El robot lo cargó OK pero hoy no está en el Ministerio: alguien lo borró a mano.' },
  C3:  { label: 'Ausente en SIAPE pero fichó', color: '#ef4444', error: true,
         ayuda: 'SIAPE dice ausente pero fichó la entrada de su turno (a horario o 1ª/2ª tarde del mes).' },
  C4:  { label: '28 en Ministerio pero fichó', color: '#ef4444', error: true,
         ayuda: 'Hay 28 en el Ministerio pero fichó la entrada de su turno.' },
  C5:  { label: 'Novedad distinta SIAPE / Ministerio', color: '#a78bfa', error: true,
         ayuda: 'El mismo día SIAPE y el Ministerio tienen novedades que no se corresponden (enfermedad = E/01/1R/04 no cuenta).' },
  C6:  { label: 'Licencia o franco pero fichó', color: '#38bdf8', error: false,
         ayuda: 'SIAPE tiene licencia o franco de día completo y el agente fichó la entrada.' },
  C7:  { label: 'No fichó y sin ninguna novedad', color: '#94a3b8', error: false,
         ayuda: 'Tenía turno, no fichó la entrada y no hay nada en SIAPE, Ministerio, jefe, Salud Laboral ni rotaciones.' },
  C8:  { label: 'Ausente por tardanza (revisar horario)', color: '#64748b', error: false,
         ayuda: 'Llegó más de 30 min tarde o es su 3ª tarde (+8 min) del mes y no hay nada cargado. Si son muchos días del mismo agente, el horario de SIAPE probablemente no es el real.' },
};
const fmt = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
const norm = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function ControlCrucesTab() {
  const toast = useToast();
  const [mes, setMes] = useState<string>('');
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [lanzando, setLanzando] = useState(false);
  const [cat, setCat] = useState<string>('C1');
  const [dep, setDep] = useState<string>('');
  const [q, setQ] = useState('');

  const cargar = useCallback(async (m?: string) => {
    setLoading(true);
    try {
      const r = await apiFetch<Resp>(`/comparacion-v2/cruces${m ? `?mes=${m}` : ''}`);
      setData(r);
      if (r.mes) setMes(r.mes);
    } catch (e: any) {
      toast.error('No pude leer el control de cruces', e?.message || '');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { cargar(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const recalcular = async () => {
    setLanzando(true);
    try {
      const r = await apiFetch<any>('/comparacion-v2/cruces/recalcular', { method: 'POST' });
      toast.ok('Recalculando', r?.msg || '');
      setTimeout(() => cargar(mes), 90_000);
    } catch (e: any) {
      toast.error('No pude lanzar el control', e?.message || '');
    } finally {
      setLanzando(false);
    }
  };

  const filas = data?.filas || [];
  const conteo = useMemo(() => {
    const c: Record<string, { dias: number; agentes: Set<number> }> = {};
    for (const k of Object.keys(CATS)) c[k] = { dias: 0, agentes: new Set() };
    for (const f of filas) if (c[f.categoria] && (!dep || f.dependencia === dep)) { c[f.categoria].dias++; c[f.categoria].agentes.add(f.dni); }
    return c;
  }, [filas, dep]);
  const vista = useMemo(() => {
    const nq = norm(q);
    return filas.filter(f => f.categoria === cat && (!dep || f.dependencia === dep)
      && (!nq || norm(`${f.nombre} ${f.dni} ${f.siape} ${f.ministerio}`).includes(nq)));
  }, [filas, cat, dep, q]);
  const deps = useMemo(() => Array.from(new Set(filas.map(f => f.dependencia).filter(Boolean))).sort(), [filas]);
  const calculado = data?.meses.find(m => m.mes === data?.mes)?.calculado_en;

  const exportar = () => exportToExcel(`control_cruces_${mes}_${cat}`, vista.map(f => ({
    Categoria: CATS[f.categoria]?.label || f.categoria, Dependencia: f.dependencia, DNI: f.dni, Agente: f.nombre, Ley: f.ley,
    Fecha: fmt(f.fecha), Turno: f.turno, Entrada: f.entrada, 'Min tarde': f.tarde_min ?? '', SIAPE: f.siape,
    Ministerio: f.ministerio, Detalle: f.detalle,
  })));

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <strong style={{ fontSize: '0.9rem' }}>🔀 Control de cruces SIAPE · Ministerio · Fichadas</strong>
        <select className="input" value={mes} onChange={e => { setMes(e.target.value); cargar(e.target.value); }} style={{ width: 120 }}>
          {(data?.meses || []).map(m => <option key={m.mes} value={m.mes}>{m.mes}</option>)}
        </select>
        <select className="input" value={dep} onChange={e => setDep(e.target.value)} style={{ width: 130 }}>
          <option value="">Todas las dependencias</option>
          {deps.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input className="input" placeholder="Buscar agente, DNI o novedad…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 230 }} />
        <button className="btn" onClick={() => cargar(mes)} disabled={loading}>🔄 Recargar</button>
        <button className="btn" onClick={recalcular} disabled={lanzando}
          title="Vuelve a cruzar el mes anterior y el actual con los archivos y fichadas de hoy">
          {lanzando ? '⏳ Lanzando…' : '⚙️ Recalcular'}
        </button>
        <button className="btn" onClick={exportar} disabled={!vista.length}>⬇ Excel</button>
        <button className="btn" title="Abre en otra pestaña qué licencias tiene cada agente en SIAPE, Ministerio y Salud Laboral"
          onClick={() => window.open(`/app/licencias-por-agente${mes ? `?mes=${mes}` : ''}`, '_blank')}>
          👤 Licencias por agente
        </button>
        <span className="muted" style={{ fontSize: '0.72rem' }}>
          {calculado ? `Calculado: ${String(calculado).replace('T', ' ').slice(0, 16)}` : 'Sin calcular'}
          {data?.ultimaCorrida && data.ultimaCorrida.estado !== 'ok' ? ` · ⚠ última corrida con error: ${data.ultimaCorrida.motivo}` : ''}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8, marginBottom: 12 }}>
        {Object.entries(CATS).map(([k, c]) => (
          <button key={k} onClick={() => setCat(k)} title={c.ayuda}
            style={{
              textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              background: cat === k ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${cat === k ? '#7c3aed' : 'rgba(255,255,255,0.08)'}`, color: '#e2e8f0',
            }}>
            <div style={{ fontSize: '0.72rem', color: c.color, fontWeight: 600 }}>{c.error ? '❗ ' : 'ℹ️ '}{c.label}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {conteo[k]?.dias ?? 0} <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400 }}>días · {conteo[k]?.agentes.size ?? 0} agentes</span>
            </div>
          </button>
        ))}
      </div>

      <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 8 }}>{CATS[cat]?.ayuda}</div>

      {loading ? <div className="card muted" style={{ padding: 20, textAlign: 'center' }}>⏳ Leyendo…</div>
        : !vista.length ? <div className="card muted" style={{ padding: 20, textAlign: 'center' }}>Sin casos en esta categoría.</div>
        : (
          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            <table className="table" style={{ width: '100%', fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  <th>Dep.</th><th>DNI</th><th>Agente</th><th>Fecha</th><th>Turno</th><th>Entrada</th><th>Tarde</th>
                  <th>SIAPE</th><th>Ministerio</th><th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {vista.slice(0, 1500).map((f, i) => (
                  <tr key={`${f.dni}-${f.fecha}-${i}`}>
                    <td>{f.dependencia}</td>
                    <td style={{ fontFamily: 'monospace' }}>{f.dni}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{f.nombre}<div className="muted" style={{ fontSize: '0.65rem' }}>{f.ley}</div></td>
                    <td style={{ fontFamily: 'monospace' }}>{fmt(f.fecha)}</td>
                    <td>{f.turno}</td>
                    <td>{f.entrada}</td>
                    <td>{f.tarde_min ? `${f.tarde_min}′` : ''}</td>
                    <td>{f.siape}</td>
                    <td>{f.ministerio}</td>
                    <td className="muted">{f.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vista.length > 1500 && <div className="muted" style={{ padding: 8, fontSize: '0.72rem' }}>Se muestran 1500 de {vista.length}: usá el buscador o exportá a Excel.</div>}
          </div>
        )}
    </div>
  );
}

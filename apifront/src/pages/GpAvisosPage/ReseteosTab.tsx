// Pestaña 📊 Reseteos de /app/gestiones-personales-avisos: estadística de quién pide reseteo de
// clave en Gestiones Personales. Cada confirmación del robot intranet_gp_confirmar (fila de
// gp_avisos_whatsapp) = un reseteo. Backend: GET /gp-avisos/estadistica?desde=YYYY-MM&hasta=YYYY-MM
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type EstMes = { mes: string; reseteos: number; personas: number; avisados: number };
type EstAgente = { dni: number; legajo: string | null; agente: string; reseteos: number; meses: number; fechas: string; ultimo: string; avisados: number; servicio: string | null };
type EstServicio = { servicio: string; reseteos: number; personas: number };

const INPUT: CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '4px 8px', fontSize: '0.8rem' };
const BTN: CSSProperties = { fontSize: '0.8rem', padding: '4px 10px' };
const VERDE = '#34d399';
const MESES_TXT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const mesTxt = (m: string) => { const [a, mm] = m.split('-'); return `${MESES_TXT[Number(mm) - 1]} ${a}`; };
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export default function ReseteosTab() {
  const toast = useToast();
  const mesActual = ym(new Date());
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11); return ym(d); });
  const [hasta, setHasta] = useState(mesActual);
  const [texto, setTexto] = useState('');
  const [soloRepiten, setSoloRepiten] = useState(false);
  const [data, setData] = useState<{ porMes: EstMes[]; porAgente: EstAgente[]; porServicio: EstServicio[] }>({ porMes: [], porAgente: [], porServicio: [] });
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const qs = new URLSearchParams({ desde, hasta });
      const r = await apiFetch<any>(`/gp-avisos/estadistica?${qs}`);
      if (r?.ok) setData({ porMes: r.porMes || [], porAgente: r.porAgente || [], porServicio: r.porServicio || [] });
    } catch (e: any) { toast.error('Reseteos', e?.message); }
    finally { setCargando(false); }
  }, [desde, hasta, toast]);
  useEffect(() => { void cargar(); }, [cargar]);

  const q = texto.trim().toUpperCase();
  const agentes = data.porAgente.filter(a => (!soloRepiten || a.reseteos > 1)
    && (!q || `${a.agente} ${a.dni} ${a.servicio || ''}`.toUpperCase().includes(q)));
  const total = data.porMes.reduce((s, m) => s + m.reseteos, 0);
  const personas = data.porAgente.length;
  const repiten = data.porAgente.filter(a => a.reseteos > 1).length;
  const maxMes = Math.max(1, ...data.porMes.map(m => m.reseteos));

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Mes', 'Reseteos', 'Personas distintas', 'Avisados por WhatsApp'],
      ...data.porMes.map(m => [mesTxt(m.mes), m.reseteos, m.personas, m.avisados]),
      ['TOTAL', total, personas, data.porMes.reduce((s, m) => s + m.avisados, 0)],
    ]), 'Por mes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Agente', 'DNI', 'Legajo', 'Servicio', 'Reseteos', 'Meses distintos', 'Fechas', 'Avisados'],
      ...data.porAgente.map(a => [a.agente, a.dni, a.legajo || '', a.servicio || '', a.reseteos, a.meses, a.fechas, a.avisados]),
    ]), 'Por agente');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Servicio', 'Reseteos', 'Personas'],
      ...data.porServicio.map(s => [s.servicio, s.reseteos, s.personas]),
    ]), 'Por servicio');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([out], { type: 'application/octet-stream' }), `reseteos_gp_${desde}_a_${hasta}.xlsx`);
  };

  const TH: CSSProperties = { padding: 8 };
  const TARJETAS: [string, number, string][] = [
    ['Reseteos', total, '#60a5fa'], ['Personas distintas', personas, VERDE], ['Pidieron más de una vez', repiten, '#fbbf24'],
  ];

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8, fontSize: '0.8rem' }}>
        Desde <input type="month" value={desde} max={hasta} onChange={e => e.target.value && setDesde(e.target.value)} style={INPUT} />
        hasta <input type="month" value={hasta} max={mesActual} onChange={e => e.target.value && setHasta(e.target.value)} style={INPUT} />
        <button type="button" className="btn" style={BTN} onClick={() => { setDesde(mesActual); setHasta(mesActual); }}>Este mes</button>
        {cargando && <span style={{ color: '#94a3b8' }}>cargando…</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" style={BTN} disabled={!total} onClick={exportar}>⬇️ Excel</button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {TARJETAS.map(([t, v, c]) => (
          <div key={t} className="card" style={{ padding: '8px 14px', minWidth: 150 }}>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{t}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10, marginBottom: 10 }}>
        <div className="card" style={{ padding: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: '0.85rem' }}>Por mes</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}><th style={TH}>Mes</th><th>Reseteos</th><th></th><th>Personas</th><th>Avisados</th></tr></thead>
            <tbody>
              {data.porMes.map(m => (
                <tr key={m.mes} style={{ borderTop: '1px solid #1e293b' }}>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{mesTxt(m.mes)}</td>
                  <td><b>{m.reseteos}</b></td>
                  <td style={{ width: '40%' }}><div style={{ height: 8, borderRadius: 4, background: '#60a5fa', width: `${(m.reseteos / maxMes) * 100}%` }} /></td>
                  <td>{m.personas}</td>
                  <td style={{ color: VERDE }}>{m.avisados}</td>
                </tr>
              ))}
              {!data.porMes.length && !cargando && <tr><td colSpan={5} style={{ padding: 10, color: '#94a3b8' }}>Sin reseteos en ese período.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: '0.85rem' }}>Por servicio (actual del agente) <span style={{ color: '#64748b', fontWeight: 400 }}>· clic para filtrar</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}><th style={TH}>Servicio</th><th>Reseteos</th><th>Personas</th></tr></thead>
            <tbody>
              {data.porServicio.map(s => (
                <tr key={s.servicio} style={{ borderTop: '1px solid #1e293b', cursor: 'pointer' }}
                    onClick={() => setTexto(s.servicio === '(sin servicio)' ? '' : s.servicio)}>
                  <td style={{ padding: 6 }}>{s.servicio}</td><td><b>{s.reseteos}</b></td><td>{s.personas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6, fontSize: '0.8rem' }}>
        <b style={{ fontSize: '0.85rem' }}>Por agente</b>
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Apellido, DNI o servicio" style={{ ...INPUT, width: 220 }} />
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={soloRepiten} onChange={e => setSoloRepiten(e.target.checked)} /> solo los que pidieron más de una vez
        </label>
        <span style={{ color: '#94a3b8' }}>{agentes.length} agentes</span>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
              <th style={TH}>Agente</th><th>DNI</th><th>Servicio</th><th>Reseteos</th><th>Meses</th><th>Fechas</th><th>Avisados</th>
            </tr>
          </thead>
          <tbody>
            {agentes.map(a => (
              <tr key={a.dni} style={{ borderTop: '1px solid #1e293b' }}>
                <td style={{ padding: 8 }}>{a.agente}</td>
                <td>{a.dni}</td>
                <td style={{ color: '#94a3b8' }}>{a.servicio || '—'}</td>
                <td><b style={{ color: a.reseteos > 1 ? '#fbbf24' : '#e2e8f0' }}>{a.reseteos}</b></td>
                <td>{a.meses}</td>
                <td style={{ color: '#94a3b8', fontSize: '0.75rem', maxWidth: 280, overflowWrap: 'anywhere' }}>{a.fechas}</td>
                <td style={{ color: VERDE, paddingRight: 8 }}>{a.avisados}/{a.reseteos}</td>
              </tr>
            ))}
            {!agentes.length && !cargando && <tr><td colSpan={7} style={{ padding: 12, color: '#94a3b8' }}>Nadie en ese período.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

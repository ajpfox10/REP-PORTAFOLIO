// src/pages/LicenciasMedicasControlPage/ResumenMensualCard.tsx
// Card "📊 Licencias médicas del mes": de NUESTROS agentes, por fecha desde, del mes elegido:
// total, otorgadas, rechazadas (DENEGADA + NO JUSTIFICADA), otras, pendientes y % de rechazo.
// "⬇ Excel del año" = una fila por mes + total. Fuente: GET /licencias-medicas-control/resumen-mensual.
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';

type Fila = {
  mes: number; total: number; otorgadas: number; rechazadas: number; pendientes: number; otras: number;
  pct_rechazo_resueltas: number | null; pct_rechazo_total: number | null;
};
type Resp = { ok: boolean; error?: string; anio: number; licencias_actualizado: string; meses: Fila[]; total: Omit<Fila, 'mes'> };

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const pctTxt = (v: number | null) => (v === null ? '—' : `${String(v).replace('.', ',')} %`);

export function ResumenMensualCard({ anio, mes, recarga }: { anio: number; mes: string; recarga?: unknown }) {
  const [d, setD] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setError(null);
    apiFetch<Resp>(`/licencias-medicas-control/resumen-mensual?anio=${anio}`)
      .then(r => { if (!vivo) return; if (!r?.ok) throw new Error(r?.error || 'Error'); setD(r); })
      .catch(e => { if (vivo) setError(e?.message || 'Error'); });
    return () => { vivo = false; };
  }, [anio, recarga]);

  const f = d?.meses.find(m => m.mes === Number(mes)) ?? null;

  const exportar = () => {
    if (!d) return;
    const fila = (nombre: string, x: Omit<Fila, 'mes'>) => ({
      Mes: nombre, 'Licencias': x.total, 'Otorgadas': x.otorgadas, 'Rechazadas': x.rechazadas,
      'Observadas / otras': x.otras, 'Pendientes': x.pendientes,
      '% rechazadas (sobre resueltas)': x.pct_rechazo_resueltas ?? '', '% rechazadas (sobre total)': x.pct_rechazo_total ?? '',
    });
    exportToExcel(`licencias_medicas_mensual_${d.anio}`, [
      ...d.meses.map(m => fila(`${MESES[m.mes - 1]} ${d.anio}`, m)),
      fila(`TOTAL ${d.anio}`, d.total),
    ]);
  };

  const dato = (k: string, v: number | string, color?: string) => (
    <div style={{ textAlign: 'center', minWidth: 62 }}>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color }}>{v}</div>
      <div className="muted" style={{ fontSize: '0.66rem' }}>{k}</div>
    </div>
  );

  return (
    <div className="card" style={{ padding: '8px 14px', border: '1px solid rgba(124,58,237,0.45)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div className="muted" style={{ fontSize: '0.72rem' }}>📊 Licencias médicas · {MESES[Number(mes) - 1]} {anio}</div>
        <button type="button" className="btn" style={{ padding: '0 8px', fontSize: '0.7rem' }} disabled={!d} onClick={exportar}
          title="Excel con todos los meses del año + total">⬇ Excel del año</button>
      </div>
      {error ? <div style={{ color: '#fca5a5', fontSize: '0.75rem' }}>{error}</div>
        : !d ? <div className="muted" style={{ fontSize: '0.75rem' }}>Cargando…</div>
        : !f ? <div className="muted" style={{ fontSize: '0.75rem' }}>Sin datos para ese mes.</div>
        : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {dato('Licencias', f.total)}
            {dato('Otorgadas', f.otorgadas, '#86efac')}
            {dato('Rechazadas', f.rechazadas, '#fca5a5')}
            {dato('Obs./otras', f.otras)}
            {dato('Pendientes', f.pendientes, '#fcd34d')}
            <div style={{ textAlign: 'center', minWidth: 90, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 8 }}
              title={`Rechazadas / (total − pendientes). Sobre el total: ${pctTxt(f.pct_rechazo_total)}`}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fca5a5' }}>{pctTxt(f.pct_rechazo_resueltas)}</div>
              <div className="muted" style={{ fontSize: '0.66rem' }}>rechazadas · {pctTxt(f.pct_rechazo_total)} s/total</div>
            </div>
          </div>
        )}
      <div className="muted" style={{ fontSize: '0.64rem' }}>
        Por fecha desde, solo agentes del hospital. Fuente: Excel del Ministerio (trae los últimos meses: los meses viejos pueden salir incompletos).
      </div>
    </div>
  );
}

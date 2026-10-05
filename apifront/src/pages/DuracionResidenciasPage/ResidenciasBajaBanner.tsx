// src/pages/DuracionResidenciasPage/ResidenciasBajaBanner.tsx
// Banner del dashboard: residentes que ya cumplieron los años de su residencia
// al corte anual y siguen activos. NO se puede descartar: insiste hasta que el
// agente queda dado de baja (o se justifica que no corresponde) en la página.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api/http';

type Pendiente = {
  dni: number;
  apellido: string;
  nombre: string;
  residencia_nombre: string | null;
  anios_cumplidos: number | null;
  anios_residencia: number | null;
  servicio_nombre: string | null;
  estado?: string;
};

function fmtFecha(f?: string | null) {
  if (!f) return '';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f);
}

export function ResidenciasBajaBanner() {
  const [rows, setRows] = useState<Pendiente[]>([]);
  const [corte, setCorte] = useState<{ ciclo: number; fechaCorte: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/residencias/pendientes');
      setRows(Array.isArray(res?.data) ? res.data : []);
      setCorte(res?.corte || null);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (!rows.length) return null;

  const mostradas = rows.slice(0, 8);
  const restantes = rows.length - mostradas.length;

  return (
    <div style={{
      margin: '0 0 16px 0',
      padding: '14px 16px',
      background: 'rgba(239,68,68,0.12)',
      border: '2px solid rgba(239,68,68,0.45)',
      borderLeft: '5px solid #ef4444',
      borderRadius: 12,
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>🎓</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: '#fca5a5', marginBottom: 6 }}>
          {rows.length === 1 ? '1 residente terminó la residencia' : `${rows.length} residentes terminaron la residencia`}
          {corte ? ` al ${fmtFecha(corte.fechaCorte)}` : ''} y siguen activos
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {mostradas.map((r) => (
            <span key={r.dni} style={{
              padding: '3px 9px', borderRadius: 999, fontSize: '.78rem',
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
            }}>
              {[r.apellido, r.nombre].filter(Boolean).join(', ')}
              {r.residencia_nombre ? ` · ${r.residencia_nombre}` : ''}
              {r.estado === 'FIN_JEFATURA'
                ? ' (fin de jefatura)'
                : r.anios_cumplidos != null && r.anios_residencia != null
                  ? ` (${r.anios_cumplidos}/${r.anios_residencia})`
                  : ''}
            </span>
          ))}
          {restantes > 0 && (
            <span style={{ padding: '3px 9px', fontSize: '.78rem', opacity: .75 }}>
              y {restantes} más…
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link className="btn" to="/app/duracion-residencias">Resolver (baja o jefatura)</Link>
          <span style={{ opacity: .65, fontSize: '.76rem' }}>
            Este aviso no se puede descartar: sigue hasta que el agente esté dado de baja o pase a jefatura.
          </span>
        </div>
      </div>
    </div>
  );
}

export default ResidenciasBajaBanner;

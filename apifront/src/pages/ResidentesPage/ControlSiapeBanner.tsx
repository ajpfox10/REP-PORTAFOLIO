// src/pages/ResidentesPage/ControlSiapeBanner.tsx
// Banner del dashboard: residentes / ex residentes activos en la base que SIAPE dio de baja.
// No se descarta: desaparece solo cuando vuelven a figurar en la exportación de horarios de SIAPE.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api/http';

type Row = {
  dni: number;
  apellido: string;
  nombre: string;
  condicion: 'RESIDENTE' | 'EX_RESIDENTE';
  ultima_vez_en_siape: string | null;
  ausente_desde: string | null;
};

function fmt(f?: string | null) {
  if (!f) return '';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : String(f);
}

export function ControlSiapeBanner() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    apiFetch<any>('/residentes/control-siape/alertas')
      .then((r) => setRows(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows.length) return null;
  const mostradas = rows.slice(0, 8);

  return (
    <div style={{
      margin: '0 0 16px 0', padding: '14px 16px',
      background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.45)',
      borderLeft: '5px solid #ef4444', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>🩺</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: '#fca5a5', marginBottom: 6 }}>
          {rows.length === 1
            ? 'SIAPE dio de baja a 1 residente / ex residente que sigue activo'
            : `SIAPE dio de baja a ${rows.length} residentes / ex residentes que siguen activos`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {mostradas.map((r) => (
            <span key={r.dni} style={{
              padding: '3px 9px', borderRadius: 999, fontSize: '.78rem',
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
            }}>
              {[r.apellido, r.nombre].filter(Boolean).join(', ')}
              {r.condicion === 'EX_RESIDENTE' ? ' (ex)' : ''}
              {r.ultima_vez_en_siape ? ` · figuraba el ${fmt(r.ultima_vez_en_siape)}` : ''}
            </span>
          ))}
          {rows.length > mostradas.length && (
            <span style={{ padding: '3px 9px', fontSize: '.78rem', opacity: .75 }}>y {rows.length - mostradas.length} más…</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link className="btn" to="/app/residentes">Ver control SIAPE</Link>
          <span style={{ opacity: .65, fontSize: '.76rem' }}>
            Sigue hasta que vuelvan a figurar en la exportación de horarios de SIAPE.
          </span>
        </div>
      </div>
    </div>
  );
}

export default ControlSiapeBanner;

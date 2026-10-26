// src/components/FeriadosBloqueo.tsx
// Feriados del año sin confirmar (GET /feriados/estado, mig 091). Solo para administradores (crud:*:*):
//   · desde el 1/12 o antes del corte → banner de aviso
//   · desde el 4.º día hábil de enero sin confirmar → modal sin X que tapa la app; solo deja ir a
//     /app/feriados para cargar y confirmar el año. El resto de los usuarios no se entera.

import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/http';

interface Estado { anio: number; confirmado: boolean; corte: string; bloquea: boolean; aviso: string | null }

export function FeriadosBloqueo() {
  const nav = useNavigate();
  const loc = useLocation();
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch<any>('/feriados/estado');
        if (alive) setEstado(r?.ok ? r : null);
      } catch {
        if (alive) setEstado(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!estado) return null;
  const enFeriados = loc.pathname.replace(/\/$/, '') === '/app/feriados';

  if (estado.bloquea && !enFeriados) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(2,6,23,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
        <div role="alertdialog" aria-modal="true" style={{
          width: '100%', maxWidth: 560,
          background: '#1a0b0b',
          border: '2px solid rgba(220,38,38,0.7)', borderLeft: '6px solid #dc2626',
          borderRadius: 12, padding: '18px 20px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f87171', marginBottom: 8 }}>
            ! Faltan los feriados de {estado.anio}
          </div>
          <div style={{ fontSize: '0.88rem', color: '#fecaca', marginBottom: 14 }}>
            Desde el {estado.corte.split('-').reverse().join('/')} (4.º día hábil de enero) el sistema queda bloqueado
            para los administradores hasta que se carguen y se confirmen los feriados del año.
            El robot de ausentes tampoco carga {estado.anio} mientras tanto.
          </div>
          <button type="button" className="btn" onClick={() => nav('/app/feriados')}
            style={{ background: '#dc2626', color: '#fff', fontWeight: 700 }}>
            Cargar feriados de {estado.anio}
          </button>
        </div>
      </div>
    );
  }

  if (!estado.aviso || enFeriados) return null;
  return (
    <div style={{
      marginTop: 12, padding: '8px 12px', borderRadius: 8,
      background: 'rgba(180,83,9,0.18)', border: '1px solid rgba(251,191,36,0.4)',
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.84rem', color: '#fde68a',
    }}>
      <span style={{ flex: 1 }}>📅 {estado.aviso}</span>
      <button type="button" className="btn" onClick={() => nav('/app/feriados')} style={{ fontSize: '0.8rem' }}>
        Ir a Feriados
      </button>
    </div>
  );
}

// src/components/AlertaBannerAgente.tsx
import React, { useEffect } from 'react';
import { useAlertasAgente } from '../hooks/useAlertasAgente';

interface Props {
  dni: number | null | undefined;
}

const SANGRE = '#8b0000';
const SANGRE_BORDER = '#c00000';
const SANGRE_BG = 'rgba(139,0,0,0.13)';

export function AlertaBannerAgente({ dni }: Props) {
  const { alertas, marcarVisto, cerrar } = useAlertasAgente(dni);

  // Registrar "visto" automáticamente al mostrar
  useEffect(() => {
    alertas.forEach(a => {
      if (!a.visto_at) marcarVisto(a.id);
    });
  }, [alertas, marcarVisto]);

  if (!alertas.length) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      {alertas.map(a => (
        <div
          key={a.id}
          style={{
            background:   SANGRE_BG,
            border:       `1.5px solid ${SANGRE_BORDER}`,
            borderLeft:   `5px solid ${SANGRE}`,
            borderRadius: 8,
            padding:      '10px 14px',
            marginBottom: 8,
            display:      'flex',
            alignItems:   'flex-start',
            gap:          12,
          }}
        >
          <span style={{ fontSize: '1.2rem', flexShrink: 0, marginTop: 1 }}>
            {a.urgente ? '🚨' : '⚠️'}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight:   700,
              fontSize:     '0.88rem',
              color:        '#ff4444',
              marginBottom: 3,
              display:      'flex',
              alignItems:   'center',
              gap:          8,
            }}>
              {a.urgente && (
                <span style={{
                  background:   SANGRE,
                  color:        '#fff',
                  fontSize:     '0.65rem',
                  fontWeight:   800,
                  padding:      '1px 7px',
                  borderRadius: 4,
                  letterSpacing:'0.06em',
                  textTransform:'uppercase',
                  flexShrink:   0,
                }}>
                  URGENTE
                </span>
              )}
              {a.titulo}
            </div>
            <div style={{ fontSize: '0.83rem', color: '#fca5a5', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {a.mensaje}
            </div>
            {a.creado_por_nombre && (
              <div style={{ fontSize: '0.7rem', color: 'rgba(252,165,165,0.6)', marginTop: 4 }}>
                Cargado por {a.creado_por_nombre} · {new Date(a.created_at).toLocaleDateString('es-AR')}
              </div>
            )}
          </div>

          <button
            onClick={() => cerrar(a.id)}
            title="Cerrar alerta"
            style={{
              background:  'transparent',
              border:      `1px solid ${SANGRE_BORDER}`,
              borderRadius: 6,
              color:       '#fca5a5',
              cursor:      'pointer',
              fontSize:    '0.8rem',
              padding:     '3px 9px',
              flexShrink:  0,
              fontWeight:  700,
              whiteSpace:  'nowrap',
            }}
          >
            ✕ Cerrar
          </button>
        </div>
      ))}
      {/* Mensaje al cerrar — se muestra como toast desde el hook, no hace falta extra */}
    </div>
  );
}

// Wrapper que intercepta el click en "Cerrar" y muestra el mensaje permanente
export function AlertaBannerAgenteConMensaje({ dni }: Props) {
  const { alertas, marcarVisto, cerrar } = useAlertasAgente(dni);
  const [cerradas, setCerradas] = React.useState<number[]>([]);

  useEffect(() => {
    alertas.forEach(a => {
      if (!a.visto_at) marcarVisto(a.id);
    });
  }, [alertas, marcarVisto]);

  const handleCerrar = async (id: number) => {
    await cerrar(id);
    setCerradas(prev => [...prev, id]);
  };

  const visibles   = alertas.filter(a => !cerradas.includes(a.id));
  const recienCerradas = cerradas.filter(id => alertas.find(a => a.id === id) === undefined && cerradas.includes(id));

  if (!visibles.length && !cerradas.length) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      {visibles.map(a => (
        <div
          key={a.id}
          style={{
            background:   SANGRE_BG,
            border:       `1.5px solid ${SANGRE_BORDER}`,
            borderLeft:   `5px solid ${SANGRE}`,
            borderRadius: 8,
            padding:      '10px 14px',
            marginBottom: 8,
            display:      'flex',
            alignItems:   'flex-start',
            gap:          12,
          }}
        >
          <span style={{ fontSize: '1.2rem', flexShrink: 0, marginTop: 1 }}>
            {a.urgente ? '🚨' : '⚠️'}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight:   700,
              fontSize:     '0.88rem',
              color:        '#ff4444',
              marginBottom: 3,
              display:      'flex',
              alignItems:   'center',
              gap:          8,
            }}>
              {a.urgente && (
                <span style={{
                  background:   SANGRE,
                  color:        '#fff',
                  fontSize:     '0.65rem',
                  fontWeight:   800,
                  padding:      '1px 7px',
                  borderRadius: 4,
                  letterSpacing:'0.06em',
                  textTransform:'uppercase' as const,
                  flexShrink:   0,
                }}>
                  URGENTE
                </span>
              )}
              {a.titulo}
            </div>
            <div style={{ fontSize: '0.83rem', color: '#fca5a5', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {a.mensaje}
            </div>
            {a.creado_por_nombre && (
              <div style={{ fontSize: '0.7rem', color: 'rgba(252,165,165,0.6)', marginTop: 4 }}>
                Cargado por {a.creado_por_nombre} · {new Date(a.created_at).toLocaleDateString('es-AR')}
              </div>
            )}
          </div>

          <button
            onClick={() => handleCerrar(a.id)}
            title="Cerrar alerta"
            style={{
              background:  'transparent',
              border:      `1px solid ${SANGRE_BORDER}`,
              borderRadius: 6,
              color:       '#fca5a5',
              cursor:      'pointer',
              fontSize:    '0.8rem',
              padding:     '3px 9px',
              flexShrink:  0,
              fontWeight:  700,
              whiteSpace:  'nowrap',
            }}
          >
            ✕ Cerrar
          </button>
        </div>
      ))}

      {cerradas.length > 0 && (
        <div style={{
          background:   'rgba(139,0,0,0.06)',
          border:       '1px solid rgba(192,0,0,0.2)',
          borderRadius: 8,
          padding:      '8px 14px',
          fontSize:     '0.78rem',
          color:        'rgba(252,165,165,0.7)',
          fontStyle:    'italic',
        }}>
          Usted ya cerró esta alerta para siempre y por siempre.
        </div>
      )}
    </div>
  );
}

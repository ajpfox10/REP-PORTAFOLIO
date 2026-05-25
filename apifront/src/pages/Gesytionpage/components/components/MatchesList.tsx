// src/pages/GestionPage/components/MatchesList.tsx
import React, { useState } from 'react';

interface Props {
  matches: any[];
  onSelect: (dni: string) => void;
}

function copyToClipboard(text: string) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

export function MatchesList({ matches, onSelect }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  if (!matches.length) return null;

  const handleCopy = (e: React.MouseEvent, key: string, text: string) => {
    e.stopPropagation();
    copyToClipboard(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: 'none',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    cursor: 'pointer',
    padding: '3px 8px',
    fontSize: '0.78rem',
    color: active ? '#4ade80' : 'rgba(255,255,255,0.5)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  });

  return (
    <div className="card gp-card-14">
      <h3 className="gp-h3-top0">Coincidencias ({matches.length})</h3>
      <ul className="gp-match-list">
        {matches.map((m) => {
          const keyNombre = `nombre-${m.dni}`;
          const keyDni = `dni-${m.dni}`;
          return (
            <li key={m.dni} className="gp-match-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                className="btn"
                style={{ textAlign: 'left', flex: 1 }}
                onClick={() => onSelect(String(m.dni))}
              >
                <strong>{m.apellido}, {m.nombre}</strong>
                <span className="muted" style={{ marginLeft: 8, fontSize: '0.82rem' }}>
                  DNI {m.dni}
                  {m.estado_empleo && ` · ${m.estado_empleo}`}
                </span>
              </button>
              <button
                title="Copiar apellido y nombre"
                style={btnStyle(copied === keyNombre)}
                onClick={(e) => handleCopy(e, keyNombre, `${m.apellido}, ${m.nombre}`)}
              >
                {copied === keyNombre ? '✓' : '👤'}
              </button>
              <button
                title="Copiar DNI"
                style={btnStyle(copied === keyDni)}
                onClick={(e) => handleCopy(e, keyDni, String(m.dni))}
              >
                {copied === keyDni ? '✓' : '🪪'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

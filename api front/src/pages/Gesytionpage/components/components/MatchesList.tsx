// src/pages/GestionPage/components/MatchesList.tsx
import React from 'react';

interface Props {
  matches: any[];
  onSelect: (dni: string) => void;
}

export function MatchesList({ matches, onSelect }: Props) {
  if (!matches.length) return null;

  return (
    <div className="card gp-card-14">
      <h3 className="gp-h3-top0">Coincidencias ({matches.length})</h3>
      <ul className="gp-match-list">
        {matches.map((m) => (
          <li key={m.dni} className="gp-match-item">
            <button
              className="btn"
              style={{ textAlign: 'left', width: '100%' }}
              onClick={() => onSelect(String(m.dni))} // ← siempre string
            >
              <strong>{m.apellido}, {m.nombre}</strong>
              <span className="muted" style={{ marginLeft: 8, fontSize: '0.82rem' }}>
                DNI {m.dni}
                {m.estado_empleo && ` · ${m.estado_empleo}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

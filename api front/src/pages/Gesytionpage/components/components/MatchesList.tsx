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
      <h3 className="gp-h3-top0">Coincidencias</h3>
      <ul className="gp-match-list">
        {matches.map((m) => (
          <li key={m.dni} className="gp-match-item">
            <button className="btn" onClick={() => onSelect(m.dni)}>
              {m.apellido}, {m.nombre} (DNI {m.dni})
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
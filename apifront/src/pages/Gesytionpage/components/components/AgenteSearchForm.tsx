// src/pages/GestionPage/components/AgenteSearchForm.tsx
import React from 'react';

interface Props {
  dni: string;
  fullName: string;
  loading?: boolean;
  onDniChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFullNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearch: () => void;
  onSearchByName: () => void;
}

export function AgenteSearchForm({
  dni,
  fullName,
  loading,
  onDniChange,
  onFullNameChange,
  onSearch,
  onSearchByName
}: Props) {
  return (
    <div className="card gp-card-14">
      <div className="search-row">
        <div className="search-field">
          <label className="label">DNI</label>
          <input
            className="input"
            value={dni}
            onChange={onDniChange}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="Enter para buscar"
            disabled={loading}
          />
        </div>

        <div className="search-field">
          <label className="label">Nombre</label>
          <input
            className="input"
            value={fullName}
            onChange={onFullNameChange}
            onKeyDown={(e) => e.key === "Enter" && onSearchByName()}
            placeholder="Apellido Nombre (Enter)"
            disabled={loading}
          />
        </div>
      </div>

      <div className="muted gp-mt-10">
        Buscá por DNI o por Apellido/Nombre. Enter y a otra cosa 😎
      </div>
    </div>
  );
}
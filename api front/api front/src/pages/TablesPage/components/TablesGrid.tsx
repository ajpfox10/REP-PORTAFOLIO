// src/pages/TablesPage/components/TablesGrid.tsx
import React from 'react';
import { Link } from 'react-router-dom';

interface Props {
  tables: string[];
  loading: boolean;
  error: string | null;
}

export function TablesGrid({ tables, loading, error }: Props) {
  if (loading) {
    return <div className="muted">Cargando…</div>;
  }

  if (error) {
    return (
      <div className="muted">
        <div>Error: {error}</div>
        <button 
          className="btn" 
          onClick={() => window.location.reload()}
          style={{ marginTop: '10px' }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!tables.length) {
    return <div className="muted">No hay tablas disponibles.</div>;
  }

  return (
    <div className="grid">
      {tables.map((table) => (
        <Link key={table} className="tile" to={`/app/tables/${encodeURIComponent(table)}`}>
          <h3>{table}</h3>
          <p>Ver registros y exportar.</p>
        </Link>
      ))}
    </div>
  );
}
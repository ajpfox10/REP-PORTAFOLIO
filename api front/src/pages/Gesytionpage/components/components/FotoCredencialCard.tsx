// src/pages/GestionPage/components/FotoCredencialCard.tsx
import React from 'react';

interface Props {
  hasAgente: boolean;
  fotoUrl: string | null;
}

export function FotoCredencialCard({ hasAgente, fotoUrl }: Props) {
  return (
    <div className="card gp-card-14 gp-photo-card">
      <h3 className="gp-h3-top0">Foto credencial</h3>
      {!hasAgente ? (
        <p className="muted">Buscá un agente.</p>
      ) : fotoUrl ? (
        <img src={fotoUrl} alt="Foto credencial" className="gp-photo" />
      ) : (
        <p className="muted">Sin foto (o no autorizado).</p>
      )}
    </div>
  );
}
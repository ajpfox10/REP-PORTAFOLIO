// src/pages/GestionPage/components/AgenteInfoCard.tsx
import React from 'react';

interface Props {
  row: any;
}

export function AgenteInfoCard({ row }: Props) {
  if (!row) return null;

  return (
    <div className="card gp-card-14">
      <h3 className="gp-h3-top0">
        {row.apellido}, {row.nombre}
      </h3>

      <p><b>DNI:</b> {row.dni}</p>
      <p><b>CUIL:</b> {row.cuil || "-"}</p>
      <p><b>Ley:</b> {row.ley_nombre || row.ley_id}</p>
      <p><b>Dependencia:</b> {row.dependencia_nombre || "-"}</p>
      <p><b>Servicio:</b> {row.servicio_nombre || "-"}</p>
      <p><b>Desde:</b> {row.fecha_desde || "-"}</p>
      <p><b>Hasta:</b> {row.fecha_hasta ?? "Actual"}</p>
    </div>
  );
}
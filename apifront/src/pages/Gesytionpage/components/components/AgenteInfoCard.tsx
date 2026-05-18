// src/pages/GestionPage/components/AgenteInfoCard.tsx
import React from 'react';

interface Props {
  row: any;
}

function MiniCard({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="agente-mini-card">
      <span className="agente-mini-label">{label}</span>
      <span className="agente-mini-value">{value || "-"}</span>
    </div>
  );
}

function fmt(fecha?: string | null) {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return fecha;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function AgenteInfoCard({ row }: Props) {
  if (!row) return null;

  const servicio = row.servicios?.[0];

  return (
    <div className="card gp-card-14">
      <h3 className="gp-h3-top0">{row.apellido}, {row.nombre}</h3>

      {/* Datos de identificación */}
      <div className="agente-id-row">
        <span><b>DNI:</b> {row.dni}</span>
        <span><b>CUIL:</b> {row.cuil || "-"}</span>
        {row.legajo && <span><b>Leg.:</b> {row.legajo}</span>}
      </div>

      {/* Mini-cards: datos laborales */}
      <div className="agente-mini-grid">
        <MiniCard label="Ley"         value={row.ley_nombre} />
        <MiniCard label="Planta"      value={row.planta_nombre} />
        <MiniCard label="Categoría"   value={row.categoria_nombre} />
        <MiniCard label="Función"     value={row.funcion_nombre} />
        <MiniCard label="Régimen"     value={row.regimen_horario_nombre} />
        <MiniCard label="Estado"      value={row.estado_laboral} />
        <MiniCard label="Ingreso"     value={fmt(row.fecha_ingreso_laboral)} />
        <MiniCard label="Dependencia" value={servicio?.dependencia_nombre} />
      </div>

      {/* Servicio actual */}
      <div className="agente-servicio-block">
        <span className="agente-servicio-title">Servicio actual</span>
        <div className="agente-mini-grid">
          <MiniCard label="Servicio" value={servicio?.servicio_nombre} />
          <MiniCard label="Desde"   value={fmt(servicio?.fecha_desde)} />
          <MiniCard label="Hasta"   value={servicio?.fecha_hasta ? fmt(servicio.fecha_hasta) : "Actual"} />
        </div>
      </div>
    </div>
  );
}
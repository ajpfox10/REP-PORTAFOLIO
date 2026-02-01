// src/pages/DashboardPage/DashboardPage.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useDashboard } from './hooks/useDashboard';
import './styles/DashboardPage.css';

// Componentes inline (como en el original)
function Tile({ to, title, desc, disabled }: { to: string; title: string; desc: string; disabled?: boolean }) {
  const cls = `tile ${disabled ? 'disabled' : ''}`;
  if (disabled) {
    return (
      <div className={cls} aria-disabled="true">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    );
  }
  return (
    <Link className={cls} to={to}>
      <h3>{title}</h3>
      <p>{desc}</p>
    </Link>
  );
}

function StatTile({ to, title, desc, stat, disabled }: { to: string; title: string; desc: string; stat?: string; disabled?: boolean }) {
  const cls = `tile ${disabled ? 'disabled' : ''}`;
  const content = (
    <>
      <div className="row dash-stat-head">
        <h3 className="dash-stat-title">{title}</h3>
        {stat ? <span className="badge">{stat}</span> : null}
      </div>
      <p>{desc}</p>
    </>
  );
  if (disabled) return <div className={cls} aria-disabled="true">{content}</div>;
  return (
    <Link className={cls} to={to}>
      {content}
    </Link>
  );
}

export function DashboardPage() {
  const {
    pedidosTotal,
    canDocs,
    canTables,
    canGestion,
    canPedidos,
  } = useDashboard();

  return (
    <Layout title="Panel">
      <div className="grid">
        <Tile 
          to="/app/documents" 
          title="Documentos" 
          desc="Listado y visor PDF (tblarchivos)." 
          disabled={!canDocs} 
        />
        <Tile 
          to="/app/tables" 
          title="Consultas" 
          desc="Explorar tablas, vistas y reportes." 
          disabled={!canTables} 
        />
        <Tile 
          to="/app/info" 
          title="Información" 
          desc="Notas de acceso y configuración." 
        />
        <Tile 
          to="/app/gestion" 
          title="Gestión" 
          desc="Buscar agente por DNI (vista agentexdni1)." 
          disabled={!canGestion} 
        />

        <StatTile
          to="/app/tables/pedidos"
          title="Pedidos"
          desc="Ver pedidos y exportar (tabla pedidos)."
          stat={pedidosTotal === null ? '—' : `${pedidosTotal}`}
          disabled={!canPedidos}
        />
      </div>
    </Layout>
  );
}
import React from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useAuth } from '../auth/AuthProvider';

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

export function DashboardPage() {
  const { hasPerm } = useAuth();

  const canDocs = hasPerm('documents:read') || hasPerm('crud:*:*');
  const canTables = hasPerm('crud:*:read') || hasPerm('crud:*:*');
  const canGestion = hasPerm('crud:agentexdni1:read') || hasPerm('crud:*:*');

  return (
    <Layout title="Panel" >
      <div className="grid">
        <Tile to="/app/documents" title="Documentos" desc="Listado y visor PDF (tblarchivos)." disabled={!canDocs} />
        <Tile to="/app/tables" title="Tablas" desc="Explorar tablas y consultas." disabled={!canTables} />
        <Tile to="/app/info" title="Información" desc="Notas de acceso y configuración." />
        <Tile to="/app/gestion" title="Gestión" desc="Buscar agente por DNI (vista agentexdni1)." disabled={!canGestion} />

      </div>
    </Layout>
  );
}

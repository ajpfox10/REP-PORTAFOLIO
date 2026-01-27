import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useAuth } from '../auth/AuthProvider';
import { apiFetch } from '../api/http';
import { useToast } from '../ui/toast';

// 🎨 CSS de esta ruta (NO global): /src/pages/styles/DashboardPage.css
import './styles/DashboardPage.css';

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
      {/* Header del tile con badge a la derecha, sin estilos inline */}
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
  const { hasPerm } = useAuth();
  const toast = useToast();

  const [pedidosTotal, setPedidosTotal] = useState<number | null>(null);
  const pedidosOnce = useRef(false);

  const canDocs = hasPerm('documents:read') || hasPerm('crud:*:*');
  const canTables = hasPerm('crud:*:read') || hasPerm('crud:*:*');
  const canGestion = hasPerm('crud:agentexdni1:read') || hasPerm('crud:*:*');
  const canPedidos = hasPerm('crud:pedidos:read') || hasPerm('crud:*:read') || hasPerm('crud:*:*');

  useEffect(() => {
    // En dev con React.StrictMode, useEffect corre 2 veces: evitamos duplicar la request.
    if (pedidosOnce.current) return;
    pedidosOnce.current = true;

    if (!canPedidos) return;

    const ac = new AbortController();
    (async () => {
      try {
        const res = await apiFetch<any>(`/pedidos?page=1&limit=1`, { signal: ac.signal });
        const total = Number(res?.meta?.total);
        setPedidosTotal(Number.isFinite(total) ? total : 0);
      } catch (e: any) {
        if (e?.aborted) return;
        toast.error('No se pudo leer Pedidos', e?.message || 'Error');
        setPedidosTotal(null);
      }
    })();

    return () => ac.abort();
  }, [canPedidos]);

  return (
    <Layout title="Panel" >
      <div className="grid">
        <Tile to="/app/documents" title="Documentos" desc="Listado y visor PDF (tblarchivos)." disabled={!canDocs} />
        <Tile to="/app/tables" title="Consultas" desc="Explorar tablas, vistas y reportes." disabled={!canTables} />
        <Tile to="/app/info" title="Información" desc="Notas de acceso y configuración." />
        <Tile to="/app/gestion" title="Gestión" desc="Buscar agente por DNI (vista agentexdni1)." disabled={!canGestion} />

        {/* Dejar Pedidos abajo del bloque de datos */}
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

// src/components/Layout.tsx
import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Layout({ title, children, showBack }: {
  title: string;
  children: React.ReactNode;
  showBack?: boolean;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const { session, logout, hasPerm } = useAuth();

  const canWrite = hasPerm('personal:write') || hasPerm('crud:*:*');
  const isAdmin  = hasPerm('usuarios:write') || hasPerm('crud:*:*');
  const isFluid  = title === 'Gestión';
  const isActive = (p: string) => loc.pathname === p || loc.pathname.startsWith(p + '/');

  const navLink = (to: string, label: string) => (
    <Link className={`btn${isActive(to) ? ' active' : ''}`} to={to}>{label}</Link>
  );

  return (
    <div className={isFluid ? 'container-fluid' : 'container'}>
      <div className="topbar card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
          <div className="row" style={{ gap: '0.6rem' }}>
            {showBack
              ? <button className="btn" onClick={() => nav(-1)} type="button">← Volver</button>
              : <Link className="badge" to="/app">Inicio</Link>
            }
            <div>
              <div className="h1">{title}</div>
              {session && <div className="muted" style={{ marginTop: 2, fontSize: '0.75rem' }}>{session.user?.email ?? ''}</div>}
            </div>
          </div>

          <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
            {navLink('/app/gestion', '📋 Gestión')}
            {navLink('/app/consultas', '💬 Consultas')}
            {navLink('/app/pedidos', '📨 Pedidos')}
            {navLink('/app/documentos', '📂 Docs')}
            {navLink('/app/reportes', '🎂 Reportes')}
            {navLink('/app/tables', '⊞ Tablas')}
            {/* Alta Agentes — solo para quienes tienen permiso de escritura */}
            {canWrite && navLink('/app/carga-agente', '➕ Alta Agentes')}
            {/* Admin */}
            {isAdmin && navLink('/app/admin', '⚙ Admin')}
            <Link className="btn" to="/app/info">ℹ Info</Link>
            <button className="btn danger" onClick={() => logout()} type="button">Salir</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  );
}

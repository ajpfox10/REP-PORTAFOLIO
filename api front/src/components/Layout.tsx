import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Layout({ title, children, showBack }: { 
  title: string; 
  children: React.ReactNode; 
  showBack?: boolean;
}) {
  const nav = useNavigate();
  const { session, logout } = useAuth();

  return (
    <div className={title === 'Gestión' ? 'container-fluid' : 'container'}>
      {/* 🐉 ÚNICO CAMBIO: container-fluid para Gestión, container para el resto */}
      <div className="topbar card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            {showBack ? (
              <button className="btn" onClick={() => nav(-1)} type="button">Volver</button>
            ) : (
              <Link className="badge" to="/app">Inicio</Link>
            )}
            <div>
              <div className="h1">{title}</div>
              <div className="muted" style={{ marginTop: 2 }}>
                {session ? session.user.email : ''}
              </div>
            </div>
          </div>

          <div className="row">
            <Link className="btn" to="/app/info" type="button">Info</Link>
            <button className="btn danger" onClick={() => logout()} type="button">Salir</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  );
}
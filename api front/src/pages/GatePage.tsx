import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

// 🎨 CSS de esta ruta (NO global): /src/pages/styles/GatePage.css
import './styles/GatePage.css';

export function GatePage() {
  const { session } = useAuth();
  if (session) return <Navigate to="/app" replace />;

  return (
    <div className="container">
      <div className="card gate-card">
        <div className="h1 gate-title">Acceso</div>
        <div className="muted gate-subtitle">Inicie sesión para continuar.</div>

        <div className="row gate-actions">
          <Link className="btn primary" to="/login">Iniciar sesión</Link>
          <Link className="btn" to="/app/info">Ayuda / alta de usuario</Link>
        </div>

        <div className="sep" />
        <div className="muted">
          Registro público: no disponible en esta API. La creación de usuarios se realiza por administrador.
        </div>
      </div>
    </div>
  );
}

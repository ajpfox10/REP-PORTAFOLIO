import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function GatePage() {
  const { session } = useAuth();
  if (session) return <Navigate to="/app" replace />;

  return (
    <div className="container">
      <div className="card" style={{ padding: 20 }}>
        <div className="h1" style={{ marginBottom: 6 }}>Acceso</div>
        <div className="muted" style={{ marginBottom: 16 }}>Inicie sesión para continuar.</div>

        <div className="row" style={{ flexWrap: 'wrap' }}>
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

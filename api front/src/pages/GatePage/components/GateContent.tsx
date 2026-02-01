// src/pages/GatePage/components/GateContent.tsx
import React from 'react';
import { Link } from 'react-router-dom';

export function GateContent() {
  return (
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
  );
}
// src/pages/GatePage/components/GateContent.tsx
import React from 'react';
import { Link } from 'react-router-dom';

export function GateContent() {
  return (
    <div className="card gate-card">
      <div className="h1 gate-title">Acceso al Sistema</div>
      <div className="muted gate-subtitle">PersonalV5 · Gestión de Personal</div>

      <div className="row gate-actions" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <Link className="btn primary" to="/login">
          🔑 Iniciar sesión
        </Link>
        <Link className="btn" to="/solicitar-acceso">
          📝 Solicitar acceso
        </Link>
      </div>

      <div className="sep" />
      <div className="muted" style={{ fontSize: '0.78rem' }}>
        ¿Primera vez? Completá el formulario de solicitud. El administrador recibirá
        un aviso y activará tu cuenta. Recibirás un email de confirmación.
      </div>
    </div>
  );
}

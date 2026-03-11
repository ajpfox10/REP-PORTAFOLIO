// src/pages/LoginPage/components/LoginFooter.tsx
import React from 'react';
import { Link } from 'react-router-dom';

export function LoginFooter() {
  return (
    <>
      <div className="sep" />
      <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b' }}>
        ¿No tenés cuenta?{' '}
        <Link to="/solicitar-acceso" style={{ color: '#60a5fa', textDecoration: 'none' }}>
          Solicitá acceso →
        </Link>
      </div>
    </>
  );
}

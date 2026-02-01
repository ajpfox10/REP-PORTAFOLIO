// src/pages/LoginPage/components/LoginFooter.tsx
import React from 'react';

export function LoginFooter() {
  return (
    <>
      <div className="sep" />
      <div className="muted">
        Si no tiene usuario, cree uno en la tabla <code>usuarios</code> con <code>estado='activo'</code>.
      </div>
    </>
  );
}
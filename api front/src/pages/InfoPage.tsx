import React from 'react';
import { Layout } from '../components/Layout';

export function InfoPage() {
  return (
    <Layout title="Información" showBack>
      <div className="card" style={{ padding: 18 }}>
        <div className="h2">Acceso</div>
        <div className="muted" style={{ lineHeight: 1.6 }}>
          <p>Login: <code>/api/v1/auth/login</code> (email + password).</p>
          <p>El usuario debe tener <code>estado='activo'</code>.</p>
          <p>Alta por admin: ejecutar <code>node scripts/seedAdmin.mjs</code> en el backend.</p>
        </div>
        <div className="sep" />
        <div className="h2">Documentos</div>
        <div className="muted" style={{ lineHeight: 1.6 }}>
          <p>Listado: <code>/api/v1/documents</code></p>
          <p>Archivo: <code>/api/v1/documents/:id/file</code></p>
          <p>El backend usa <code>DOCUMENTS_BASE_DIR</code> (ruta UNC o local).</p>
        </div>
      </div>
    </Layout>
  );
}

// src/pages/ForbiddenPage/index.tsx
import React from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';

export function ForbiddenPage() {
  const { session } = useAuth();

  return (
    <Layout title="Acceso denegado" showBack>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>403 😶‍🌫️</h2>
        <p className="muted">
          No tenés permiso para ver esta pantalla. Si creés que es un error, pedí acceso al administrador.
        </p>

        <details style={{ marginTop: 12 }}>
          <summary className="muted">Ver detalle técnico</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(
              {
                user: session?.user ?? null,
                permissionsCount: session?.permissions?.length ?? 0,
              },
              null,
              2
            )}
          </pre>
        </details>
      </div>
    </Layout>
  );
}

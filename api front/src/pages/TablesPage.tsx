import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { apiFetch } from '../api/http';
import { useToast } from '../ui/toast';

// 🎨 CSS de esta ruta (NO global): /src/pages/styles/TablesPage.css
import './styles/TablesPage.css';

export function TablesPage() {
  const toast = useToast();
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const res = await apiFetch<any>('/tables');
        if (ok) setTables(res?.data || []);
      } catch (e: any) {
        toast.error('No se pudieron obtener las tablas', e?.message || 'Error');
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  return (
    <Layout title="Tablas" showBack>
      <div className="card tables-card">
        {loading ? (
          <div className="muted">Cargando…</div>
        ) : (
          <div className="grid">
            {tables.map((t) => (
              <Link key={t} className="tile" to={`/app/tables/${encodeURIComponent(t)}`}>
                <h3>{t}</h3>
                <p>Ver registros y exportar.</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

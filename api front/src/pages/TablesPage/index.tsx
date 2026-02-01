// src/pages/TablesPage/index.tsx
import React from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { useTablesData } from './hooks/useTablesData';
import { TablesGrid } from './components/TablesGrid';

// CSS si existe
import './styles/TablesPage.css';

export function TablesPage() {
  const toast = useToast();
  const tablesData = useTablesData();

  // Mostrar error con toast si hay
  React.useEffect(() => {
    if (tablesData.error) {
      toast.error('No se pudieron obtener las tablas', tablesData.error);
    }
  }, [tablesData.error, toast]);

  return (
    <Layout title="Tablas" showBack>
      <div className="card tables-card">
        <TablesGrid
          tables={tablesData.tables}
          loading={tablesData.loading}
          error={tablesData.error}
        />
      </div>
    </Layout>
  );
}
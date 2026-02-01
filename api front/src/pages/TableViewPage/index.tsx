// src/pages/TableViewPage/index.tsx
import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { useTableViewData } from './hooks/useTableViewData';
import { useTableViewPagination } from './hooks/useTableViewPagination';
import { TableViewControls } from './components/TableViewControls';
import { TableViewTable } from './components/TableViewTable';
import { TableViewExport } from './components/TableViewExport';
import { TableViewActionsCard } from './components/TableViewActionsCard';
import { CellModal } from './components/CellModal';
import { CellModalState } from './types';

// CSS de esta ruta
import './styles/TableViewPage.css';

export function TableViewPage() {
  const { table } = useParams();
  const toast = useToast();
  
  // Hooks para datos y paginación
  const { page, limit, setPage, setLimit, totalPages, ...paginationActions } = 
    useTableViewPagination(null);
  
  const { rows, meta, loading, error } = useTableViewData(table, page, limit);
  
  const [cellModal, setCellModal] = React.useState<CellModalState>(null);
  
  const title = useMemo(() => `Tabla: ${table || ''}`, [table]);

  // Mostrar error con toast si hay
  React.useEffect(() => {
    if (error) {
      toast.error('No se pudieron obtener las tablas', error);
    }
  }, [error, toast]);

  // Actualizar paginación cuando cambian los meta datos
  React.useEffect(() => {
    if (meta) {
      // Aquí podrías sincronizar si es necesario
    }
  }, [meta]);

  return (
    <Layout title={title} showBack>
      <div className="card tv-card-main">
        {/* Fila superior con exportación y estadísticas */}
        <div className="row tv-top-row">
          <TableViewExport tableName={table || ''} rows={rows} title={title} />
          
          <div className="row tv-top-stats">
            <div className="badge">
              {loading ? 'Cargando…' : `Filas: ${rows.length}`}
            </div>
            <div className="badge">
              Página {page} / {totalPages}
            </div>
          </div>
        </div>

        <div className="sep" />

        {/* Controles de paginación */}
        <TableViewControls
          page={page}
          totalPages={totalPages}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={setLimit}
        />

        <div className="sep" />

        {/* Tabla principal */}
        <TableViewTable
          rows={rows}
          onCellClick={setCellModal}
        />

        {/* Card de acciones debajo de los datos */}
        <div className="sep" />
        <TableViewActionsCard
          tableName={table || ''}
          rows={rows}
          title={title}
        />
      </div>

      {/* Modal para ver celda completa */}
      <CellModal
        modalState={cellModal}
        onClose={() => setCellModal(null)}
      />
    </Layout>
  );
}
// src/pages/TableViewPage/index.tsx
import React, { useEffect, useMemo } from 'react';
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
import './styles/TableViewPage.css';

export function TableViewPage() {
  const { table } = useParams();
  const toast = useToast();

  // Paginación — ahora sin initial null
  const pagination = useTableViewPagination();
  const { page, limit, setPage, setLimit, setMeta, totalPages, ...paginationActions } = pagination;

  // Datos: le pasamos page y limit del hook de paginación
  const { rows, meta, loading, error, reload } = useTableViewData(table, page, limit);

  // WIRE CRÍTICO: cada vez que llegan nuevos meta, los actualizamos en paginación
  // Esto es lo que estaba roto: meta se calculaba sobre null fijo → totalPages = 1 siempre
  useEffect(() => {
    if (meta) setMeta(meta);
  }, [meta]);

  const [cellModal, setCellModal] = React.useState<CellModalState>(null);
  const title = useMemo(() => `Tabla: ${table || ''}`, [table]);

  useEffect(() => {
    if (error) toast.error('No se pudieron obtener los datos', error);
  }, [error]);

  return (
    <Layout title={title} showBack>
      <div className="card tv-card-main">
        <div className="row tv-top-row">
          <TableViewExport tableName={table || ''} rows={rows} title={title} />
          <div className="row tv-top-stats">
            <div className="badge">{loading ? 'Cargando…' : `Filas: ${meta?.total ?? rows.length}`}</div>
            <div className="badge">Página {page} / {totalPages}</div>
            {meta && <div className="badge">Total DB: {meta.total}</div>}
          </div>
        </div>

        <div className="sep" />

        <TableViewControls
          page={page}
          totalPages={totalPages}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={(newLimit) => { setLimit(newLimit); setPage(1); }}
        />

        <div className="sep" />
        <TableViewTable rows={rows} onCellClick={setCellModal} />
        <div className="sep" />

        <TableViewActionsCard tableName={table || ''} rows={rows} title={title} />
      </div>

      <CellModal modalState={cellModal} onClose={() => setCellModal(null)} />
    </Layout>
  );
}

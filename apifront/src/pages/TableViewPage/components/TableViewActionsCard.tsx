// src/pages/TableViewPage/components/TableViewActionsCard.tsx
import React from 'react';
import { TableViewExport } from './TableViewExport';

interface TableViewActionsCardProps {
  tableName: string;
  rows: any[];
  title: string;
}

export function TableViewActionsCard({ tableName, rows, title }: TableViewActionsCardProps) {
  return (
    <div className="card tv-actions-card">
      <div className="row tv-actions-row">
        <div>
          <div className="row tv-actions-head">
            <h3 className="tv-actions-title">
              {tableName === 'pedidos' ? 'Pedidos' : 'Consultas'}
            </h3>
            <span className="badge">Exportación</span>
          </div>
          <p className="muted tv-actions-tip">
            Tip: si un campo viene largo, hacé click en la celda y se abre un formulario emergente para leerlo completo.
          </p>
        </div>
        <TableViewExport tableName={tableName} rows={rows} title={title} />
      </div>
    </div>
  );
}
// src/pages/TableViewPage/components/TableViewExport.tsx - VERSIÓN SIMPLIFICADA (con RBAC)
import React from 'react';
import { useAuth } from '../../../auth/AuthProvider';
import { useToast } from '../../../ui/toast';

interface TableViewExportProps {
  tableName: string;
  rows: any[];
  title: string;
}

export function TableViewExport({ tableName, rows, title }: TableViewExportProps) {
  const { canCrud } = useAuth();
  const toast = useToast();

  const canRead = canCrud(tableName, 'read');

  const handlePrint = () => {
    if (!canRead) return toast.warning('Sin permiso', 'No tenés permiso de lectura para exportar.');
    window.print();
  };

  const handleExportExcel = () => {
    if (!canRead) return toast.warning('Sin permiso', 'No tenés permiso de lectura para exportar.');
    alert(`Exportando ${rows.length} filas a Excel...`);
  };

  const handleExportPdf = () => {
    if (!canRead) return toast.warning('Sin permiso', 'No tenés permiso de lectura para exportar.');
    alert(`Exportando a PDF...`);
  };

  const handleExportWord = () => {
    if (!canRead) return toast.warning('Sin permiso', 'No tenés permiso de lectura para exportar.');
    alert(`Exportando a Word...`);
  };

  if (!canRead) {
    return (
      <div className="tv-export-actions">
        <span className="muted">Exportación bloqueada: no tenés permiso de lectura para esta tabla.</span>
      </div>
    );
  }

  return (
    <div className="row tv-export-actions">
      <button className="btn" type="button" onClick={handlePrint} disabled={!rows.length}>
        Imprimir
      </button>
      <button className="btn" type="button" onClick={handleExportExcel} disabled={!rows.length}>
        Excel
      </button>
      <button className="btn" type="button" onClick={handleExportPdf} disabled={!rows.length}>
        PDF
      </button>
      <button className="btn" type="button" onClick={handleExportWord} disabled={!rows.length}>
        Word
      </button>
    </div>
  );
}

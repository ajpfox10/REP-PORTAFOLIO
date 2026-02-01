// src/pages/TableViewPage/components/TableViewExport.tsx - VERSIÓN SIMPLIFICADA
import React from 'react';

interface TableViewExportProps {
  tableName: string;
  rows: any[];
  title: string;
}

export function TableViewExport({ tableName, rows, title }: TableViewExportProps) {
  // Funciones placeholder mientras se crean las reales
  const handlePrint = () => {
    console.log('Imprimir:', title, rows.length);
    window.print();
  };

  const handleExportExcel = () => {
    console.log('Exportar a Excel:', tableName);
    alert(`Exportando ${rows.length} filas a Excel...`);
  };

  const handleExportPdf = () => {
    console.log('Exportar a PDF:', title);
    alert(`Exportando a PDF...`);
  };

  const handleExportWord = () => {
    console.log('Exportar a Word:', title);
    alert(`Exportando a Word...`);
  };

  return (
    <div className="row tv-export-actions">
      <button 
        className="btn" 
        type="button" 
        onClick={handlePrint} 
        disabled={!rows.length}
      >
        Imprimir
      </button>
      <button 
        className="btn" 
        type="button" 
        onClick={handleExportExcel} 
        disabled={!rows.length}
      >
        Excel
      </button>
      <button 
        className="btn" 
        type="button" 
        onClick={handleExportPdf} 
        disabled={!rows.length}
      >
        PDF
      </button>
      <button 
        className="btn" 
        type="button" 
        onClick={handleExportWord} 
        disabled={!rows.length}
      >
        Word
      </button>
    </div>
  );
}
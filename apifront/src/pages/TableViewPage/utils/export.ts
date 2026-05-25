// src/utils/export.ts

/** Descarga un blob como archivo. Usa appendChild para compatibilidad con Firefox. */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function printTable(_title: string, _rows: any[]) {
  window.print();
}

export function exportToExcel(filename: string, rows: any[]) {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v).replace(/"/g, '""');
    return /[,"\n\r]/.test(s) ? `"${s}"` : s;
  };

  const csvContent = [
    headers.map(escape).join(','),
    ...rows.map(row => headers.map(h => escape((row as any)[h])).join(',')),
  ].join('\n');

  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : filename + '.csv');
}

export function exportToPdf(_title: string, _rows: any[]) {
  // Sin implementación aún — no hace nada en silencio
}

export function exportToWord(_title: string, _rows: any[]) {
  // Sin implementación aún — no hace nada en silencio
}

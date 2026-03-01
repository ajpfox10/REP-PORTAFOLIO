// src/utils/export.ts
export function printTable(title: string, rows: any[]) {
  console.log('Printing:', title, rows.length);
  window.print();
}

export function exportToExcel(filename: string, rows: any[]) {
  // Implementación básica
  const csvContent = rows.map(row => 
    Object.values(row).join(',')
  ).join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToPdf(title: string, rows: any[]) {
  console.log('Export to PDF:', title);
  alert('Funcionalidad de PDF en desarrollo');
}

export function exportToWord(title: string, rows: any[]) {
  console.log('Export to Word:', title);
  alert('Funcionalidad de Word en desarrollo');
}
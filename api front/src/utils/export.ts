import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';

type Row = Record<string, any>;

function toText(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function exportToExcel(filename: string, rows: Row[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'data');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  saveAs(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
}

export function exportToPdf(filename: string, rows: Row[]) {
  const doc = new jsPDF();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const body = rows.map((r) => cols.map((c) => toText(r[c])));
  autoTable(doc, { head: [cols], body });
  doc.save(`${filename}.pdf`);
}

export async function exportToWord(filename: string, rows: Row[]) {
  const cols = rows.length ? Object.keys(rows[0]) : [];

  const table = new Table({
    rows: [
      new TableRow({
        children: cols.map((c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, bold: true })] })] })),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: cols.map((c) => new TableCell({ children: [new Paragraph(toText(r[c]))] })),
          })
      ),
    ],
  });

  const doc = new Document({
    sections: [{ children: [new Paragraph({ text: filename, heading: 'Heading1' }), table] }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${filename}.docx`);
}

export function printTable(title: string, rows: Row[]) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const html = `
  <html><head><title>${title}</title>
  <style>
    body{font-family: system-ui,Segoe UI,Roboto,Arial; padding:16px;}
    table{border-collapse:collapse; width:100%;}
    th,td{border:1px solid #ccc; padding:6px 8px; font-size:12px;}
    th{background:#f2f2f2;}
  </style>
  </head><body>
  <h2>${title}</h2>
  <table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
  <tbody>
    ${rows
      .map((r) => `<tr>${cols.map((c) => `<td>${toText(r[c])}</td>`).join('')}</tr>`)
      .join('')}
  </tbody></table>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

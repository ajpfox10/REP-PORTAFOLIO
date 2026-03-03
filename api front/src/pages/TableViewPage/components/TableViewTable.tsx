// src/pages/TableViewPage/components/TableViewTable.tsx
import React from 'react';
import { TableRow, CellModalState } from '../types';

interface TableViewTableProps {
  rows: TableRow[];
  onCellClick: (cell: { col: string; value: string; rowIndex: number }) => void;
}

export function TableViewTable({ rows, onCellClick }: TableViewTableProps) {
  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="tv-tablewrap">
      <table className="table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx}>
              {cols.map((c) => (
                <td
                  key={c}
                  className="cell"
                  title="Click para ampliar"
                  onClick={() => onCellClick({ 
                    col: c, 
                    value: String(r[c] ?? ''), 
                    rowIndex: idx 
                  })}
                >
                  {String(r[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
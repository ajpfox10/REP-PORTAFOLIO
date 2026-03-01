// src/pages/TableViewPage/types.ts
export type Meta = {
  page: number;
  limit: number;
  total: number;
};

export type TableRow = Record<string, any>;

export type CellModalState = {
  col: string;
  value: string;
  rowIndex: number;
} | null;
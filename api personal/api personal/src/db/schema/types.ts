export type ColumnInfo = {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isAutoIncrement: boolean;
  maxLength: number | null;
};

export type ForeignKeyInfo = {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
};

export type TableInfo = {
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  uniques: Array<{ name: string; columns: string[] }>;
  foreignKeys: ForeignKeyInfo[];
};

export type SchemaSnapshot = {
  database: string;
  generatedAt: string;
  tables: Record<string, TableInfo>;
  hash: string;
};

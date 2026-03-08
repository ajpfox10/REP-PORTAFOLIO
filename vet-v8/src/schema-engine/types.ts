export type ColumnInfo = { name: string; dataType: string; isNullable: boolean; isPrimaryKey: boolean };
export type ForeignKeyInfo = { column: string; referencedTable: string; referencedColumn: string };
export type TableInfo = { name: string; columns: ColumnInfo[]; primaryKey: string[]; foreignKeys: ForeignKeyInfo[] };
export type SchemaGraph = { schemaVersion: number; tables: Record<string, TableInfo> };

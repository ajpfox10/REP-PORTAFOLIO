import { type Pool } from "mysql2/promise";
import { type SchemaGraph, type TableInfo, type ColumnInfo, type ForeignKeyInfo } from "./types.js";

export async function readSchemaVersion(pool: Pool): Promise<number> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_meta (schema_version INT NOT NULL DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");
  const [rows] = await pool.query<any[]>("SELECT schema_version FROM schema_meta LIMIT 1");
  if (!rows?.length) { await pool.query("INSERT INTO schema_meta (schema_version) VALUES (1)"); return 1; }
  return Number(rows[0].schema_version ?? 1);
}

export async function introspectSchema(pool: Pool, schemaVersion: number): Promise<SchemaGraph> {
  const [tables] = await pool.query<any[]>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type='BASE TABLE'"
  );

  const out: Record<string, TableInfo> = {};
  for (const t of tables) {
    const tableName = String(t.table_name);

    const [cols] = await pool.query<any[]>(
      `SELECT c.column_name, c.data_type, c.is_nullable,
              (k.constraint_name = 'PRIMARY') as is_pk
       FROM information_schema.columns c
       LEFT JOIN information_schema.key_column_usage k
         ON k.table_schema = c.table_schema
        AND k.table_name = c.table_name
        AND k.column_name = c.column_name
        AND k.constraint_name = 'PRIMARY'
      WHERE c.table_schema = DATABASE() AND c.table_name = ?
      ORDER BY c.ordinal_position`,
      [tableName]
    );

    const columns: ColumnInfo[] = cols.map((c) => ({
      name: String(c.column_name),
      dataType: String(c.data_type),
      isNullable: String(c.is_nullable).toUpperCase() === "YES",
      isPrimaryKey: Boolean(c.is_pk)
    }));

    const primaryKey = columns.filter(c => c.isPrimaryKey).map(c => c.name);

    const [fks] = await pool.query<any[]>(
      `SELECT k.column_name, k.referenced_table_name, k.referenced_column_name
       FROM information_schema.key_column_usage k
       WHERE k.table_schema = DATABASE()
         AND k.table_name = ?
         AND k.referenced_table_name IS NOT NULL`,
      [tableName]
    );

    const foreignKeys: ForeignKeyInfo[] = fks.map((fk) => ({
      column: String(fk.column_name),
      referencedTable: String(fk.referenced_table_name),
      referencedColumn: String(fk.referenced_column_name)
    }));

    out[tableName] = { name: tableName, columns, primaryKey, foreignKeys };
  }

  return { schemaVersion, tables: out };
}

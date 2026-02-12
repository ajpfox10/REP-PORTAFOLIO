import crypto from "crypto";
import { Sequelize, QueryTypes } from "sequelize";
import { ColumnInfo, ForeignKeyInfo, SchemaSnapshot, TableInfo } from "./types";
import { env } from "../../config/env";

type RawColumn = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: "YES" | "NO";
  COLUMN_DEFAULT: any;
  EXTRA: string | null;
  CHARACTER_MAXIMUM_LENGTH: number | null;
};

type RawKey = {
  TABLE_NAME: string;
  CONSTRAINT_NAME: string;
  CONSTRAINT_TYPE: string | null;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string | null;
  REFERENCED_COLUMN_NAME: string | null;
  UPDATE_RULE: string | null;
  DELETE_RULE: string | null;
};

type RawPk = { TABLE_NAME: string; COLUMN_NAME: string; ORDINAL_POSITION: number };

export const introspectSchema = async (sequelize: Sequelize): Promise<SchemaSnapshot> => {
  const db = env.DB_NAME;

  const columns = await sequelize.query<RawColumn>(
    `
    SELECT
      TABLE_NAME,
      COLUMN_NAME,
      DATA_TYPE,
      IS_NULLABLE,
      COLUMN_DEFAULT,
      EXTRA,
      CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = :db
    ORDER BY TABLE_NAME, ORDINAL_POSITION
    `,
    { type: QueryTypes.SELECT, replacements: { db } }
  );

  const pks = await sequelize.query<RawPk>(
    `
    SELECT k.TABLE_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS c
      ON c.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     AND c.TABLE_SCHEMA = k.TABLE_SCHEMA
     AND c.TABLE_NAME = k.TABLE_NAME
    WHERE c.CONSTRAINT_TYPE = 'PRIMARY KEY'
      AND k.TABLE_SCHEMA = :db
    ORDER BY k.TABLE_NAME, k.ORDINAL_POSITION
    `,
    { type: QueryTypes.SELECT, replacements: { db } }
  );

  const keys = await sequelize.query<RawKey>(
    `
    SELECT
      k.TABLE_NAME,
      k.CONSTRAINT_NAME,
      c.CONSTRAINT_TYPE,
      k.COLUMN_NAME,
      k.REFERENCED_TABLE_NAME,
      k.REFERENCED_COLUMN_NAME,
      rc.UPDATE_RULE,
      rc.DELETE_RULE
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS c
      ON c.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     AND c.TABLE_SCHEMA = k.TABLE_SCHEMA
     AND c.TABLE_NAME = k.TABLE_NAME
    LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      ON rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     AND rc.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA
    WHERE k.TABLE_SCHEMA = :db
    ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION
    `,
    { type: QueryTypes.SELECT, replacements: { db } }
  );

  const tableMap: Record<string, TableInfo> = {};

  for (const c of columns) {
    if (!tableMap[c.TABLE_NAME]) {
      tableMap[c.TABLE_NAME] = {
        name: c.TABLE_NAME,
        columns: [],
        primaryKey: [],
        uniques: [],
        foreignKeys: []
      };
    }

    const col: ColumnInfo = {
      name: c.COLUMN_NAME,
      dataType: String(c.DATA_TYPE || "varchar"),
      isNullable: c.IS_NULLABLE === "YES",
      columnDefault:
        c.COLUMN_DEFAULT === undefined ? null : c.COLUMN_DEFAULT === null ? null : String(c.COLUMN_DEFAULT),
      isAutoIncrement: (c.EXTRA || "").toLowerCase().includes("auto_increment"),
      maxLength: c.CHARACTER_MAXIMUM_LENGTH ?? null
    };

    tableMap[c.TABLE_NAME].columns.push(col);
  }

  for (const pk of pks) {
    if (!tableMap[pk.TABLE_NAME]) continue;
    tableMap[pk.TABLE_NAME].primaryKey.push(pk.COLUMN_NAME);
  }

  // Si PK incluye 'id', colapsamos a ['id'] (alineado al estándar)
  for (const t of Object.values(tableMap)) {
    const hasId = t.columns.some((c) => c.name === "id");
    if (!hasId) continue;

    if (t.primaryKey.includes("id") && (t.primaryKey.length !== 1 || t.primaryKey[0] !== "id")) {
      t.primaryKey = ["id"];
    } else if (!t.primaryKey.includes("id") && t.primaryKey.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[introspect] Warning: table '${t.name}' has column 'id' but PK is [${t.primaryKey.join(", ")}].`
      );
    }
  }

  const uniqByTable: Record<string, Record<string, string[]>> = {};
  const fkByTable: Record<string, Record<string, ForeignKeyInfo>> = {};

  for (const k of keys) {
    if (!tableMap[k.TABLE_NAME]) continue;

    // FK
    if (k.REFERENCED_TABLE_NAME && k.REFERENCED_COLUMN_NAME) {
      fkByTable[k.TABLE_NAME] = fkByTable[k.TABLE_NAME] || {};
      fkByTable[k.TABLE_NAME][k.CONSTRAINT_NAME] = fkByTable[k.TABLE_NAME][k.CONSTRAINT_NAME] || {
        name: k.CONSTRAINT_NAME,
        columns: [],
        refTable: k.REFERENCED_TABLE_NAME,
        refColumns: [],
        onDelete: k.DELETE_RULE,
        onUpdate: k.UPDATE_RULE
      };
      fkByTable[k.TABLE_NAME][k.CONSTRAINT_NAME].columns.push(k.COLUMN_NAME);
      fkByTable[k.TABLE_NAME][k.CONSTRAINT_NAME].refColumns.push(k.REFERENCED_COLUMN_NAME);
      continue;
    }

    // UNIQUE
    if (k.CONSTRAINT_TYPE === "UNIQUE" && k.CONSTRAINT_NAME && k.CONSTRAINT_NAME !== "PRIMARY") {
      uniqByTable[k.TABLE_NAME] = uniqByTable[k.TABLE_NAME] || {};
      uniqByTable[k.TABLE_NAME][k.CONSTRAINT_NAME] = uniqByTable[k.TABLE_NAME][k.CONSTRAINT_NAME] || [];
      uniqByTable[k.TABLE_NAME][k.CONSTRAINT_NAME].push(k.COLUMN_NAME);
    }
  }

  // 1 AUTO_INCREMENT por tabla
  for (const t of Object.values(tableMap)) {
    const autoCols = t.columns.filter((c) => c.isAutoIncrement).map((c) => c.name);
    if (autoCols.length <= 1) continue;

    const pk0 = t.primaryKey?.[0] || null;
    const chosen = autoCols.includes("id") ? "id" : pk0 && autoCols.includes(pk0) ? pk0 : autoCols[0];

    // eslint-disable-next-line no-console
    console.warn(
      `[introspect] Warning: table '${t.name}' has multiple AUTO_INCREMENT columns (${autoCols.join(
        ", "
      )}). Using '${chosen}'.`
    );

    for (const c of t.columns) {
      c.isAutoIncrement = c.name === chosen;
    }
  }

  for (const [t, m] of Object.entries(uniqByTable)) {
    for (const [name, cols] of Object.entries(m)) {
      tableMap[t].uniques.push({ name, columns: cols });
    }
  }

  for (const [t, m] of Object.entries(fkByTable)) {
    tableMap[t].foreignKeys = Object.values(m);
  }

  const hash = crypto.createHash("sha256").update(JSON.stringify(tableMap)).digest("hex");

  return {
    database: db,
    generatedAt: new Date().toISOString(),
    tables: tableMap,
    hash
  };
};

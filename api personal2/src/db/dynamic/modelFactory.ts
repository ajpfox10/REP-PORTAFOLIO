import { DataTypes, Model, Sequelize } from "sequelize";
import { SchemaSnapshot, TableInfo } from "../schema/types";

const mapType = (t: string, maxLength: number | null) => {
  const dt = (t || "").toLowerCase();

  if (dt === "bigint") return DataTypes.BIGINT;
  if (dt === "tinyint") return DataTypes.TINYINT;
  if (dt === "smallint") return DataTypes.SMALLINT;
  if (dt.includes("int")) return DataTypes.INTEGER;

  if (dt === "decimal" || dt === "numeric") return DataTypes.DECIMAL;
  if (dt === "float") return DataTypes.FLOAT;
  if (dt === "double") return DataTypes.DOUBLE;

  if (dt === "date") return DataTypes.DATEONLY;
  if (dt === "datetime" || dt === "timestamp") return DataTypes.DATE;

  if (dt === "json") return (DataTypes as any).JSON || DataTypes.TEXT;

  if (dt === "text" || dt.endsWith("text")) return DataTypes.TEXT;
  if (dt === "char") return DataTypes.CHAR(maxLength ?? 1);
  if (dt === "varchar") return DataTypes.STRING(maxLength ?? 255);

  return DataTypes.STRING(maxLength ?? 255);
};

export const buildModels = (sequelize: Sequelize, schema: SchemaSnapshot) => {
  const models: Record<string, typeof Model> = {};

  const defineTable = (table: TableInfo) => {
    const attrs: any = {};

    // Detectar auto_inc (solo 1)
    const autoIncCols = table.columns.filter((c) => c.isAutoIncrement).map((c) => c.name);
    let chosenAutoInc: string | null = null;

    if (autoIncCols.length > 0) {
      const pk0 = table.primaryKey?.[0];
      chosenAutoInc = pk0 && autoIncCols.includes(pk0) ? pk0 : autoIncCols[0];

      if (autoIncCols.length > 1) {
        // eslint-disable-next-line no-console
        console.warn(
          `[modelFactory] '${table.name}' tiene múltiples AUTO_INCREMENT: ${autoIncCols.join(
            ", "
          )}. Se usará solo '${chosenAutoInc}'.`
        );
      }
    }

    const pkSet = new Set<string>(table.primaryKey || []);
    const hasExplicitPk = pkSet.size > 0; // ✅ si el introspector detectó PK real
    // ✅ Para VIEWS: si NO hay PK explícita, tratamos "id" como PK si existe
    const hasIdColumn = table.columns.some((c) => c.name === "id");

    for (const c of table.columns) {
      attrs[c.name] = {
        type: mapType(c.dataType, c.maxLength),
        allowNull: c.isNullable,
        primaryKey: pkSet.has(c.name) || (!hasExplicitPk && hasIdColumn && c.name === "id"),
        autoIncrement: chosenAutoInc === c.name
      };

      if (c.columnDefault !== null) {
      const defRaw = String(c.columnDefault).trim();
      const typeRaw = String(c.dataType || "").toLowerCase();

      const isDateType =
  	  typeRaw === "datetime" ||
  	  typeRaw === "timestamp" ||
  	  typeRaw === "date";

      const isCurrentTs = defRaw.toUpperCase().includes("CURRENT_TIMESTAMP");

      // ✅ MySQL CURRENT_TIMESTAMP no es una fecha literal: es una expresión SQL.
      // Si lo dejamos como string, Sequelize lo parsea y termina en "Invalid date".
      if (isDateType && isCurrentTs) {
      attrs[c.name].defaultValue = Sequelize.literal("CURRENT_TIMESTAMP");
      } else {
     attrs[c.name].defaultValue = c.columnDefault;
       }
     }

    }

    const m = sequelize.define(table.name, attrs, {
      tableName: table.name,
      timestamps: false,
      freezeTableName: true
    });

    models[table.name] = m;
  };

  for (const table of Object.values(schema.tables)) defineTable(table);

  return models;
};

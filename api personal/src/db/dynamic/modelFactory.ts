import { DataTypes, Model, Sequelize } from "sequelize";
import { SchemaSnapshot, TableInfo } from "../schema/types";

const mapType = (t: string, maxLength: number | null) => {
  const dt = (t || "").toLowerCase();

  if (dt.includes("int")) return DataTypes.INTEGER;
  if (dt === "bigint") return DataTypes.BIGINT;
  if (dt === "tinyint") return DataTypes.TINYINT;
  if (dt === "smallint") return DataTypes.SMALLINT;
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

    for (const c of table.columns) {
      attrs[c.name] = {
        type: mapType(c.dataType, c.maxLength),
        allowNull: c.isNullable,
        primaryKey: table.primaryKey.includes(c.name),
        autoIncrement: c.isAutoIncrement
      };
      if (c.columnDefault !== null) attrs[c.name].defaultValue = c.columnDefault;
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

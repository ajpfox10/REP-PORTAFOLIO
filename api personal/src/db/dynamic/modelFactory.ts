import { DataTypes, Model, Sequelize, Op } from "sequelize"; // ✅ AGREGADO Op
import { SchemaSnapshot, TableInfo } from "../schema/types";
import { logger } from "../../logging/logger";

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
        logger.warn(
          `[modelFactory] '${table.name}' tiene múltiples AUTO_INCREMENT: ${autoIncCols.join(", ")}. Se usará '${chosenAutoInc}'.`
        );
      }
    }

    const pkSet = new Set<string>(table.primaryKey || []);
    const hasExplicitPk = pkSet.size > 0;
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

        if (isDateType && isCurrentTs) {
          attrs[c.name].defaultValue = Sequelize.literal("CURRENT_TIMESTAMP");
        } else {
          attrs[c.name].defaultValue = c.columnDefault;
        }
      }
    }

    // Verificar si la tabla tiene columna deleted_at
    const hasDeletedAt = table.columns.some(c => c.name === "deleted_at");

    const m = sequelize.define(table.name, attrs, {
      tableName: table.name,
      timestamps: false,
      freezeTableName: true,
      // ✅ Scope por defecto para soft delete
      defaultScope: hasDeletedAt ? {
        where: {
          deleted_at: null
        }
      } : undefined,
      // ✅ Scopes adicionales
      scopes: hasDeletedAt ? {
        withDeleted: {
          where: {}
        },
        onlyDeleted: {
          where: {
            deleted_at: { [Op.ne]: null } // ✅ CORREGIDO: Usa Op, NO Sequelize.Op
          }
        }
      } : undefined
    });

    models[table.name] = m;
  };

  for (const table of Object.values(schema.tables)) defineTable(table);

  return models;
};

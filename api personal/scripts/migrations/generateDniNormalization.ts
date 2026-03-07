import fs from "fs";
import path from "path";

type ColumnInfo = { name: string; dataType: string; isNullable: boolean; isAutoIncrement: boolean; maxLength: number | null };
type TableInfo = { name: string; columns: ColumnInfo[]; primaryKey: string[] };
type SchemaSnapshot = { tables: Record<string, TableInfo> };

const schemaPath = process.argv.find((a) => a.startsWith("--schema="))?.split("=")[1]
  || path.resolve(process.cwd(), ".cache/schema.json");

const outPath = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1]
  || path.resolve(process.cwd(), "db/migrations/003__dni_foreign_keys.sql");

function main() {
  if (!fs.existsSync(schemaPath)) {
    console.error(`No existe schema: ${schemaPath}`);
    process.exit(1);
  }

  const snap = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as SchemaSnapshot;

  const personal = snap.tables["personal"];
  if (!personal) {
    console.error("No existe tabla 'personal' en el schema.");
    process.exit(1);
  }

  if (personal.primaryKey.length !== 1 || personal.primaryKey[0] !== "dni") {
    console.error(`'personal' debe tener PK ['dni']. Actual: [${personal.primaryKey.join(", ")}]`);
    process.exit(1);
  }

  const stmts: string[] = [];
  stmts.push("-- 003__dni_foreign_keys.sql");
  stmts.push("-- Generado automáticamente: FKs hacia personal(dni) donde exista columna 'dni'");
  stmts.push("");
  stmts.push("SET FOREIGN_KEY_CHECKS = 0;");
  stmts.push("");

  for (const [tableName, t] of Object.entries(snap.tables)) {
    if (tableName === "personal") continue;

    const hasDni = t.columns.some((c) => c.name === "dni");
    if (!hasDni) continue;

    // Índice para FK
    const idxName = `idx_${tableName}__dni`;
    // Nombre FK
    const fkName = `fk_${tableName}__dni__personal_dni`;

    stmts.push(`-- ${tableName}`);
    stmts.push(`ALTER TABLE \`${tableName}\` ADD INDEX \`${idxName}\` (\`dni\`);`);
    stmts.push(
      `ALTER TABLE \`${tableName}\` ` +
        `ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (\`dni\`) REFERENCES \`personal\`(\`dni\`) ` +
        `ON UPDATE RESTRICT ON DELETE RESTRICT;`
    );
    stmts.push("");
  }

  stmts.push("SET FOREIGN_KEY_CHECKS = 1;");
  stmts.push("");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, stmts.join("\n"), "utf-8");

  console.log(`OK -> generado: ${outPath}`);
}

main();

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Pool } from "mysql2/promise";

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Runs ordered SQL migrations from src/migrations/tenant/*.sql
 * - Records in `migrations` table (name + checksum)
 * - Safe to rerun: skips already applied checksums
 */
export async function runTenantMigrations(tenantPool: Pool) {
  // Ensure tracking table exists
  await tenantPool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(128) NOT NULL,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_name (name)
    )
  `);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dir = path.join(__dirname, "tenant");

  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  } catch {
    // No migrations directory in some deployments
    return;
  }

  for (const f of files) {
    const full = path.join(dir, f);
    const sql = await readFile(full, "utf8");
    const checksum = sha256(sql);

    const [rows] = await tenantPool.query<any[]>("SELECT checksum FROM migrations WHERE name=? LIMIT 1", [f]);
    if (rows?.length) {
      // If checksum changed, we stop: immutable migrations.
      if (String(rows[0].checksum) !== checksum) {
        throw new Error(`Migration checksum mismatch for ${f}. Expected ${rows[0].checksum}, got ${checksum}`);
      }
      continue;
    }

    // Split by ; while keeping simple (assumes no ; inside strings)
    const stmts = sql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(Boolean);

    for (const stmt of stmts) {
      await tenantPool.query(stmt);
    }

    await tenantPool.query("INSERT INTO migrations (name, checksum) VALUES (?,?)", [f, checksum]);
  }
}

import fs from "fs";
import path from "path";
import { pool } from "./mysql.js";
async function ensureColumn(table, column, ddl) {
    const [rows] = await pool.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?", [table, column]);
    const exists = Number(rows[0]?.count || 0) > 0;
    if (!exists)
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
async function ensureScanJobSettingColumns() {
    await ensureColumn("scan_jobs", "source", "source VARCHAR(30) NOT NULL DEFAULT 'flatbed' AFTER priority");
    await ensureColumn("scan_jobs", "duplex", "duplex TINYINT NOT NULL DEFAULT 0 AFTER source");
    await ensureColumn("scan_jobs", "dpi", "dpi INT NULL AFTER duplex");
    await ensureColumn("scan_jobs", "color", "color TINYINT NULL AFTER dpi");
    await ensureColumn("scan_jobs", "auto_rotate", "auto_rotate TINYINT NULL AFTER color");
    await ensureColumn("scan_jobs", "blank_page_detection", "blank_page_detection TINYINT NULL AFTER auto_rotate");
    await ensureColumn("scan_jobs", "compression", "compression ENUM('low','medium','high') NULL AFTER blank_page_detection");
    await ensureColumn("scan_jobs", "output_format", "output_format ENUM('pdf','pdf_a','tiff','jpg') NULL AFTER compression");
    await pool.query("ALTER TABLE scan_jobs MODIFY COLUMN output_format ENUM('pdf','pdf_a','tiff','jpg') NULL").catch(() => { });
    await pool.query("ALTER TABLE scan_profiles MODIFY COLUMN output_format ENUM('pdf','pdf_a','tiff','jpg') NOT NULL DEFAULT 'pdf'").catch(() => { });
}
export async function migrate() {
    const schema = fs.readFileSync(path.resolve(process.cwd(), "../migrations/schema.sql"), "utf-8");
    // naive split by ; for demo. Replace with proper migrator in prod.
    const statements = schema.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
    for (const sql of statements) {
        await pool.query(sql);
    }
    await ensureScanJobSettingColumns();
}

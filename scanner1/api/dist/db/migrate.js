import fs from "fs";
import path from "path";
import { pool } from "./mysql.js";
export async function migrate() {
    const schema = fs.readFileSync(path.resolve(process.cwd(), "../migrations/schema.sql"), "utf-8");
    // naive split by ; for demo. Replace with proper migrator in prod.
    const statements = schema.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
    for (const sql of statements) {
        await pool.query(sql);
    }
}

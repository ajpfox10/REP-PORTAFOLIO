import type { Pool } from "mysql2/promise";

export async function ensureOutboxTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbox_events (
      id VARCHAR(64) PRIMARY KEY,
      event_type VARCHAR(64) NOT NULL,
      payload_json JSON NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      next_run_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL
    )
  `);
}

export async function addOutboxEvent(pool: Pool, evt: { id: string; event_type: string; payload: any }) {
  await ensureOutboxTable(pool);
  await pool.query(
    `INSERT INTO outbox_events (id, event_type, payload_json, status, created_at) VALUES (?,?,?,?,NOW())`,
    [evt.id, evt.event_type, JSON.stringify(evt.payload), "pending"]
  );
}

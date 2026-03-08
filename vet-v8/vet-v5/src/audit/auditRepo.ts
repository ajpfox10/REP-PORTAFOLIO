import { type Pool, type PoolConnection } from "mysql2/promise";
import crypto from "node:crypto";

// Singleton to track which pools already have the audit table
const auditReady = new WeakSet<Pool>();

export async function ensureAuditTable(pool: Pool) {
  if (auditReady.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auditoria_log (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      ts DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      seq BIGINT NOT NULL DEFAULT 0,
      prev_hash CHAR(64) NULL,
      hash CHAR(64) NOT NULL,
      actor_user_id VARCHAR(64),
      tenant_id VARCHAR(64),
      action VARCHAR(64),
      resource VARCHAR(128),
      resource_id VARCHAR(128),
      ip VARCHAR(64),
      user_agent VARCHAR(512),
      request_id VARCHAR(64),
      before_json JSON,
      after_json JSON,
      UNIQUE KEY uq_tenant_seq (tenant_id, seq),
      INDEX idx_tenant_ts (tenant_id, ts),
      INDEX idx_actor (actor_user_id),
      INDEX idx_resource (resource, resource_id)
    )
  `);
  auditReady.add(pool);
}

export type AuditEvent = {
  actor_user_id?: string;
  /** Alias: userId (normalized to actor_user_id) */
  userId?: string;
  tenant_id: string;
  /** Alias: tenantId (normalized to tenant_id) */
  tenantId?: string;
  action: string;
  resource: string;
  /** Alias: entity (normalized to resource) */
  entity?: string;
  resource_id?: string;
  /** Alias: entity_id (normalized to resource_id) */
  entity_id?: string;
  ip?: string;
  user_agent?: string;
  request_id?: string;
  before_json?: unknown;
  after_json?: unknown;
  /** Alias: metadata (normalized to after_json) */
  metadata?: unknown;
};

/**
 * Append an entry to the tamper-evident audit log.
 *
 * The chain is: hash = sha256(prev_hash || canonicalEventJson)
 * This is done inside a serialized transaction to prevent race conditions.
 */
export async function appendAudit(pool: Pool, ev: AuditEvent): Promise<void> {
  await ensureAuditTable(pool);

  // Normalize alias fields for backward compatibility with older call sites
  const tenantId = ev.tenant_id ?? ev.tenantId ?? "";
  const actorUserId = ev.actor_user_id ?? ev.userId ?? null;
  const resource = ev.resource ?? ev.entity ?? "unknown";
  const resourceId = ev.resource_id ?? ev.entity_id ?? null;
  const afterJson = ev.after_json ?? ev.metadata ?? null;

  const canonical = JSON.stringify({
    ts: new Date().toISOString(),
    actor_user_id: actorUserId,
    tenant_id: tenantId,
    action: ev.action,
    resource,
    resource_id: resourceId,
    ip: ev.ip ?? null,
    user_agent: ev.user_agent ?? null,
    request_id: ev.request_id ?? null,
    before: ev.before_json ?? null,
    after: afterJson,
  });

  // Use a connection with a lock to prevent the race condition on seq + prev_hash
  const conn: PoolConnection = await (pool as any).getConnection();
  try {
    await conn.beginTransaction();

    // GET_LOCK is per-connection-scoped — ensures only one writer at a time per tenant
    await conn.query("SELECT GET_LOCK(?, 5)", [`audit_chain_${tenantId}`]);

    const [lastRows] = await conn.query<any[]>(
      "SELECT seq, hash FROM auditoria_log WHERE tenant_id=? ORDER BY seq DESC LIMIT 1 FOR UPDATE",
      [tenantId]
    );
    const last = (lastRows as any[])?.[0];
    const prevHash: string | null = last?.hash ?? null;
    const nextSeq: number = Number(last?.seq ?? 0) + 1;

    const h = crypto.createHash("sha256").update(String(prevHash ?? "")).update(canonical).digest("hex");

    await conn.query(
      `INSERT INTO auditoria_log
        (actor_user_id, tenant_id, action, resource, resource_id, ip, user_agent, request_id, before_json, after_json, seq, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        actorUserId,
        tenantId,
        ev.action,
        resource,
        resourceId,
        ev.ip ?? null,
        ev.user_agent ?? null,
        ev.request_id ?? null,
        ev.before_json ? JSON.stringify(ev.before_json) : null,
        afterJson ? JSON.stringify(afterJson) : null,
        nextSeq,
        prevHash,
        h,
      ]
    );

    await conn.query("SELECT RELEASE_LOCK(?)", [`audit_chain_${tenantId}`]);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

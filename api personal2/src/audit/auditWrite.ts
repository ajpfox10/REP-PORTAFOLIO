import { Sequelize } from "sequelize";
import { Request } from "express";

const getIp = (req: Request) => {
  const xf = req.headers["x-forwarded-for"];
  const ipFromHeader = Array.isArray(xf) ? xf[0] : xf;
  return String(ipFromHeader || req.ip || req.socket.remoteAddress || "");
};

const getRequestId = (req: Request) =>
  (req as any).requestId || req.headers["x-request-id"] || null;

const safeJson = (v: any) => {
  try {
    if (v === undefined) return null;
    return JSON.stringify(v);
  } catch {
    return null;
  }
};

export type AuditWriteInput = {
  req: Request;
  sequelize: Sequelize;
  action: "create" | "update" | "delete";
  table: string;
  pkValue: string | number | null;
  before: any | null;
  after: any | null;
  statusCode: number;
  durationMs: number;
};

export async function auditWrite(i: AuditWriteInput) {
  try {
    const auth = (i.req as any).auth;
    const actorType = auth?.principalType ?? null;
    const actorId = auth?.principalId ?? null;

    await i.sequelize.query(
      `
      INSERT INTO audit_log
        (request_id, actor_type, actor_id, ip, method, route, status_code, duration_ms,
         action, entity_table, entity_pk, before_json, after_json, request_json)
      VALUES
        (:request_id, :actor_type, :actor_id, :ip, :method, :route, :status_code, :duration_ms,
         :action, :entity_table, :entity_pk, :before_json, :after_json, :request_json)
      `,
      {
        replacements: {
          request_id: getRequestId(i.req),
          actor_type: actorType,
          actor_id: actorId,
          ip: getIp(i.req),
          method: String(i.req.method || "").toUpperCase(),
          route: String(i.req.baseUrl + i.req.path).slice(0, 255),
          status_code: i.statusCode,
          duration_ms: i.durationMs,
          action: i.action,
          entity_table: i.table,
          entity_pk: i.pkValue === null ? null : String(i.pkValue),
          before_json: safeJson(i.before),
          after_json: safeJson(i.after),
          request_json: safeJson(i.req.body),
        },
      }
    );
  } catch {
    // Nunca romper la API por auditoría
  }
}

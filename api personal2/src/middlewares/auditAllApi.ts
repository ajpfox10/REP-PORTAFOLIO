import { Request, Response, NextFunction } from "express";
import { Sequelize } from "sequelize";

function safeJson(v: any): any {
  if (v === undefined) return null;
  if (v === null) return null;
  // Si ya es string, lo devolvemos (sirve para before_json/after_json también)
  if (typeof v === "string") return v;
  // request_json/response_json son JSON en MySQL -> mandamos objeto si es posible
  if (typeof v === "object") return v;
  return v;
}

/**
 * Auditoría global:
 * - NO rompe la API si falla (catch silencioso)
 * - Inserta en audit_log usando el esquema REAL que tenés en MySQL
 * - Toma la info de res.locals.audit (la setea el CRUD en writes, y ahora también /auth)
 */
export function auditAllApi(sequelize: Sequelize) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.on("finish", async () => {
      try {
        const durationMs = Date.now() - startedAt;

        // Si el handler no seteó audit, no hacemos nada (evita ruido)
        const a = (res.locals as any)?.audit;
        if (!a) return;

        // ✅ Actor: si el handler no lo mandó, tomamos el del authContext
        const auth = (req as any)?.auth;
        const actorIdFromAuth =
          auth?.principalType === "user" || auth?.principalType === "api_key"
            ? auth?.principalId
            : null;

        // Campos de tu audit_log real
        const usuarioId = a.usuario_id ?? actorIdFromAuth ?? null;
        const action = String(a.action || "").slice(0, 64);
        const tableName = a.table_name ? String(a.table_name).slice(0, 128) : null;
        const recordPk =
          a.record_pk === undefined || a.record_pk === null ? null : String(a.record_pk).slice(0, 128);

        const route = String(req.originalUrl || req.baseUrl + req.path || "").slice(0, 255);

        const xf = req.headers["x-forwarded-for"];
        const ipFromHeader = Array.isArray(xf) ? xf[0] : xf;
        const ip = String(ipFromHeader || req.ip || req.socket.remoteAddress || "").slice(0, 64);

        const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);

        const beforeJson = a.before_json ?? null;
        const afterJson = a.after_json ?? null;

        const requestId = (req as any)?.requestId ? String((req as any).requestId).slice(0, 64) : null;
        const actorType = a.actor_type ?? auth?.principalType ?? null;
        const actorId = a.actor_id ?? (actorIdFromAuth === null ? null : Number(actorIdFromAuth));
        const method = String(req.method || "").slice(0, 12);
        const statusCode = Number(res.statusCode || 0) || null;
        const durationMsInt = Number.isFinite(durationMs)
          ? Math.max(0, Math.min(2_147_483_647, Math.floor(durationMs)))
          : null;

        const entityTable = a.entity_table ?? null;
        const entityPk = a.entity_pk ?? null;

        // OJO: request/response pueden contener cosas sensibles.
        // Solo se guardan si el handler las setea explícitamente.
        const requestJson = safeJson(a.request_json ?? null);
        const responseJson = safeJson(a.response_json ?? null);

        await sequelize.query(
          `
          INSERT INTO audit_log
            (
              usuario_id, action, table_name, record_pk, route, ip, user_agent,
              before_json, after_json,
              created_at,
              request_id, actor_type, actor_id, method, status_code, duration_ms,
              entity_table, entity_pk,
              request_json, response_json
            )
          VALUES
            (
              :usuario_id, :action, :table_name, :record_pk, :route, :ip, :user_agent,
              :before_json, :after_json,
              NOW(),
              :request_id, :actor_type, :actor_id, :method, :status_code, :duration_ms,
              :entity_table, :entity_pk,
              :request_json, :response_json
            )
          `,
          {
            replacements: {
              usuario_id: usuarioId,
              action,
              table_name: tableName,
              record_pk: recordPk,
              route,
              ip,
              user_agent: userAgent,
              before_json: beforeJson,
              after_json: afterJson,
              request_id: requestId,
              actor_type: actorType,
              actor_id: actorId,
              method,
              status_code: statusCode,
              duration_ms: durationMsInt,
              entity_table: entityTable,
              entity_pk: entityPk,
              request_json: requestJson,
              response_json: responseJson,
            },
          }
        );
      } catch {
        // Nunca romper la API por auditoría
      }
    });

    next();
  };
}

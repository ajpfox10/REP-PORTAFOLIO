import { Request, Response, NextFunction } from "express";
import { Sequelize } from "sequelize";

/**
 * Auditoría global:
 * - NO rompe la API si falla (catch silencioso)
 * - Inserta en audit_log usando el esquema REAL que tenés en MySQL
 * - Toma la info de res.locals.audit (la setea el CRUD en writes)
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
        const action = String(a.action || "").slice(0, 32); // create/update/delete
        const tableName = String(a.table_name || "").slice(0, 128);
        const recordPk = a.record_pk === undefined || a.record_pk === null ? null : String(a.record_pk).slice(0, 255);

        const route = String(req.originalUrl || req.baseUrl + req.path || "").slice(0, 255);

        const xf = req.headers["x-forwarded-for"];
        const ipFromHeader = Array.isArray(xf) ? xf[0] : xf;
        const ip = String(ipFromHeader || req.ip || req.socket.remoteAddress || "").slice(0, 64);

        const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);

        const beforeJson = a.before_json ?? null;
        const afterJson = a.after_json ?? null;

        await sequelize.query(
          `
          INSERT INTO audit_log
            (usuario_id, action, table_name, record_pk, route, ip, user_agent, before_json, after_json, created_at)
          VALUES
            (:usuario_id, :action, :table_name, :record_pk, :route, :ip, :user_agent, :before_json, :after_json, NOW())
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
              after_json: afterJson
            }
          }
        );

        void durationMs;
      } catch {
        // Nunca romper la API por auditoría
      }
    });

    next();
  };
}

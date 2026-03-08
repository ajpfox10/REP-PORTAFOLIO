import { type RequestHandler } from "express";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { buildRlsFilter, buildRlsFilterStrict } from "../../security/rls/rls.js";
import { checkAbac } from "../../security/abac/abac.js";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ coerceTypes: true, allErrors: true });
addFormats(ajv as any);

/**
 * Parse cursor-based pagination from query params.
 * ?limit=50&cursor=<base64_encoded_last_id>
 */
function parsePagination(query: any): { limit: number; afterId: string | null } {
  const limit = Math.min(Math.max(parseInt(query.limit ?? "50", 10), 1), 500);
  const cursor = query.cursor ? Buffer.from(String(query.cursor), "base64").toString("utf8") : null;
  return { limit, afterId: cursor };
}

function encodeCursor(id: any): string {
  return Buffer.from(String(id)).toString("base64");
}

export function buildCrudHandlers(opts: any) {
  const { schemaEngine, policyEngine, planLimits } = opts;

  const list: RequestHandler = async (req, res, next) => {
    try {
      const { table } = req.params as any;
      const ctx = (req as any).ctx;

      policyEngine.requirePermission(ctx, `db:${table}:read`);
      if (!policyEngine.crudAllowedByYaml(table, "read")) throw new AppError("CRUD_NOT_ALLOWED", "Read not allowed", { table });

      const graph = await schemaEngine.getSchema(ctx.tenantId, ctx.tenantPool);
      if (!graph.tables[table]) throw new AppError("NOT_FOUND", "Table not found", { table });

      const denyCols = new Set(policyEngine.deniedColumns(table));
      const cols = graph.tables[table].columns.filter((c: any) => !denyCols.has(c.name)).map((c: any) => `\`${c.name}\``).join(",");

      const { limit, afterId } = parsePagination(req.query);
      const rls = buildRlsFilter({ table, tenantId: ctx.tenantId, userId: ctx.userId, sucursalId: ctx.sucursalId });
      
      let sql = `SELECT ${cols} FROM \`${table}\` WHERE ${rls.whereSql}`;
      const params: any[] = [...rls.params];
      const pk = graph.tables[table].primaryKey[0];

      if (afterId && pk) {
        sql += ` AND \`${pk}\` > ?`;
        params.push(afterId);
      }
      if (pk) sql += ` ORDER BY \`${pk}\` ASC`;
      sql += ` LIMIT ?`;
      params.push(limit + 1); // fetch one extra to detect next page

      const [rows] = await ctx.tenantPool.query<any[]>(sql, params);

      // ABAC filter on results
      const abacCtx = { userId: ctx.userId, sucursalId: ctx.sucursalId, veterinarioId: ctx.veterinarioId, roles: ctx.roles };
      const filtered = rows.filter((r: any) => checkAbac(abacCtx, r));

      const hasNext = filtered.length > limit;
      const data = hasNext ? filtered.slice(0, limit) : filtered;
      const nextCursor = hasNext && pk ? encodeCursor(data[data.length - 1][pk]) : null;

      res.json({
        data,
        meta: {
          requestId: (req as any).id,
          pagination: { limit, hasNext, nextCursor }
        },
        errors: []
      });
    } catch (e) { next(e); }
  };

  const getById: RequestHandler = async (req, res, next) => {
    try {
      const { table, id } = req.params as any;
      const ctx = (req as any).ctx;

      policyEngine.requirePermission(ctx, `db:${table}:read`);
      if (!policyEngine.crudAllowedByYaml(table, "read")) throw new AppError("CRUD_NOT_ALLOWED", "Read not allowed", { table });

      const graph = await schemaEngine.getSchema(ctx.tenantId, ctx.tenantPool);
      const t = graph.tables[table];
      if (!t) throw new AppError("NOT_FOUND", "Table not found", { table });
      if (t.primaryKey.length !== 1) throw new AppError("CRUD_NOT_ALLOWED", "Only single PK supported", { table });

      const denyCols = new Set(policyEngine.deniedColumns(table));
      const cols = t.columns.filter((c: any) => !denyCols.has(c.name)).map((c: any) => `\`${c.name}\``).join(",");

      const rls = buildRlsFilter({ table, tenantId: ctx.tenantId, userId: ctx.userId, sucursalId: ctx.sucursalId });
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT ${cols} FROM \`${table}\` WHERE \`${t.primaryKey[0]}\`=? AND ${rls.whereSql} LIMIT 1`,
        [id, ...rls.params]
      );

      const row = rows?.[0];
      if (!row) throw new AppError("NOT_FOUND", "Row not found");

      // ABAC check
      if (!checkAbac({ userId: ctx.userId, sucursalId: ctx.sucursalId, veterinarioId: ctx.veterinarioId, roles: ctx.roles }, row)) {
        throw new AppError("RBAC_DENIED", "ABAC: access denied to this resource");
      }

      res.json({ data: row, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  };

  const create: RequestHandler = async (req, res, next) => {
    try {
      const { table } = req.params as any;
      const ctx = (req as any).ctx;

      policyEngine.requirePermission(ctx, `db:${table}:create`);
      if (!policyEngine.crudAllowedByYaml(table, "create")) throw new AppError("CRUD_NOT_ALLOWED", "Create not allowed", { table });

      const graph = await schemaEngine.getSchema(ctx.tenantId, ctx.tenantPool);
      const t = graph.tables[table];
      if (!t) throw new AppError("NOT_FOUND", "Table not found", { table });

      // Optional plan limits
      if (planLimits && typeof planLimits.getLimits === "function") {
        const limits = await planLimits.getLimits(ctx.tenantId, ctx.plan);

        if (table === "users") {
          const [[{ cnt }]]: any = await ctx.tenantPool.query(
            "SELECT COUNT(*) as cnt FROM users WHERE tenant_id=?",
            [ctx.tenantId]
          );
          if (Number(cnt) >= Number(limits.max_users)) {
            throw new AppError("PLAN_LIMIT", "User limit reached for your plan", { limit: limits.max_users });
          }
        }

        if (table === "pacientes") {
          const [[{ cnt }]]: any = await ctx.tenantPool.query(
            "SELECT COUNT(*) as cnt FROM pacientes WHERE tenant_id=?",
            [ctx.tenantId]
          );
          if (Number(cnt) >= Number(limits.max_pacientes)) {
            throw new AppError("PLAN_LIMIT", "Pacientes limit reached for your plan", { limit: limits.max_pacientes });
          }
        }

        if (table === "turnos") {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), 1);
          const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          const [[{ cnt }]]: any = await ctx.tenantPool.query(
            "SELECT COUNT(*) as cnt FROM turnos WHERE tenant_id=? AND fecha_hora >= ? AND fecha_hora < ?",
            [ctx.tenantId, start, end]
          );
          if (Number(cnt) >= Number(limits.max_turnos_mes)) {
            throw new AppError("PLAN_LIMIT", "Monthly turnos limit reached for your plan", { limit: limits.max_turnos_mes });
          }
        }
      }

      const payload = { ...(req.body ?? {}) };
      // Auto-inject tenant and ownership fields
      if (t.columns.some((c: any) => c.name === "tenant_id")) payload.tenant_id = ctx.tenantId;
      if (t.columns.some((c: any) => c.name === "owner_user_id") && !payload.owner_user_id) payload.owner_user_id = ctx.userId ?? null;
      if (t.columns.some((c: any) => c.name === "sucursal_id") && !payload.sucursal_id && ctx.sucursalId) payload.sucursal_id = ctx.sucursalId;

      const denyCols = new Set(policyEngine.deniedColumns(table));
      const allowedCols = t.columns.filter((c: any) => !denyCols.has(c.name) && !c.isPrimaryKey);
      const keys = Object.keys(payload).filter(k => allowedCols.some((c: any) => c.name === k));
      if (!keys.length) throw new AppError("VALIDATION_ERROR", "No valid fields provided");

      const cols = keys.map(k => `\`${k}\``).join(",");
      const qs = keys.map(() => "?").join(",");
      const vals = keys.map(k => payload[k]);

      const [result] = await ctx.tenantPool.query<any>(`INSERT INTO \`${table}\` (${cols}) VALUES (${qs})`, vals);

      await appendAudit(ctx.tenantPool, {
        actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
        action: "create", resource: table, resource_id: String(result.insertId),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id, after_json: payload
      });

      res.status(201).json({ data: { insertId: result.insertId }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  };

  const update: RequestHandler = async (req, res, next) => {
    try {
      const { table, id } = req.params as any;
      const ctx = (req as any).ctx;

      policyEngine.requirePermission(ctx, `db:${table}:update`);
      if (!policyEngine.crudAllowedByYaml(table, "update")) throw new AppError("CRUD_NOT_ALLOWED", "Update not allowed", { table });

      const graph = await schemaEngine.getSchema(ctx.tenantId, ctx.tenantPool);
      const t = graph.tables[table];
      if (!t) throw new AppError("NOT_FOUND", "Table not found", { table });
      if (t.primaryKey.length !== 1) throw new AppError("CRUD_NOT_ALLOWED", "Only single PK supported", { table });

      // FIX: Load existing row BEFORE update for ABAC check and before_json audit
      const rls = buildRlsFilterStrict({ table, tenantId: ctx.tenantId, userId: ctx.userId, sucursalId: ctx.sucursalId });
      const [existing] = await ctx.tenantPool.query<any[]>(
        `SELECT * FROM \`${table}\` WHERE \`${t.primaryKey[0]}\`=? AND ${rls.whereSql} LIMIT 1`,
        [id, ...rls.params]
      );
      const before = existing?.[0];
      if (!before) throw new AppError("NOT_FOUND", "Row not found or access denied");

      // ABAC check on the existing row
      if (!checkAbac({ userId: ctx.userId, sucursalId: ctx.sucursalId, veterinarioId: ctx.veterinarioId, roles: ctx.roles }, before)) {
        throw new AppError("RBAC_DENIED", "ABAC: access denied to this resource");
      }

      const payload = req.body ?? {};
      const denyCols = new Set(policyEngine.deniedColumns(table));
      const allowedCols = t.columns.filter((c: any) => !denyCols.has(c.name) && !c.isPrimaryKey);
      const keys = Object.keys(payload).filter(k => allowedCols.some((c: any) => c.name === k));
      if (!keys.length) throw new AppError("VALIDATION_ERROR", "No valid fields provided");

      const setSql = keys.map(k => `\`${k}\`=?`).join(",");
      const vals = keys.map(k => payload[k]);

      // FIX: UPDATE now includes RLS filter
      await ctx.tenantPool.query(
        `UPDATE \`${table}\` SET ${setSql} WHERE \`${t.primaryKey[0]}\`=? AND ${rls.whereSql}`,
        [...vals, id, ...rls.params]
      );

      await appendAudit(ctx.tenantPool, {
        actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
        action: "update", resource: table, resource_id: String(id),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id, before_json: before, after_json: payload
      });

      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  };

  const remove: RequestHandler = async (req, res, next) => {
    try {
      const { table, id } = req.params as any;
      const ctx = (req as any).ctx;

      policyEngine.requirePermission(ctx, `db:${table}:delete`);
      if (!policyEngine.crudAllowedByYaml(table, "delete")) throw new AppError("CRUD_NOT_ALLOWED", "Delete not allowed", { table });

      const graph = await schemaEngine.getSchema(ctx.tenantId, ctx.tenantPool);
      const t = graph.tables[table];
      if (!t) throw new AppError("NOT_FOUND", "Table not found", { table });
      if (t.primaryKey.length !== 1) throw new AppError("CRUD_NOT_ALLOWED", "Only single PK supported", { table });

      // FIX: Load before_json BEFORE deleting (was after in original code)
      const rls = buildRlsFilterStrict({ table, tenantId: ctx.tenantId, userId: ctx.userId, sucursalId: ctx.sucursalId });
      const [existing] = await ctx.tenantPool.query<any[]>(
        `SELECT * FROM \`${table}\` WHERE \`${t.primaryKey[0]}\`=? AND ${rls.whereSql} LIMIT 1`,
        [id, ...rls.params]
      );
      const before = existing?.[0];
      if (!before) throw new AppError("NOT_FOUND", "Row not found or access denied");

      if (!checkAbac({ userId: ctx.userId, sucursalId: ctx.sucursalId, veterinarioId: ctx.veterinarioId, roles: ctx.roles }, before)) {
        throw new AppError("RBAC_DENIED", "ABAC: access denied to this resource");
      }

      // FIX: DELETE with RLS filter — cross-tenant delete now impossible
      await ctx.tenantPool.query(
        `DELETE FROM \`${table}\` WHERE \`${t.primaryKey[0]}\`=? AND ${rls.whereSql}`,
        [id, ...rls.params]
      );

      // FIX: Audit AFTER successful delete (not before like in original)
      await appendAudit(ctx.tenantPool, {
        actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
        action: "delete", resource: table, resource_id: String(id),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id, before_json: before
      });

      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  };

  return { list, getById, create, update, remove };
}

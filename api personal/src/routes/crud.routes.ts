import { Router, Request, Response, NextFunction } from "express";
import { Model, Sequelize, ModelStatic } from "sequelize";
import { SchemaSnapshot } from "../db/schema/types";
import { env } from "../config/env";
import { requireCrud, requireMetaRead } from "../middlewares/rbacCrud";

const parseList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

const pickQueryInt = (v: any, def: number, min: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};

const safeStringify = (v: any) => {
  try {
    if (v === undefined) return null;
    return JSON.stringify(v);
  } catch {
    return null;
  }
};

export const buildCrudRouter = (sequelize: Sequelize, schema: SchemaSnapshot) => {
  const router = Router();

  const allow = new Set(parseList(env.CRUD_TABLE_ALLOWLIST));
  const deny = new Set(parseList(env.CRUD_TABLE_DENYLIST));
  const strict = env.CRUD_STRICT_ALLOWLIST;

  const isAllowedTable = (table: string): boolean => {
    if (deny.has(table)) return false;
    if (allow.size) return allow.has(table);
    if (strict) return false;
    return true;
  };

  const guardTable = (req: Request, res: Response, next: NextFunction) => {
    const table = String(req.params.table || "");
    if (!table || !schema.tables?.[table] || !isAllowedTable(table)) {
      return res.status(404).json({ ok: false, error: "Tabla no encontrada" });
    }
    return next();
  };

  const guardWrite = (_req: Request, res: Response, next: NextFunction) => {
    if (!env.CRUD_READONLY) return next();
    return res.status(405).json({ ok: false, error: "Read-only (CRUD_READONLY=true)" });
  };

  const getModel = (table: string): ModelStatic<Model> | null => {
    const m = (sequelize.models as any)[table];
    return m ? (m as ModelStatic<Model>) : null;
  };

  const getPk = (table: string): string | null => {
    const t = schema.tables?.[table];
    const pk = t?.primaryKey?.[0];
    return pk || null;
  };

  // ✅ lista de tablas (RBAC)
  router.get("/tables", requireMetaRead, (_req, res) => {
    const all = Object.keys(schema.tables || {}).sort();
    const filtered = all.filter(isAllowedTable);
    res.json({ ok: true, data: filtered });
  });

  // ✅ LIST (RBAC read)
  router.get("/:table", requireCrud("read"), guardTable, async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const page = pickQueryInt(req.query.page, 1, 1);
    const limit = Math.min(pickQueryInt(req.query.limit, 50, 1), 200);
    const offset = (page - 1) * limit;

    const [rows, total] = await Promise.all([model.findAll({ limit, offset }), model.count()]);
    res.json({ ok: true, data: rows, meta: { page, limit, total } });
  });

  // ✅ GET BY ID (RBAC read)
  router.get("/:table/:id", requireCrud("read"), guardTable, async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const pk = getPk(table);
    if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

    const row = await model.findOne({ where: { [pk]: req.params.id } as any });
    if (!row) return res.status(404).json({ ok: false, error: "No encontrado" });

    res.json({ ok: true, data: row });
  });

  // ✅ CREATE (RBAC create)
  router.post("/:table", requireCrud("create"), guardTable, guardWrite, async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const pk = getPk(table);
    if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

    const created = await model.create(req.body);
    const createdJson = (created as any).toJSON ? (created as any).toJSON() : created;

    (res.locals as any).audit = {
      usuario_id: null,
      action: "create",
      table_name: table,
      record_pk: createdJson?.[pk] ?? null,
      before_json: null,
      after_json: safeStringify(createdJson),
    };

    res.status(201).json({ ok: true, data: created });
  });

  // ✅ UPDATE (RBAC update)
  router.put("/:table/:id", requireCrud("update"), guardTable, guardWrite, async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const pk = getPk(table);
    if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

    const before = await model.findOne({ where: { [pk]: req.params.id } as any });
    if (!before) return res.status(404).json({ ok: false, error: "No encontrado" });

    await model.update(req.body, { where: { [pk]: req.params.id } as any });

    const after = await model.findOne({ where: { [pk]: req.params.id } as any });

    const beforeJson = (before as any).toJSON ? (before as any).toJSON() : before;
    const afterJson = (after as any)?.toJSON ? (after as any).toJSON() : after;

    (res.locals as any).audit = {
      usuario_id: null,
      action: "update",
      table_name: table,
      record_pk: req.params.id,
      before_json: safeStringify(beforeJson),
      after_json: safeStringify(afterJson),
    };

    res.json({ ok: true, data: after });
  });

  // ✅ DELETE (RBAC delete)
  router.delete("/:table/:id", requireCrud("delete"), guardTable, guardWrite, async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const pk = getPk(table);
    if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

    const before = await model.findOne({ where: { [pk]: req.params.id } as any });
    if (!before) return res.status(404).json({ ok: false, error: "No encontrado" });

    const beforeJson = (before as any).toJSON ? (before as any).toJSON() : before;

    await model.destroy({ where: { [pk]: req.params.id } as any });

    (res.locals as any).audit = {
      usuario_id: null,
      action: "delete",
      table_name: table,
      record_pk: req.params.id,
      before_json: safeStringify(beforeJson),
      after_json: null,
    };

    res.json({ ok: true, data: { deleted: true } });
  });

  // ✅ PATCH (RBAC update) - update parcial
router.patch("/:table/:id", requireCrud("update"), guardTable, guardWrite, async (req: Request, res: Response) => {
  const table = req.params.table;
  const model = getModel(table);
  if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

  const pk = getPk(table);
  if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

  const before = await model.findOne({ where: { [pk]: req.params.id } as any });
  if (!before) return res.status(404).json({ ok: false, error: "No encontrado" });

  await model.update(req.body, { where: { [pk]: req.params.id } as any });

  const after = await model.findOne({ where: { [pk]: req.params.id } as any });

  const beforeJson = (before as any).toJSON ? (before as any).toJSON() : before;
  const afterJson = (after as any)?.toJSON ? (after as any).toJSON() : after;

  (res.locals as any).audit = {
    usuario_id: null,
    action: "patch",
    table_name: table,
    record_pk: req.params.id,
    before_json: safeStringify(beforeJson),
    after_json: safeStringify(afterJson),
  };

  res.json({ ok: true, data: after });
});


  return router;
};

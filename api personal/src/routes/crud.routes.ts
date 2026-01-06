import { Router, Request, Response } from "express";
import { Model, Sequelize, ModelStatic } from "sequelize";
import { SchemaSnapshot } from "../db/schema/types";

const pickQueryInt = (v: any, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

export const buildCrudRouter = (sequelize: Sequelize, schema: SchemaSnapshot) => {
  const router = Router();

  const getModel = (table: string): ModelStatic<Model> | null => {
  	const m = (sequelize.models as any)[table] as ModelStatic<Model> | undefined;
        return m ?? null;


  };

  router.get("/tables", (_req, res) => {
    res.json({ ok: true, data: Object.keys(schema.tables || {}).sort() });
  });

  router.get("/:table", async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const page = pickQueryInt(req.query.page, 1);
    const limit = Math.min(pickQueryInt(req.query.limit, 50), 200);
    const offset = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      model.findAll({ limit, offset }),
      model.count()
    ]);

    res.json({ ok: true, data: rows, meta: { page, limit, total } });
  });

  router.get("/:table/:id", async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const t = schema.tables[table];
    const pk = t?.primaryKey?.[0];
    if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

    const row = await model.findOne({ where: { [pk]: req.params.id } as any });
    if (!row) return res.status(404).json({ ok: false, error: "No encontrado" });

    res.json({ ok: true, data: row });
  });

  router.post("/:table", async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const created = await model.create(req.body);
    res.status(201).json({ ok: true, data: created });
  });

  router.put("/:table/:id", async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const t = schema.tables[table];
    const pk = t?.primaryKey?.[0];
    if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

    const [count] = await model.update(req.body, { where: { [pk]: req.params.id } as any });
    res.json({ ok: true, data: { updated: count } });
  });

  router.delete("/:table/:id", async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const t = schema.tables[table];
    const pk = t?.primaryKey?.[0];
    if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

    const count = await model.destroy({ where: { [pk]: req.params.id } as any });
    res.json({ ok: true, data: { deleted: count } });
  });

  return router;
};

// src/routes/crud.routes.ts
import { Router, Request, Response, NextFunction } from "express";
import { Model, Sequelize, ModelStatic, Op } from "sequelize";
import { SchemaSnapshot } from "../db/schema/types";
import { env } from "../config/env";
import { requireCrud, requireMetaRead } from "../middlewares/rbacCrud";
import { cacheMiddleware, cacheInvalidateTags } from "../infra/cache";
import { emitPedidoCreated, emitPedidoUpdated, emitPedidoDeleted } from '../socket/handlers/pedidos';
import JSZip from 'jszip';
import { Parser } from 'json2csv';

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

// ============================================
// FILTROS AVANZADOS
// ============================================
function buildWhereClause(query: any, schemaTable: any): any {
  const where: any = {};
  
  // Filtros exactos (?nombre=Juan)
  for (const [key, value] of Object.entries(query)) {
    if (key === 'page' || key === 'limit' || key === 'sort' || key === 'fields' || key === 'noCache') continue;
    if (key.startsWith('_')) continue;
    
    const column = schemaTable?.columns?.find((c: any) => c.name === key);
    if (!column) continue;
    
    where[key] = value;
  }
  
  // Filtros con operadores
  // ?dni_gt=30000000
  // ?nombre_contains=Pepe
  const operators = ['_gt', '_gte', '_lt', '_lte', '_ne', '_contains', '_startsWith', '_endsWith'];
  
  for (const [key, value] of Object.entries(query)) {
    for (const op of operators) {
      if (key.endsWith(op)) {
        const field = key.slice(0, -op.length);
        const column = schemaTable?.columns?.find((c: any) => c.name === field);
        if (!column) continue;
        
        if (!where[field]) where[field] = {};
        
        switch(op) {
          case '_gt': where[field][Op.gt] = value; break;
          case '_gte': where[field][Op.gte] = value; break;
          case '_lt': where[field][Op.lt] = value; break;
          case '_lte': where[field][Op.lte] = value; break;
          case '_ne': where[field][Op.ne] = value; break;
          case '_contains': where[field][Op.like] = `%${value}%`; break;
          case '_startsWith': where[field][Op.startsWith] = value; break;
          case '_endsWith': where[field][Op.endsWith] = value; break;
        }
      }
    }
  }
  
  return where;
}

// ============================================
// ORDENAMIENTO
// ============================================
function buildOrderClause(query: any): any[] {
  const order: any[] = [];
  
  if (query.sort) {
    const sorts = String(query.sort).split(',');
    for (const s of sorts) {
      const desc = s.startsWith('-');
      const field = desc ? s.slice(1) : s;
      order.push([field, desc ? 'DESC' : 'ASC']);
    }
  }
  
  return order;
}

// ============================================
// SELECCIÓN DE CAMPOS
// ============================================
function buildAttributesClause(query: any): any {
  if (query.fields) {
    return String(query.fields).split(',').map(f => f.trim());
  }
  return undefined;
}

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

  // GET /tables
  router.get("/tables", requireMetaRead, (_req, res) => {
    const all = Object.keys(schema.tables || {}).sort();
    const filtered = all.filter(isAllowedTable);
    res.json({ ok: true, data: filtered });
  });

  // ------------------------------------------------------------------------
  // GET /:table - LIST con FILTROS AVANZADOS y CACHE
  // ------------------------------------------------------------------------
  router.get(
    "/:table", 
    requireCrud("read"), 
    guardTable,
    cacheMiddleware({
      ttl: 300,
      tags: (req) => [`table:${req.params.table}`],
      condition: (req) => !req.query.noCache
    }),
    async (req: Request, res: Response) => {
      const table = req.params.table;
      const model = getModel(table);
      if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

      const page = pickQueryInt(req.query.page, 1, 1);
      const limit = Math.min(pickQueryInt(req.query.limit, 50, 1), 200);
      const offset = (page - 1) * limit;

      // ✅ FILTROS AVANZADOS
      const where = buildWhereClause(req.query, schema.tables?.[table]);
      const order = buildOrderClause(req.query);
      const attributes = buildAttributesClause(req.query);

      const options: any = { 
        limit, 
        offset,
        where: Object.keys(where).length ? where : undefined,
        order: order.length ? order : undefined,
        attributes
      };

      const [rows, total] = await Promise.all([
        model.findAll(options),
        model.count({ where: options.where })
      ]);
      
      res.json({ 
        ok: true, 
        data: rows, 
        meta: { 
          page, 
          limit, 
          total,
          filtered: rows.length,
          where: options.where,
          order: options.order
        } 
      });
    }
  );

  // ------------------------------------------------------------------------
  // GET /:table/:id - BY ID
  // ------------------------------------------------------------------------
  router.get(
    "/:table/:id", 
    requireCrud("read"), 
    guardTable,
    cacheMiddleware({
      ttl: 300,
      tags: (req) => [`table:${req.params.table}`, `row:${req.params.table}:${req.params.id}`]
    }),
    async (req: Request, res: Response) => {
      const table = req.params.table;
      const model = getModel(table);
      if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

      const pk = getPk(table);
      if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

      const row = await model.findOne({ where: { [pk]: req.params.id } as any });
      if (!row) return res.status(404).json({ ok: false, error: "No encontrado" });

      res.json({ ok: true, data: row });
    }
  );

  // ------------------------------------------------------------------------
  // GET /:table/export/:format - EXPORTACIÓN MASIVA
  // ------------------------------------------------------------------------
  router.get(
    '/:table/export/:format',
    requireCrud("read"),
    guardTable,
    async (req: Request, res: Response) => {
      try {
        const table = req.params.table;
        const format = req.params.format;
        const model = getModel(table);
        
        if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });
        
        // Obtener todos los registros (con límite de seguridad)
        const limit = Math.min(pickQueryInt(req.query.limit, 10000, 1), 50000);
        const where = buildWhereClause(req.query, schema.tables?.[table]);
        const order = buildOrderClause(req.query);
        
        const rows = await model.findAll({ 
          where: Object.keys(where).length ? where : undefined,
          order: order.length ? order : undefined,
          limit
        });
        
        const data = rows.map(r => (r as any).toJSON ? (r as any).toJSON() : r);
        
        if (format === 'json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="${table}_export.json"`);
          return res.json(data);
        }
        
        if (format === 'csv') {
          if (!data.length) {
            return res.status(404).json({ ok: false, error: 'No hay datos para exportar' });
          }
          
          const fields = Object.keys(data[0]);
          const json2csvParser = new Parser({ fields });
          const csv = json2csvParser.parse(data);
          
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${table}_export.csv"`);
          return res.send(csv);
        }
        
        if (format === 'zip') {
          const zip = new JSZip();
          
          // Agregar JSON
          zip.file(`${table}_export.json`, JSON.stringify(data, null, 2));
          
          // Agregar CSV si hay datos
          if (data.length) {
            const fields = Object.keys(data[0]);
            const json2csvParser = new Parser({ fields });
            const csv = json2csvParser.parse(data);
            zip.file(`${table}_export.csv`, csv);
          }
          
          const content = await zip.generateAsync({ type: 'nodebuffer' });
          
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${table}_export.zip"`);
          return res.send(content);
        }
        
        return res.status(400).json({ ok: false, error: 'Formato no soportado. Usá json, csv o zip' });
        
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err?.message || 'Error en exportación' });
      }
    }
  );

  // POST /:table - CREATE
  router.post("/:table", requireCrud("create"), guardTable, guardWrite, async (req: Request, res: Response) => {
    const table = req.params.table;
    const model = getModel(table);
    if (!model) return res.status(404).json({ ok: false, error: "Tabla no encontrada" });

    const pk = getPk(table);
    if (!pk) return res.status(400).json({ ok: false, error: "Tabla sin PK (no soportado)" });

    const created = await model.create(req.body);
    const createdJson = (created as any).toJSON ? (created as any).toJSON() : created;

    await cacheInvalidateTags([`table:${table}`]);

    if (table === 'pedidos' && createdJson?.dni) {
      emitPedidoCreated(createdJson.dni, createdJson);
    }

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

  // PUT /:table/:id - UPDATE
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
    const afterJson = (after as any)?.toJSON ? (after as any).toJSON() : after;

    await cacheInvalidateTags([`table:${table}`, `row:${table}:${req.params.id}`]);

    if (table === 'pedidos' && afterJson?.dni) {
      emitPedidoUpdated(afterJson.dni, afterJson);
    }

    (res.locals as any).audit = {
      usuario_id: null,
      action: "update",
      table_name: table,
      record_pk: req.params.id,
      before_json: safeStringify((before as any).toJSON ? (before as any).toJSON() : before),
      after_json: safeStringify(afterJson),
    };

    res.json({ ok: true, data: after });
  });

  // DELETE /:table/:id - DELETE
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

    await cacheInvalidateTags([`table:${table}`, `row:${table}:${req.params.id}`]);

    if (table === 'pedidos' && beforeJson?.dni) {
      emitPedidoDeleted(beforeJson.dni, parseInt(req.params.id, 10));
    }

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

  // PATCH /:table/:id - PARCIAL UPDATE
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
    const afterJson = (after as any)?.toJSON ? (after as any).toJSON() : after;

    await cacheInvalidateTags([`table:${table}`, `row:${table}:${req.params.id}`]);

    if (table === 'pedidos' && afterJson?.dni) {
      emitPedidoUpdated(afterJson.dni, afterJson);
    }

    (res.locals as any).audit = {
      usuario_id: null,
      action: "patch",
      table_name: table,
      record_pk: req.params.id,
      before_json: safeStringify((before as any).toJSON ? (before as any).toJSON() : before),
      after_json: safeStringify(afterJson),
    };

    res.json({ ok: true, data: after });
  });

  return router;
};
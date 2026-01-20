import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import { z } from "zod";
import { authContext } from "../middlewares/authContext";
import { requireCrud } from "../middlewares/rbacCrud";

const eventoSchema = z.object({
  dni: z.number().int().positive(),
  estado: z.string().min(1).default("ABIERTO"),
  fecha_inicio: z.string().optional(), // "YYYY-MM-DD"
  fecha_fin: z.string().optional(),
  titulo: z.string().max(255).optional(),
  descripcion: z.string().optional(),
  metadata: z.any().optional(),
});

const parse = <T>(schema: z.ZodSchema<T>, body: any) => schema.parse(body);

export const buildEventosRouter = (sequelize: Sequelize) => {
  const r = Router();

  r.use(authContext(sequelize));

  const insertEvento = async (tipo: string, req: Request, res: Response) => {
    const body = parse(eventoSchema, req.body);
    const auth = (req as any).auth;

    const [result] = await sequelize.query(
      `
      INSERT INTO eventos (dni, tipo, estado, fecha_inicio, fecha_fin, titulo, descripcion, metadata, created_by_api_key_id)
      VALUES (:dni, :tipo, :estado, :fi, :ff, :titulo, :desc, :meta, :createdBy)
      `,
      {
        replacements: {
          dni: body.dni,
          tipo,
          estado: body.estado ?? "ABIERTO",
          fi: body.fecha_inicio ?? null,
          ff: body.fecha_fin ?? null,
          titulo: body.titulo ?? null,
          desc: body.descripcion ?? null,
          meta: body.metadata ? JSON.stringify(body.metadata) : null,
          createdBy: auth?.principalType === "api_key" ? auth?.principalId : null,
        },
      }
    );

    res.status(201).json({ ok: true, data: { inserted: true, tipo, dni: body.dni, result } });
  };

  // CREATE LICENCIA
  r.post("/licencias", requireCrud("create"), (req, res) => insertEvento("LICENCIA", req, res));
  r.post("/citaciones", requireCrud("create"), (req, res) => insertEvento("CITACION", req, res));
  r.post("/sanciones", requireCrud("create"), (req, res) => insertEvento("SANCION", req, res));

  // LIST por DNI
  r.get("/dni/:dni", requireCrud("read"), async (req, res) => {
    const dni = Number(req.params.dni);
    const [rows] = await sequelize.query(
      `SELECT * FROM eventos WHERE dni = :dni ORDER BY id DESC LIMIT 200`,
      { replacements: { dni } }
    );
    res.json({ ok: true, data: rows });
  });

  // GET by id
  r.get("/:id", requireCrud("read"), async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await sequelize.query(`SELECT * FROM eventos WHERE id = :id LIMIT 1`, {
      replacements: { id },
    });
    const row = (rows as any[])[0];
    if (!row) return res.status(404).json({ ok: false, error: "No encontrado" });
    res.json({ ok: true, data: row });
  });

  // CERRAR evento
  r.put("/:id/cerrar", requireCrud("update"), async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await sequelize.query(`SELECT * FROM eventos WHERE id = :id LIMIT 1`, {
      replacements: { id },
    });
    const before = (rows as any[])[0];
    if (!before) return res.status(404).json({ ok: false, error: "No encontrado" });

    await sequelize.query(
      `UPDATE eventos SET estado = 'CERRADO' WHERE id = :id`,
      { replacements: { id } }
    );

    const [rows2] = await sequelize.query(`SELECT * FROM eventos WHERE id = :id LIMIT 1`, {
      replacements: { id },
    });

    res.json({ ok: true, data: { before, after: (rows2 as any[])[0] } });
  });

  return r;
};

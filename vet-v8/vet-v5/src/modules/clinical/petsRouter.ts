import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";

const PetIn = z.object({
  paciente_id: z.coerce.number().int().positive(),
  nombre: z.string().min(1),
  especie: z.string().min(1),
  raza: z.string().optional().nullable(),
  sexo: z.enum(["M", "H"]).optional().nullable(),
  nacimiento: z.string().optional().nullable(), // YYYY-MM-DD
});

export function buildPetsRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT m.id, m.paciente_id, m.nombre, m.especie, m.raza, m.sexo, m.nacimiento, m.created_at,
                p.nombre as duenio_nombre, p.apellido as duenio_apellido
           FROM mascotas m JOIN pacientes p ON p.id=m.paciente_id
          ORDER BY m.id DESC LIMIT 200`
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("staff")) throw new AppError("FORBIDDEN", "Insufficient role");
      const body = PetIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        "INSERT INTO mascotas (paciente_id, nombre, especie, raza, sexo, nacimiento, created_by) VALUES (?,?,?,?,?,?,?)",
        [body.paciente_id, body.nombre, body.especie, body.raza ?? null, body.sexo ?? null, body.nacimiento ?? null, ctx.userId ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, { tenant_id: ctx.tenantId, actor_user_id: ctx.userId, action: "create", resource: "mascotas", resource_id: String(id), after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}

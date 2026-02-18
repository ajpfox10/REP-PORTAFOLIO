import { Router, Request, Response, NextFunction } from "express";
import { Sequelize, QueryTypes } from "sequelize";
import { can } from "../middlewares/rbacCrud";
import { env } from "../config/env";
import { buildPersonalHistorialRouter } from './personal.historial.routes';

// ✅ RBAC sin depender de req.params.table (este endpoint no es el CRUD genérico)
function requireCrudFor(table: string, action: "read" | "create" | "update" | "delete") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE) return next();
    if (!env.AUTH_ENABLE) return next();

    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: "No autenticado" });

    if (!can(auth.permissions || [], table, action)) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }
    return next();
  };
}

const pickQueryInt = (v: any, def: number, min: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};

const cleanDigits = (s: string) => String(s || "").replace(/\D/g, "");
const normalizeLike = (s: string) => String(s || "").trim();

/**
 * GET /api/v1/personal/search
 * - ?dni= (exact)
 * - ?apellido= (LIKE)
 * - ?nombre= (LIKE)
 * - ?q= (atajo: busca en apellido/nombre y si es numérico también en dni)
 * - paginado: page/limit
 */
export function buildPersonalRouter(sequelize: Sequelize) {
  const router = Router();

  router.get(
    "/search",
    requireCrudFor("personal", "read"),
    async (req: Request, res: Response) => {
      const page = pickQueryInt(req.query.page, 1, 1);
      const limit = Math.min(pickQueryInt(req.query.limit, 20, 1), 200);
      const offset = (page - 1) * limit;

      const dni = cleanDigits(String(req.query.dni || ""));
      const apellido = normalizeLike(String(req.query.apellido || ""));
      const nombre = normalizeLike(String(req.query.nombre || ""));
      const qRaw = normalizeLike(String(req.query.q || ""));

      // ✅ Resolver criterios
      const qDigits = cleanDigits(qRaw);
      const hasAny = Boolean(dni || apellido || nombre || qRaw);
      if (!hasAny) {
        return res.status(400).json({ ok: false, error: "Parámetros requeridos: dni / apellido / nombre / q" });
      }

      const whereParts: string[] = [];
      const repl: Record<string, any> = { limit, offset };

      if (dni) {
        whereParts.push("p.dni = :dni");
        repl.dni = Number(dni);
      }

      if (!dni && (apellido || nombre)) {
        if (apellido) {
          whereParts.push("p.apellido LIKE :apellido");
          repl.apellido = `%${apellido}%`;
        }
        if (nombre) {
          whereParts.push("p.nombre LIKE :nombre");
          repl.nombre = `%${nombre}%`;
        }
      }

      // q: atajo amigable (apellido/nombre) + (dni si parece numérico)
      if (!dni && !apellido && !nombre && qRaw) {
        const like = `%${qRaw}%`;
        if (qDigits) {
          whereParts.push("(p.apellido LIKE :qLike OR p.nombre LIKE :qLike OR p.dni = :qDni)");
          repl.qLike = like;
          repl.qDni = Number(qDigits);
        } else {
          whereParts.push("(p.apellido LIKE :qLike OR p.nombre LIKE :qLike)");
          repl.qLike = like;
        }
      }

      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

      const baseSql = `
        FROM personal p
        ${where}
      `;

      const rowsSql = `
        SELECT p.dni, p.apellido, p.nombre
        ${baseSql}
        ORDER BY p.apellido ASC, p.nombre ASC
        LIMIT :limit OFFSET :offset
      `;

      const countSql = `
        SELECT COUNT(1) AS total
        ${baseSql}
      `;

      const [rows, countRows] = await Promise.all([
        sequelize.query(rowsSql, { replacements: repl, type: QueryTypes.SELECT }),
        sequelize.query(countSql, { replacements: repl, type: QueryTypes.SELECT }),
      ]);

      const total = Number((countRows as any)?.[0]?.total ?? 0);
      return res.json({ ok: true, data: rows, meta: { page, limit, total } });
    }
  );
  router.use('/', buildPersonalHistorialRouter(sequelize));
  return router;
}

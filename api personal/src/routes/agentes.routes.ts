import { Router, Request, Response, NextFunction } from "express";
import { Sequelize, QueryTypes } from "sequelize";
import { env } from "../config/env";
import { can } from "../middlewares/rbacCrud";
import fs from "fs";
import path from "path";
const VIEW_RESUMEN = "agentexdni1";
const VIEW_HISTORIAL = "agentehistorial";
console.log(">>> CARGADO agentes.routes.ts VERSION FOTO 2026-01-19");

// Directorio base donde viven las carpetas por DNI (ej: <BASE>/<DNI>/...)
// Recomendado: configurarlo por .env (DOCUMENTS_BASE_DIR)
const BASE_DIR = env.DOCUMENTS_BASE_DIR;

// Match flexible para archivos de foto (evita exigir el nombre exacto)
const FOTO_RE = /^credencial.*empleado.*final\.(jpg|jpeg|png|webp)$/i;

const asyncWrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const requireRead =
  (resource: string) => (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE) return next();
    if (!env.AUTH_ENABLE) return next();

    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: "No autenticado" });

    if (!can(auth.permissions || [], resource, "read")) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }
    return next();
  };

const pickInt = (v: any, def: number, min: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};

export const buildAgentesRouter = (sequelize: Sequelize) => {
 const r = Router();

  // ✅ LIST
  r.get(
    "/",
    requireRead(VIEW_RESUMEN),
    asyncWrap(async (req, res) => {
      const q = String(req.query.q || "").trim();
      const page = pickInt(req.query.page, 1, 1);
      const limit = Math.min(pickInt(req.query.limit, 50, 1), 200);
      const offset = (page - 1) * limit;

      const where = q ? `WHERE (dni LIKE :like OR apellido LIKE :like OR nombre LIKE :like)` : "";
      const like = `%${q}%`;

      const data = (await sequelize.query(
        `SELECT * FROM ${VIEW_RESUMEN} ${where} ORDER BY apellido, nombre LIMIT :limit OFFSET :offset`,
        { replacements: { like, limit, offset }, type: QueryTypes.SELECT }
      )) as any[];

      const totalRow = (await sequelize.query(
        `SELECT COUNT(*) AS total FROM ${VIEW_RESUMEN} ${where}`,
        { replacements: { like }, type: QueryTypes.SELECT }
      )) as any[];

      const total = Number(totalRow?.[0]?.total ?? 0);

      return res.json({ ok: true, data, meta: { page, limit, total } });
    })
  );
r.get(
  "/:dni/foto",
  requireRead(VIEW_RESUMEN), // si querés RBAC igual que el resto
  asyncWrap(async (req, res) => {
    const dni = String(req.params.dni || "").replace(/\D/g, "");
    if (!dni) return res.status(400).json({ ok: false, error: "DNI inválido" });

    const dir = path.join(env.DOCUMENTS_BASE_DIR, dni);


    if (!fs.existsSync(dir)) {
      return res.status(404).json({ ok: false, error: "Carpeta DNI no existe" });
    }

    const files = fs.readdirSync(dir);

    // Logs útiles para debug (no exponen el contenido de la foto)
    console.log("[foto] dni=", dni, "dir=", dir, "files=", files);

    // Busca la credencial con nombre flexible y extensiones comunes
    const fileName = files.find((f) => FOTO_RE.test(f));

    // Fallback legacy: nombre exacto viejo
    const legacyName = files.find((f) => /^CREDENCIAL EMPLEADO FINAL\.[^.]+$/i.test(f));
    const finalName = fileName || legacyName;

    if (!finalName) {
      return res.status(404).json({ ok: false, error: "Foto no encontrada" });
    }

    const fotoPath = path.join(dir, finalName);
    const ext = path.extname(finalName).toLowerCase();

    const contentType =
      ext === ".png" ? "image/png" :
      ext === ".webp" ? "image/webp" :
      "image/jpeg";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");

    return res.sendFile(fotoPath);
  })
);





  // ✅ HISTORIAL (ANTES que /:dni)
  r.get(
    "/:dni/historial",
    requireRead(VIEW_HISTORIAL),
    asyncWrap(async (req, res) => {
      const dni = String(req.params.dni || "").trim();

      const page = pickInt(req.query.page, 1, 1);
      const limit = Math.min(pickInt(req.query.limit, 50, 1), 200);
      const offset = (page - 1) * limit;

      const data = (await sequelize.query(
        `SELECT * FROM ${VIEW_HISTORIAL}
         WHERE dni = :dni
         ORDER BY fecha_desde DESC
         LIMIT :limit OFFSET :offset`,
        { replacements: { dni, limit, offset }, type: QueryTypes.SELECT }
      )) as any[];

      const totalRow = (await sequelize.query(
        `SELECT COUNT(*) AS total FROM ${VIEW_HISTORIAL} WHERE dni = :dni`,
        { replacements: { dni }, type: QueryTypes.SELECT }
      )) as any[];

      const total = Number(totalRow?.[0]?.total ?? 0);

      return res.json({ ok: true, data, meta: { page, limit, total } });
    })
  );

  // ✅ DETALLE DNI (SIEMPRE AL FINAL)
  r.get(
    "/:dni",
    requireRead(VIEW_RESUMEN),
    asyncWrap(async (req, res) => {
      const dni = String(req.params.dni || "").trim();

      const rows = (await sequelize.query(
        `SELECT * FROM ${VIEW_RESUMEN} WHERE dni = :dni LIMIT 1`,
        { replacements: { dni }, type: QueryTypes.SELECT }
      )) as any[];

      if (!rows.length) return res.status(404).json({ ok: false, error: "No encontrado" });
      return res.json({ ok: true, data: rows[0] });
    })
  );

  return r;
};
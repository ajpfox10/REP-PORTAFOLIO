import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { env } from "../config/env";

/**
 * Docs / OpenAPI
 * - No requiere dependencia extra (no swagger-ui)
 * - En production se protege por defecto (DOCS_PROTECT=true)
 * - El archivo es el que ya usás para el validator (OPENAPI_PATH)
 */

export const buildDocsRouter = () => {
  const r = Router();

  // helper simple para servir el YAML
  const serveYaml = (_req: Request, res: Response) => {
    const abs = path.resolve(process.cwd(), env.OPENAPI_PATH);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ ok: false, error: "No existe el archivo OpenAPI" });
    }
    res.setHeader("content-type", "text/yaml; charset=utf-8");
    return res.status(200).send(fs.readFileSync(abs, "utf8"));
  };

  // /docs -> redirect a /docs/openapi.yaml
  r.get("/", (_req, res) => res.redirect(302, `${env.DOCS_PATH.replace(/\/$/, "")}/openapi.yaml`));
  r.get("/openapi.yaml", serveYaml);

  return r;
};

export function docsProtect(req: Request, res: Response, next: NextFunction) {
  if (!env.DOCS_ENABLE) return res.status(404).json({ ok: false, error: "Docs disabled" });

  // En dev/test lo dejamos abierto por defecto
  if (env.NODE_ENV !== "production") return next();
  if (!env.DOCS_PROTECT) return next();

  // Si auth está apagado, no tiene sentido proteger (pero en prod debería estar ON)
  const auth = (req as any).auth;
  if (!auth) return res.status(401).json({ ok: false, error: "No autenticado" });

  // Regla mínima: quien tenga crud:*:* o crud:*:read puede leer docs.
  const perms = (auth?.permissions || []).map((x: any) => String(x).toLowerCase());
  const allowed = perms.includes("crud:*:*") || perms.includes("crud:*:read") || perms.includes("docs:read");
  if (!allowed) return res.status(403).json({ ok: false, error: "No autorizado" });

  return next();
}

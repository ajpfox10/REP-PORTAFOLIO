// src/routes/docs.routes.ts
import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import YAML from "yaml";
import { env } from "../config/env";

/**
 * Sirve el archivo OpenAPI en formato YAML o JSON.
 * AHORA la autorización se maneja en el middleware docsAuth (montado en index.ts)
 */
export const buildDocsRouter = () => {
  const r = Router();

  // Helper para servir YAML
  const serveYaml = (_req: Request, res: Response) => {
    const specPath = (env.ENABLE_OPENAPI_VALIDATION && env.OPENAPI_AUTO_GENERATE)
      ? env.OPENAPI_AUTO_OUTPUT
      : env.OPENAPI_PATH;
    
    const abs = path.resolve(process.cwd(), specPath);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ ok: false, error: "No existe el archivo OpenAPI" });
    }
    
    res.setHeader("content-type", "text/yaml; charset=utf-8");
    return res.status(200).send(fs.readFileSync(abs, "utf8"));
  };

  // Helper para servir JSON
  const serveJson = (_req: Request, res: Response) => {
    const specPath = (env.ENABLE_OPENAPI_VALIDATION && env.OPENAPI_AUTO_GENERATE)
      ? env.OPENAPI_AUTO_OUTPUT
      : env.OPENAPI_PATH;
  
    const abs = path.resolve(process.cwd(), specPath);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ ok: false, error: "No existe el archivo OpenAPI" });
    }
  
    const raw = fs.readFileSync(abs, "utf8");
    let obj: any;
  
    if (abs.endsWith(".yaml") || abs.endsWith(".yml")) {
      obj = YAML.parse(raw);
    } else {
      obj = JSON.parse(raw);
    }
  
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.status(200).send(JSON.stringify(obj, null, 2));
  };

  // Redirección y rutas
  r.get("/", (_req, res) => res.redirect(302, `${env.DOCS_PATH.replace(/\/$/, "")}/openapi.yaml`));
  r.get("/openapi.yaml", serveYaml);
  r.get("/openapi.json", serveJson);

  return r;
};

// ✅ ELIMINAR COMPLETAMENTE la función docsProtect (ya no se usa)
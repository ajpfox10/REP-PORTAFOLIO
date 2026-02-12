import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { env } from "../config/env";

/**
 * Foto credencial por DNI.
 * La foto vive en filesystem (carpeta/archivo asociado al DNI).
 * Endpoint: GET /api/v1/agentes/:dni/foto
 */

function cleanDni(raw: string) {
  return String(raw || "").replace(/\D/g, "");
}

function exists(p: string) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function findFotoPath(baseDir: string, dni: string): string | null {
  const base = path.resolve(baseDir);

  // 1) carpeta con el DNI: <base>/<dni>/(foto|credencial).(jpg|jpeg|png)
  const dniDir = path.join(base, dni);
  const names = ["foto", "credencial", "carnet", "imagen", "CREDENCIAL EMPLEADO FINAL"];
  const exts = [".jpg", ".jpeg", ".png", ".webp"];
  for (const n of names) {
    for (const e of exts) {
      const p = path.join(dniDir, `${n}${e}`);
      if (exists(p)) return p;
    }
  }

  // 2) carpeta fotos: <base>/fotos/<dni>.(ext)
  for (const e of exts) {
    const p = path.join(base, "fotos", `${dni}${e}`);
    if (exists(p)) return p;
  }

  // 3) archivo directo: <base>/<dni>.(ext)
  for (const e of exts) {
    const p = path.join(base, `${dni}${e}`);
    if (exists(p)) return p;
  }

  return null;
}

function contentTypeFromExt(p: string) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpeg" || ext === ".jpg") return "image/jpeg";
  return "application/octet-stream";
}

export function buildAgentesFotoRouter() {
  const router = Router();

  // GET /api/v1/agentes/:dni/foto
  router.get("/:dni/foto", async (req: Request, res: Response) => {
    try {
      const dni = cleanDni(req.params.dni);
      if (!dni) return res.status(400).json({ ok: false, error: "DNI inválido" });

      const file = findFotoPath(env.PHOTOS_BASE_DIR, dni);
      if (!file) return res.status(404).json({ ok: false, error: "Not found" });

      res.setHeader("Content-Type", contentTypeFromExt(file));
      res.setHeader("Cache-Control", "no-store");
      return res.sendFile(file);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Error" });
    }
  });

  return router;
}

import fs from "fs";
import path from "path";
import { env } from "../config/env";

export class FileSecurityError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Protege contra path traversal y symlink escape.
 * Devuelve un path real (realpath) validado dentro del baseDir.
 */
export function resolveSafeRealPath(baseDir: string, relativeOrAbs: string) {
  const base = path.resolve(String(baseDir || ""));
  if (!base) throw new FileSecurityError("base_dir_missing", "Base dir inválido", 500);

  const raw = String(relativeOrAbs || "").trim();
  if (!raw) throw new FileSecurityError("path_missing", "Ruta vacía", 400);

  // Si viene absoluto, lo usamos; si no, lo unimos al base
  const candidate = path.isAbsolute(raw) ? raw : path.join(base, raw);

  // normalizamos y resolvemos realpath (sigue symlinks)
  const resolved = path.resolve(candidate);

  // Primer guard: el path normalizado debe quedar adentro del base
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new FileSecurityError("path_traversal", "Ruta fuera del directorio permitido", 400);
  }

  // Segundo guard: realpath (evita symlink escape)
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw new FileSecurityError("file_not_found", "Archivo inexistente", 404);
  }

  if (!real.startsWith(base + path.sep) && real !== base) {
    throw new FileSecurityError("symlink_escape", "Ruta real fuera del directorio permitido", 400);
  }

  return real;
}

/**
 * Sniff básico por extensión (fallback).
 * Si ya tenés sniff real por magic bytes en otro módulo, esto no estorba.
 */
function sniffByExt(filePath: string) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const map: Record<string, { mime: string; ext: string }> = {
    pdf: { mime: "application/pdf", ext: "pdf" },
    jpg: { mime: "image/jpeg", ext: "jpg" },
    jpeg: { mime: "image/jpeg", ext: "jpg" },
    png: { mime: "image/png", ext: "png" },
    docx: {
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ext: "docx",
    },
    xlsx: {
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ext: "xlsx",
    },
  };
  return map[ext] || { mime: "application/octet-stream", ext: ext || "bin" };
}

function mimeAllowed(mime: string) {
  const mimeLower = String(mime || "").toLowerCase();

  const allowedList: string[] = Array.isArray(env.DOCUMENTS_ALLOWED_MIME)
    ? (env.DOCUMENTS_ALLOWED_MIME as string[])
    : [];

  const allowed = new Set<string>(allowedList.map((x: string) => String(x).toLowerCase()));

  if (!allowed.size) return true;

  if (allowed.has(mimeLower)) return true;

  // wildcard: "image/*"
  for (const a of allowed) {
    if (a.endsWith("/*")) {
      const prefix = a.replace("/*", "/");
      if (mimeLower.startsWith(prefix)) return true;
    }
  }

  return false;
}

/**
 * Valida:
 * - existe
 * - tamaño máximo
 * - MIME permitido (por sniff simple)
 */
export function validateDownloadFile(fullPath: string) {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    throw new FileSecurityError("file_not_found", "Archivo inexistente", 404);
  }

  if (!stat.isFile()) {
    throw new FileSecurityError("not_a_file", "Ruta no es un archivo", 400);
  }

  const maxBytes = Number(env.DOCUMENTS_MAX_BYTES || 0);
  if (maxBytes > 0 && stat.size > maxBytes) {
    throw new FileSecurityError("size_exceeded", "Archivo demasiado grande", 413);
  }

  const sniff = sniffByExt(fullPath);
  if (!mimeAllowed(sniff.mime)) {
    throw new FileSecurityError("mime_not_allowed", "Tipo de archivo no permitido", 415);
  }

  return { stat, sniff };
}

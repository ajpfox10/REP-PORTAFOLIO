import type { NextFunction, Request, Response } from "express";
import { hasPermission } from "../auth/permissions.js";

// Exige un permiso fino para ejecutar una ruta.
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ ok: false, error: "No autenticado" });
    if (!hasPermission(req.auth.permissions, permission)) {
      return res.status(403).json({ ok: false, error: "Sin permiso" });
    }
    return next();
  };
}

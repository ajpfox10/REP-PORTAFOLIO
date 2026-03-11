import type { Request, Response, NextFunction } from "express"
import { ApiError } from "./errorHandler.js"

export function requireTenant() {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Leer de header, query param, o usar tenant 1 como default
    const tenant = req.header("x-tenant") || req.header("x-tenant-id")
      || (req.query["tenant_id"] as string)
      || process.env.DEFAULT_TENANT_ID || "1"
    ;(req as any).tenant_id = Number(tenant)
    if (!Number.isFinite((req as any).tenant_id)) throw new ApiError(400, "invalid_tenant")
    next()
  }
}

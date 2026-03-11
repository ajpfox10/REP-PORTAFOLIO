import { ApiError } from "./errorHandler.js";
export function requireTenant() {
    return (req, _res, next) => {
        // Leer de header, query param, o usar tenant 1 como default
        const tenant = req.header("x-tenant") || req.header("x-tenant-id")
            || req.query["tenant_id"]
            || process.env.DEFAULT_TENANT_ID || "1";
        req.tenant_id = Number(tenant);
        if (!Number.isFinite(req.tenant_id))
            throw new ApiError(400, "invalid_tenant");
        next();
    };
}

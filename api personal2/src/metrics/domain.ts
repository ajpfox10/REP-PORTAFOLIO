import client from "prom-client";
import { registry } from "./prom";

// RBAC denies
export const rbacDenyTotal = new client.Counter({
  name: "rbac_deny_total",
  help: "Cantidad de accesos denegados por RBAC",
  labelNames: ["reason"] as const, // missing_auth | missing_permission
  registers: [registry],
});

// Descargas bloqueadas (path, mime, virus, etc.)
export const documentsBlockedTotal = new client.Counter({
  name: "documents_blocked_total",
  help: "Cantidad de documentos bloqueados por seguridad",
  labelNames: ["reason"] as const, // path_traversal | symlink_escape | mime_not_allowed | virus_detected | too_large | missing | other
  registers: [registry],
});

// Login outcomes
export const authLoginTotal = new client.Counter({
  name: "auth_login_total",
  help: "Resultados de login",
  labelNames: ["result"] as const, // ok | fail
  registers: [registry],
});

// Refresh reuse / invalid refresh (si aplica)
export const authRefreshTotal = new client.Counter({
  name: "auth_refresh_total",
  help: "Resultados de refresh",
  labelNames: ["result"] as const, // ok | fail | reuse
  registers: [registry],
});

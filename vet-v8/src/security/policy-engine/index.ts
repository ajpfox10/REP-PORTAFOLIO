import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { type AppConfig } from "../../config/types.js";
import { AppError } from "../../core/errors/appError.js";
import { hasPermission, defaultRolePerms } from "../rbac/rbacService.js";

export type CrudOp = "read" | "create" | "update" | "delete";
type CrudPolicy = { tables?: Record<string, any>; default: { allow: Record<CrudOp, boolean> } };

export function buildPolicyEngine(opts: { config: AppConfig }) {
  const policyPath = path.resolve(process.cwd(), "config/crud-policy.yaml");
  const policy = YAML.parse(fs.readFileSync(policyPath, "utf-8")) as CrudPolicy;

  function crudAllowedByYaml(table: string, op: CrudOp): boolean {
    if (opts.config.crudTableDenylist.includes(table)) return false;
    const t = policy.tables?.[table];
    if (t?.deny?.[op] === true) return false;
    if (t?.allow?.[op] === true) return true;
    if (opts.config.crudStrictAllowlist && !opts.config.crudTableAllowlist.includes(table)) return false;
    return Boolean(policy.default.allow[op]);
  }

  function deniedColumns(table: string): string[] {
    const t = policy.tables?.[table];
    return (t?.deny_columns ?? []).map(String);
  }

  function requirePermission(ctx: any, permission: string) {
    const roles: string[] = ctx?.roles ?? ["admin"];
    const perms = roles.flatMap(r => defaultRolePerms(r));
    if (!hasPermission(perms, permission)) throw new AppError("RBAC_DENIED", "Permission denied", { permission });
  }

  function policyAsCode(_ctx: any, _table: string, _op: CrudOp) {
    // Hook para reglas avanzadas: planes, feature flags, ABAC, plugins, etc.
    return true;
  }

  function hasPerm(permission: string, roles: string[]) {
    const perms = roles.flatMap(r => defaultRolePerms(r));
    return hasPermission(perms, permission);
  }

  function crudAllowed(table: string, op: CrudOp, roles: string[]) {
    // YAML gate + policy-as-code hook
    if (!crudAllowedByYaml(table, op)) return false;
    return policyAsCode({ roles }, table, op);
  }

  return { crudAllowedByYaml, crudAllowed, deniedColumns, requirePermission, policyAsCode, hasPermission: hasPerm };
}

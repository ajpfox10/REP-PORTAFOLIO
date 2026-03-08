import { type Pool } from "mysql2/promise";

export type PlanKey = "basic" | "pro" | "enterprise" | string;

export type PlanLimits = {
  max_users: number;
  max_pacientes: number;
  max_turnos_mes: number;
  max_files: number;
};

const PLAN_CATALOG: Record<string, PlanLimits> = {
  basic: { max_users: 5, max_pacientes: 500, max_turnos_mes: 2000, max_files: 200 },
  pro: { max_users: 25, max_pacientes: 5_000, max_turnos_mes: 20_000, max_files: 2_000 },
  enterprise: { max_users: 10_000, max_pacientes: 10_000_000, max_turnos_mes: 10_000_000, max_files: 10_000_000 }
};

export function buildPlanLimits(opts: { masterPool: Pool }) {
  async function getLimits(tenantId: string, plan: PlanKey): Promise<PlanLimits> {
    const base = PLAN_CATALOG[String(plan)] ?? PLAN_CATALOG.basic;
    const [rows] = await opts.masterPool.query<any[]>(
      "SELECT overrides_json FROM tenant_plan_overrides WHERE tenant_id=? LIMIT 1",
      [tenantId]
    );

    if (!rows?.length) return base;
    try {
      const overrides = JSON.parse(rows[0].overrides_json);
      return { ...base, ...overrides };
    } catch {
      return base;
    }
  }

  return { getLimits };
}

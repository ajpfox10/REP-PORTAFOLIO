import { type Pool } from "mysql2/promise";

export type TenantContext = {
  tenantId: string;
  dbName: string;
  tenantPool: Pool;
  plan?: string;
  region?: string;
  locale?: string;
  // Populated by auth middleware after JWT validation:
  userId?: string;
  roles?: string[];
  sucursalId?: string;
  veterinarioId?: string;
  sessionId?: string;
  actorUserId?: string;
  isImpersonated?: boolean;
  tokenVersion?: number;
};

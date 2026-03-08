export type ErrorCode =
  | "UNKNOWN"
  | "VALIDATION_ERROR"
  | "TENANT_NOT_FOUND"
  | "TENANT_DISABLED"
  | "RBAC_DENIED"
  | "FORBIDDEN"           // added v9: used by requireRole()
  | "CRUD_NOT_ALLOWED"
  | "DB_ERROR"
  | "NOT_FOUND"
  | "INTERNAL_ONLY"
  | "RATE_LIMITED"
  | "BILLING_ERROR"
  | "AUTH_REQUIRED"
  | "TOKEN_EXPIRED"
  | "MFA_STEP_UP_REQUIRED" // added v9: step-up MFA
  | "CONFIG_ERROR"         // added v9: buildRlsFilterStrict, JWT config errors
  | "PLAN_REQUIRED";       // added v9: plan guard

export const ErrorHttpStatus: Record<ErrorCode, number> = {
  UNKNOWN:             500,
  VALIDATION_ERROR:    400,
  TENANT_NOT_FOUND:    404,
  TENANT_DISABLED:     403,
  RBAC_DENIED:         403,
  FORBIDDEN:           403,
  CRUD_NOT_ALLOWED:    403,
  DB_ERROR:            500,
  NOT_FOUND:           404,
  INTERNAL_ONLY:       403,
  RATE_LIMITED:        429,
  BILLING_ERROR:       502,
  AUTH_REQUIRED:       401,
  TOKEN_EXPIRED:       401,
  MFA_STEP_UP_REQUIRED: 401,
  CONFIG_ERROR:        500,
  PLAN_REQUIRED:       403,
};

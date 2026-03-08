import { type ErrorCode } from "./errorCodes.js";
export type ApiErrorItem = { code: ErrorCode; message: string; details?: unknown };
export function errorResponse(opts: { requestId?: string; errors: ApiErrorItem[] }) { return { data: null, meta: { requestId: opts.requestId ?? null }, errors: opts.errors }; }

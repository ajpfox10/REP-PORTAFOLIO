import { type ErrorCode, ErrorHttpStatus } from "./errorCodes.js";
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = ErrorHttpStatus[code] ?? 500;
    this.details = details;
  }
}

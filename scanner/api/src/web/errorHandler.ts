import type { Request, Response, NextFunction } from "express"

export class ApiError extends Error {
  public status: number
  public code: string
  public details?: any
  constructor(status: number, code: string, message?: string, details?: any) {
    super(message || code)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err?.status || 500
  const code = err?.code || "internal_error"
  const message = err?.message || "internal_error"
  const request_id = (req as any).request_id

  res.status(status).json({
    error: code,
    message,
    request_id,
    details: err?.details
  })
}

import type { Request, Response, NextFunction } from "express"
import crypto from "crypto"

export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.header("x-request-id") || crypto.randomUUID()
    ;(req as any).request_id = id
    res.setHeader("x-request-id", id)
    next()
  }
}

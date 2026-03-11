import type { Request, Response, NextFunction } from "express"
import type { ZodSchema } from "zod"

export function validate(schema: ZodSchema, pick: "body" | "query" | "params") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.parse((req as any)[pick])
    ;(req as any)[pick] = parsed
    next()
  }
}

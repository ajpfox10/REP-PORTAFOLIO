import type { NextFunction, Request, RequestHandler, Response } from "express"

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

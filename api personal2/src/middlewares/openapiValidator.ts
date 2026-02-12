// src/middlewares/openapiValidator.ts
import type { RequestHandler } from "express";
import * as OAV from "express-openapi-validator";

/**
 * express-openapi-validator puede exportar de distintas formas según el build (CJS/ESM).
 * Esta función agarra la "middleware" donde exista y arma un RequestHandler único
 * (porque la librería devuelve un array de handlers).
 */
function resolveOavMiddleware(): (opts: any) => RequestHandler[] {
  const anyOav: any = OAV as any;

  const mw =
    anyOav?.middleware ||
    anyOav?.default?.middleware ||
    anyOav?.OpenApiValidator?.middleware ||
    anyOav?.default?.OpenApiValidator?.middleware;

  if (typeof mw !== "function") {
    throw new Error(
      "express-openapi-validator: no pude resolver .middleware(). Revisá la versión/exports."
    );
  }
  return mw;
}

export function openapiValidator(apiSpecPath: string): RequestHandler {
  const middlewareFactory = resolveOavMiddleware();

    // Ignoramos system routes para que JAMÁS se rompan por OpenAPI
  const ignore = (path: string) => {
    return (
      path === "/health" ||
      path === "/ready" ||
      path === "/api/v1/health" ||
      path === "/api/v1/ready" ||
      path === "/version" ||
      path === "/diag" ||
      path.startsWith("/metrics")
    );
  };


  const stack = middlewareFactory({
    apiSpec: apiSpecPath,
    validateRequests: true,
    validateResponses: false,
    ignorePaths: (req: any) => ignore(req?.path || req?.originalUrl || "")
  });

  // La librería devuelve un array -> lo convertimos a un handler único
  const handler: RequestHandler = (req, res, next) => {
    let i = 0;

    const run = (err?: any) => {
      if (err) return next(err);
      const fn = stack[i++];
      if (!fn) return next();
      // OpenApiRequestHandler es compatible con (req,res,next)
      (fn as any)(req, res, run);
    };

    run();
  };

  return handler;
}

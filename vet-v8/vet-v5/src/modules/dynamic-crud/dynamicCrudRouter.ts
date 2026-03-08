import { Router } from "express";
import { buildCrudHandlers } from "./handlers.js";
export function buildDynamicCrudRouter(opts: any) {
  const router = Router();
  router.use(opts.rateLimiter.perTenant());
  const h = buildCrudHandlers(opts);
  router.get("/:table", h.list);
  router.get("/:table/:id", h.getById);
  router.post("/:table", h.create);
  router.patch("/:table/:id", h.update);
  router.delete("/:table/:id", h.remove);
  return router;
}

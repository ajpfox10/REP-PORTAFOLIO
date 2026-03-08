import { Router } from "express";
import { buildProductsRouter } from "./productsRouter.js";
import { buildStockRouter } from "./stockRouter.js";
import { buildSalesRouter } from "./salesRouter.js";

export function buildInventoryRouter() {
  const router = Router();
  router.use("/products", buildProductsRouter());
  router.use("/stock", buildStockRouter());
  router.use("/sales", buildSalesRouter());
  return router;
}

import { Router } from "express";
import { buildAgendaRulesRouter } from "./rulesRouter.js";
import { buildHolidaysRouter } from "./holidaysRouter.js";
import { buildAvailabilityRouter } from "./availabilityRouter.js";

export function buildAgendaRouter() {
  const router = Router();
  router.use("/rules", buildAgendaRulesRouter());
  router.use("/holidays", buildHolidaysRouter());
  router.use("/availability", buildAvailabilityRouter());
  return router;
}

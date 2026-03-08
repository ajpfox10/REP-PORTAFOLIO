import { Router } from "express";
import { buildPatientsRouter } from "./patientsRouter.js";
import { buildPetsRouter } from "./petsRouter.js";
import { buildVisitsRouter } from "./visitsRouter.js";
import { buildClinicalRecordsRouter } from "./recordsRouter.js";

export function buildClinicalRouter() {
  const router = Router();
  router.use("/patients", buildPatientsRouter());
  router.use("/pets", buildPetsRouter());
  router.use("/visits", buildVisitsRouter());
  router.use("/records", buildClinicalRecordsRouter());
  return router;
}

import { Router } from "express"
import client from "prom-client"

const registry = new client.Registry()
client.collectDefaultMetrics({ register: registry })

export const scanJobsTotal = new client.Counter({
  name: "scan_jobs_total",
  help: "Total scan jobs",
  labelNames: ["tenant_id", "status"]
})
export const scanDurationSeconds = new client.Histogram({
  name: "scan_duration_seconds",
  help: "Scan duration seconds",
  labelNames: ["tenant_id"]
})

registry.registerMetric(scanJobsTotal)
registry.registerMetric(scanDurationSeconds)

export const metricsRouter = Router()
metricsRouter.get("/", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType)
  res.send(await registry.metrics())
})

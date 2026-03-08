import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";

const Q = z.object({
  resource_type: z.enum(["vet", "sucursal"]).default("vet"),
  resource_id: z.string().min(1),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function fromMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

export function buildAvailabilityRouter() {
  const router = Router();

  /**
   * GET /api/v1/agenda/availability?resource_type=vet&resource_id=...&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
   * Returns suggested slots from rules minus holidays (and minus booked appointments if table exists).
   */
  router.get("/", async (req, res, next) => {
    try {
      const { resource_type, resource_id, dateFrom, dateTo } = Q.parse(req.query);
      const ctx = (req as any).ctx;
      const pool = ctx.tenantPool;
      if (!pool) throw new AppError("TENANT_REQUIRED", "Tenant DB requerida", 400);

      const [rules] = await pool.query(
        `SELECT * FROM agenda_rules WHERE resource_type=? AND resource_id=? AND active=1`,
        [resource_type, resource_id]
      ) as any[];

      const [holidays] = await pool.query(
        `SELECT date, blocked FROM agenda_holidays WHERE date BETWEEN ? AND ? AND blocked=1`,
        [dateFrom, dateTo]
      ) as any[];

      const holidaySet = new Set((holidays || []).map((h: any) => String(h.date).slice(0,10)));

      // appointments optional
      let apptSet = new Set<string>();
      try {
        const [appts] = await pool.query(
          `SELECT date, start_time FROM agenda_appointments WHERE resource_type=? AND resource_id=? AND date BETWEEN ? AND ? AND status='booked'`,
          [resource_type, resource_id, dateFrom, dateTo]
        ) as any[];
        apptSet = new Set((appts || []).map((a: any) => `${String(a.date).slice(0,10)}:${a.start_time}`));
      } catch {
        // table may not exist; ignore
      }

      const start = new Date(dateFrom+"T00:00:00");
      const end = new Date(dateTo+"T00:00:00");
      if (end < start) throw new AppError("BAD_REQUEST", "dateTo debe ser >= dateFrom", 400);

      const out: any[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
        const date = d.toISOString().slice(0,10);
        if (holidaySet.has(date)) {
          out.push({ date, slots: [], blocked: true });
          continue;
        }
        const dow = d.getDay();
        const dayRules = (rules || []).filter((r: any) => Number(r.day_of_week) === dow);
        const slots: string[] = [];
        for (const r of dayRules) {
          const s = toMinutes(r.start_time);
          const e = toMinutes(r.end_time);
          const step = Number(r.slot_minutes || 30);
          for (let t = s; t + step <= e; t += step) {
            const hhmm = fromMinutes(t);
            if (!apptSet.has(`${date}:${hhmm}`)) slots.push(hhmm);
          }
        }
        out.push({ date, slots, blocked: false });
      }

      return res.json({ resource_type, resource_id, dateFrom, dateTo, availability: out });
    } catch (e) { return next(e); }
  });

  return router;
}

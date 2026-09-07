'use strict';

const { Router } = require('express');
const {
  R,
  consolidatedFinancials,
  dateRange,
  safeQuery,
  getBranchDashboard,
  aggregateDiagnoses,
  db,
} = require('../reports.common');

const router = Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const summary = await getBranchDashboard(req.user.branchId, today, today);
    return R.ok(res, summary);
  } catch (e) { next(e); }
});

router.get('/kpis', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const summary = await getBranchDashboard(req.user.branchId, from, to);
    return R.ok(res, summary);
  } catch (e) { next(e); }
});

router.get('/revenue', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const { groupBy = 'day' } = req.query;

    const fmt = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%x-W%v' : '%Y-%m-%d';
    const rows = await db.query(
      `SELECT DATE_FORMAT(i.issued_date, :fmt) AS period,
              COUNT(DISTINCT i.id) AS invoices,
              SUM(i.total_amount) AS gross_revenue,
              SUM(i.discount_amount) AS discounts,
              SUM(i.tax_amount) AS taxes,
              SUM(i.total_amount - i.discount_amount) AS net_revenue,
              SUM(i.paid_amount) AS collected,
              SUM(i.total_amount - i.paid_amount) AS outstanding,
              cur.code AS currency
       FROM invoices i
       JOIN currencies cur ON i.currency_id = cur.id
       WHERE i.branch_id = :bid
         AND i.issued_date BETWEEN :from AND :to
         AND i.status != 'cancelled'
       GROUP BY period, cur.code
       ORDER BY period ASC`,
      { fmt, bid: req.user.branchId, from, to }
    );
    return R.ok(res, rows, { from, to, groupBy });
  } catch (e) { next(e); }
});

router.get('/revenue-by-service', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const rows = await db.query(
      `SELECT sc.name AS category,
              COUNT(ii.id) AS line_items,
              SUM(ii.subtotal) AS revenue,
              ROUND(SUM(ii.subtotal) * 100.0 / SUM(SUM(ii.subtotal)) OVER (), 2) AS pct
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       LEFT JOIN services_catalog svc ON ii.service_id = svc.id
       LEFT JOIN service_categories sc ON svc.category_id = sc.id
       WHERE i.branch_id = :bid
         AND i.issued_date BETWEEN :from AND :to
         AND i.status != 'cancelled'
       GROUP BY sc.name ORDER BY revenue DESC`,
      { bid: req.user.branchId, from, to }
    );
    return R.ok(res, rows, { from, to });
  } catch (e) { next(e); }
});

router.get('/top-clients', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    // SECURITY: cap de limit para evitar dumps masivos de datos de clientes
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const rows = await db.query(
      `SELECT CONCAT(cl.first_name,' ',cl.last_name) AS client_name,
              cl.email, cl.phone,
              COUNT(DISTINCT i.id) AS total_invoices,
              SUM(i.total_amount) AS total_spent,
              SUM(i.paid_amount) AS total_paid,
              COUNT(DISTINCT a.id) AS total_appointments,
              COUNT(DISTINCT p.id) AS total_patients
       FROM clients cl
       JOIN invoices i ON i.client_id = cl.id
       LEFT JOIN appointments a ON a.client_id = cl.id AND a.branch_id = cl.branch_id
       LEFT JOIN patient_owners po ON po.client_id = cl.id AND po.ownership_type = 'primary'
       LEFT JOIN patients p ON po.patient_id = p.id
       WHERE cl.branch_id = :bid
         AND i.issued_date BETWEEN :from AND :to
         AND i.status != 'cancelled'
       GROUP BY cl.id ORDER BY total_spent DESC
       LIMIT :limit`,
      { bid: req.user.branchId, from, to, limit }
    );
    return R.ok(res, rows, { from, to });
  } catch (e) { next(e); }
});

router.get('/appointments', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const rows = await db.query(
      `SELECT
         COUNT(*) AS total_scheduled,
         SUM(status = 'completed')   AS completed,
         SUM(status = 'cancelled')   AS cancelled,
         SUM(status = 'no_show')     AS no_show,
         SUM(status = 'in_progress') AS in_progress,
         ROUND(SUM(status='completed')*100.0/COUNT(*),2) AS completion_rate,
         ROUND(SUM(status='no_show')*100.0/COUNT(*),2) AS no_show_rate,
         ROUND(AVG(duration_minutes),1) AS avg_duration_minutes
       FROM appointments
       WHERE branch_id = :bid
         AND scheduled_date >= :from
         AND scheduled_date < DATE_ADD(:to, INTERVAL 1 DAY)`,
      { bid: req.user.branchId, from, to }
    );

    const byType = await db.query(
      `SELECT at2.name AS type, COUNT(*) AS count, ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),2) AS pct
       FROM appointments a
       LEFT JOIN appointment_types at2 ON a.appointment_type_id = at2.id
       WHERE a.branch_id=:bid
         AND a.scheduled_date >= :from
         AND a.scheduled_date < DATE_ADD(:to, INTERVAL 1 DAY)
       GROUP BY at2.name ORDER BY count DESC`,
      { bid: req.user.branchId, from, to }
    );
    return R.ok(res, { summary: rows[0], byType }, { from, to });
  } catch (e) { next(e); }
});

router.get('/new-patients', async (req, res, next) => {
  try {
    const { groupBy = 'month' } = req.query;
    const { from: f, to: t } = dateRange(req.query);
    const fmt = groupBy === 'week' ? '%x-W%v' : '%Y-%m';

    const rows = await db.query(
      `SELECT DATE_FORMAT(p.created_at, :fmt) AS period,
              COUNT(*) AS new_patients,
              sp.common_name AS species, COUNT(*) AS species_count
       FROM patients p
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type='primary'
       JOIN clients cl ON po.client_id = cl.id AND cl.branch_id = :bid
       JOIN species sp ON p.species_id = sp.id
       WHERE p.created_at >= :from
         AND p.created_at < DATE_ADD(:to, INTERVAL 1 DAY)
       GROUP BY period, sp.common_name ORDER BY period, species_count DESC`,
      { fmt, bid: req.user.branchId, from: f, to: t }
    );
    return R.ok(res, rows, { from: f, to: t, groupBy });
  } catch (e) { next(e); }
});

router.get('/diagnoses', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    // SECURITY: cap de limit; cap de filas en SQL para evitar carga masiva en memoria
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const rows = await db.query(
      `SELECT d.diagnosis_name, d.diagnosis_code, sp.common_name AS species
       FROM diagnoses d
       JOIN medical_records mr ON d.medical_record_id = mr.id
       JOIN appointments a ON mr.appointment_id = a.id AND a.branch_id = :bid
       JOIN patients p ON mr.patient_id = p.id
       JOIN species sp ON p.species_id = sp.id
       WHERE d.created_at >= :from
         AND d.created_at < DATE_ADD(:to, INTERVAL 1 DAY)
         AND d.is_primary = TRUE
       ORDER BY d.created_at DESC
       LIMIT 5000`,
      { bid: req.user.branchId, from, to }
    );
    return R.ok(res, aggregateDiagnoses(rows, limit), { from, to });
  } catch (e) { next(e); }
});

router.get('/vaccination-compliance', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT
         COUNT(DISTINCT p.id) AS total_active_patients,
         SUM(CASE WHEN last_vac.vaccination_date >= DATE_SUB(NOW(), INTERVAL 1 YEAR) THEN 1 ELSE 0 END) AS vaccinated_last_year,
         SUM(CASE WHEN last_vac.vaccination_date < DATE_SUB(NOW(), INTERVAL 1 YEAR)
                    OR last_vac.vaccination_date IS NULL THEN 1 ELSE 0 END) AS not_vaccinated,
         ROUND(SUM(CASE WHEN last_vac.vaccination_date >= DATE_SUB(NOW(), INTERVAL 1 YEAR) THEN 1 ELSE 0 END)
               * 100.0 / COUNT(DISTINCT p.id), 2) AS compliance_rate
       FROM patients p
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type='primary'
       JOIN clients cl ON po.client_id = cl.id AND cl.branch_id = :bid
       LEFT JOIN (
         SELECT patient_id, MAX(vaccination_date) AS vaccination_date
         FROM vaccinations WHERE branch_id = :bid GROUP BY patient_id
       ) last_vac ON last_vac.patient_id = p.id
       WHERE p.is_active = TRUE AND p.is_deceased = FALSE`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows[0]);
  } catch (e) { next(e); }
});

router.get('/hospitalization-occupancy', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const [current, historical] = await Promise.all([
      db.query(
        `SELECT w.name AS ward, k.kennel_type, k.size_category,
                COUNT(k.id) AS total_kennels,
                SUM(CASE WHEN h.id IS NOT NULL THEN 1 ELSE 0 END) AS occupied,
                ROUND(SUM(CASE WHEN h.id IS NOT NULL THEN 1 ELSE 0 END)*100.0/COUNT(k.id),2) AS occupancy_pct
         FROM wards w
         JOIN kennels k ON k.ward_id = w.id
         LEFT JOIN hospitalizations h ON h.kennel_id = k.id AND h.discharge_date IS NULL
         WHERE w.branch_id = :bid AND k.is_active = TRUE
         GROUP BY w.id, k.kennel_type, k.size_category ORDER BY w.name`,
        { bid: req.user.branchId }
      ),
      db.query(
        `SELECT DATE_FORMAT(admission_date,'%Y-%m') AS month,
                COUNT(*) AS admissions,
                ROUND(AVG(DATEDIFF(COALESCE(discharge_date,NOW()),admission_date)),1) AS avg_stay_days
         FROM hospitalizations
         WHERE branch_id=:bid AND admission_date BETWEEN :from AND :to
         GROUP BY month ORDER BY month ASC`,
        { bid: req.user.branchId, from, to }
      ),
    ]);
    return R.ok(res, { current, historical }, { from, to });
  } catch (e) { next(e); }
});

router.get('/lab-turnaround', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const rows = await db.query(
      `SELECT ltc.name AS category,
              COUNT(lo.id) AS total_orders,
              ROUND(AVG(TIMESTAMPDIFF(HOUR, lo.ordered_at, lo.reported_at)),1) AS avg_hours,
              MIN(TIMESTAMPDIFF(HOUR, lo.ordered_at, lo.reported_at)) AS min_hours,
              MAX(TIMESTAMPDIFF(HOUR, lo.ordered_at, lo.reported_at)) AS max_hours,
              SUM(CASE WHEN TIMESTAMPDIFF(HOUR,lo.ordered_at,lo.reported_at) > lt.turnaround_hours THEN 1 ELSE 0 END) AS overdue_count
       FROM lab_orders lo
       JOIN lab_order_items loi ON loi.lab_order_id = lo.id
       JOIN lab_tests lt ON loi.lab_test_id = lt.id
       JOIN lab_test_categories ltc ON lt.category_id = ltc.id
       WHERE lo.branch_id = :bid
         AND lo.status = 'completed'
         AND lo.reported_at IS NOT NULL
         AND lo.ordered_at >= :from
         AND lo.ordered_at < DATE_ADD(:to, INTERVAL 1 DAY)
       GROUP BY ltc.name ORDER BY avg_hours DESC`,
      { bid: req.user.branchId, from, to }
    );
    return R.ok(res, rows, { from, to });
  } catch (e) { next(e); }
});

router.get('/telemedicine', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const [summary, byType] = await Promise.all([
      db.query(
        `SELECT COUNT(*) AS total_sessions,
                SUM(status='completed') AS completed,
                SUM(status='cancelled') AS cancelled,
                SUM(status='no_show')   AS no_show,
                ROUND(AVG(CASE WHEN status='completed' THEN duration_minutes END),1) AS avg_duration,
                ROUND(AVG(tr.overall_score),2) AS avg_rating
         FROM tele_sessions ts
         LEFT JOIN tele_ratings tr ON tr.session_id = ts.id
         WHERE ts.branch_id=:bid
           AND ts.scheduled_at >= :from
           AND ts.scheduled_at < DATE_ADD(:to, INTERVAL 1 DAY)`,
        { bid: req.user.branchId, from, to }
      ),
      db.query(
        `SELECT session_type, COUNT(*) AS count,
                ROUND(AVG(tr.overall_score),2) AS avg_rating
         FROM tele_sessions ts
         LEFT JOIN tele_ratings tr ON tr.session_id = ts.id
         WHERE ts.branch_id=:bid
           AND ts.scheduled_at >= :from
           AND ts.scheduled_at < DATE_ADD(:to, INTERVAL 1 DAY)
         GROUP BY session_type ORDER BY count DESC`,
        { bid: req.user.branchId, from, to }
      ),
    ]);
    return R.ok(res, { summary: summary[0], byType }, { from, to });
  } catch (e) { next(e); }
});

router.get('/grooming', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const rows = await db.query(
      `SELECT CONCAT(u.first_name,' ',u.last_name) AS groomer_name,
              COUNT(ga.id) AS appointments,
              SUM(ga.final_price) AS revenue,
              ROUND(AVG(gr2.overall_score),2) AS avg_rating,
              SUM(CASE WHEN ga.status='completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN ga.status='no_show'   THEN 1 ELSE 0 END) AS no_shows
       FROM grooming_appointments ga
       JOIN groomers g ON ga.groomer_id = g.id
       JOIN users    u ON g.user_id     = u.id
       LEFT JOIN grooming_ratings gr2 ON gr2.grooming_appointment_id = ga.id
       WHERE ga.branch_id=:bid
         AND ga.scheduled_at >= :from
         AND ga.scheduled_at < DATE_ADD(:to, INTERVAL 1 DAY)
       GROUP BY g.id ORDER BY revenue DESC`,
      { bid: req.user.branchId, from, to }
    );
    return R.ok(res, rows, { from, to });
  } catch (e) { next(e); }
});

router.get('/security', async (req, res, next) => {
  try {
    const [failures, sessions, alerts] = await Promise.all([
      safeQuery(
        `SELECT lh.id, lh.ip_address, lh.user_agent, lh.failure_reason, lh.created_at,
                u.id AS user_id, u.email, u.first_name, u.last_name, u.branch_id
         FROM login_history lh
         LEFT JOIN users u ON u.id = lh.user_id
         WHERE lh.success = 0
           AND lh.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
           AND u.branch_id = :bid
         ORDER BY lh.created_at DESC
         LIMIT 50`,
        { bid: req.user.branchId },
        []
      ),
      safeQuery(
        `SELECT s.id, s.user_id, s.ip_address, s.user_agent, s.device_type,
                s.created_at, s.last_activity_at, s.expires_at,
                u.email, u.first_name, u.last_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE u.branch_id = :bid
           AND s.is_revoked = FALSE
           AND s.expires_at > NOW()
         ORDER BY s.last_activity_at DESC
         LIMIT 100`,
        { bid: req.user.branchId },
        []
      ),
      safeQuery(
        `SELECT * FROM security_alerts
         WHERE org_id = :orgId
           AND acknowledged = FALSE
         ORDER BY created_at DESC
         LIMIT 50`,
        { orgId: req.user.orgId },
        []
      ),
    ]);
    return R.ok(res, { loginFailures: failures, activeSessions: sessions, unresolvedAlerts: alerts });
  } catch (e) { next(e); }
});

router.get('/executive', async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const financials = await consolidatedFinancials(req.user.orgId, from, to);
    const [topDiagnoses, occupancy] = await Promise.all([
      safeQuery(
        `SELECT d.diagnosis_name, COUNT(*) AS frequency
         FROM diagnoses d
         JOIN medical_records mr ON d.medical_record_id = mr.id
         JOIN appointments a ON mr.appointment_id = a.id
         JOIN branches b ON b.id = a.branch_id
         WHERE b.organization_id = :orgId
           AND d.created_at >= :from
           AND d.created_at < DATE_ADD(:to, INTERVAL 1 DAY)
           AND d.is_primary = TRUE
         GROUP BY d.diagnosis_name
         ORDER BY frequency DESC
         LIMIT 10`,
        { orgId: req.user.orgId, from, to },
        []
      ),
      safeQuery(
        `SELECT b.id AS branch_id, b.name AS branch_name,
                COUNT(DISTINCT k.id) AS total_kennels,
                SUM(CASE WHEN h.id IS NOT NULL THEN 1 ELSE 0 END) AS occupied_kennels,
                ROUND(SUM(CASE WHEN h.id IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT k.id), 0), 2) AS occupancy_pct
         FROM branches b
         LEFT JOIN wards w ON w.branch_id = b.id
         LEFT JOIN kennels k ON k.ward_id = w.id AND k.is_active = TRUE
         LEFT JOIN hospitalizations h ON h.kennel_id = k.id AND h.discharge_date IS NULL
         WHERE b.organization_id = :orgId
         GROUP BY b.id, b.name
         ORDER BY b.name`,
        { orgId: req.user.orgId },
        []
      ),
    ]);
    const summary = {
      from,
      to,
      ...financials.totals,
      branches: financials.metricsByBranch.length,
      totalActivePatients: financials.metricsByBranch.reduce((acc, row) => acc + (row.active_patients || 0), 0),
      totalAppointments: financials.metricsByBranch.reduce((acc, row) => acc + (row.appointments || 0), 0),
      averageCompletionRate: financials.metricsByBranch.length
        ? Number((financials.metricsByBranch.reduce((acc, row) => acc + (row.completion_rate || 0), 0) / financials.metricsByBranch.length).toFixed(2))
        : 0,
    };
    return R.ok(res, {
      summary,
      revenueByBranch: financials.revenueByBranch,
      topDiagnoses,
      occupancy,
      topClients: financials.topClients,
      metricsByBranch: financials.metricsByBranch,
    });
  } catch (e) { next(e); }
});

module.exports = router;

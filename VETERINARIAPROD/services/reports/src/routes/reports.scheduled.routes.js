'use strict';

const { Router } = require('express');
const {
  R,
  db,
  log,
  sendReportEmail,
  calcNextRun,
  fetchReportData,
  defaultCols,
  toExcel,
  generateRevenuePdf,
  generateAppointmentsReportPdf,
  generateDiagnosesReportPdf,
} = require('../reports.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT sr.*, b.name AS branch_name,
              CONCAT(u.first_name,' ',u.last_name) AS created_by_name,
              (SELECT COUNT(*) FROM report_runs rr WHERE rr.scheduled_report_id = sr.id) AS total_runs,
              (SELECT MAX(started_at) FROM report_runs rr WHERE rr.scheduled_report_id = sr.id AND rr.status='completed') AS last_success
       FROM scheduled_reports sr
       LEFT JOIN branches b ON sr.branch_id = b.id
       LEFT JOIN users    u ON sr.created_by = u.id
       WHERE sr.org_id = :orgId
       ORDER BY sr.name ASC`,
      { orgId: req.user.orgId }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/runs', async (req, res, next) => {
  try {
    // SECURITY: cap de limit y page para evitar dumps masivos
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
    const page   = Math.max(parseInt(req.query.page  || '1',  10) || 1, 1);
    const offset = (page - 1) * limit;
    const rows = await db.query(
      `SELECT rr.*, sr.name AS scheduled_name,
              CONCAT(u.first_name,' ',u.last_name) AS triggered_by_name
       FROM report_runs rr
       LEFT JOIN scheduled_reports sr ON rr.scheduled_report_id = sr.id
       LEFT JOIN users u ON rr.triggered_by = u.id
       WHERE rr.org_id = :orgId
       ORDER BY rr.created_at DESC
       LIMIT :limit OFFSET :offset`,
      { orgId: req.user.orgId, limit: parseInt(limit, 10), offset: parseInt(offset, 10) }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.queryOne(
      `SELECT sr.*, b.name AS branch_name
       FROM scheduled_reports sr LEFT JOIN branches b ON sr.branch_id=b.id
       WHERE sr.id=:id AND sr.org_id=:orgId`,
      { id: req.params.id, orgId: req.user.orgId }
    );
    if (!row) return R.notFound(res);

    const runs = await db.query(
      `SELECT id, status, format, file_size_bytes, started_at, finished_at, error_message
       FROM report_runs WHERE scheduled_report_id=:id ORDER BY created_at DESC LIMIT 10`,
      { id: req.params.id }
    );
    return R.ok(res, { ...row, recent_runs: runs });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      name, reportType, frequency, dayOfWeek, dayOfMonth,
      format = 'excel', recipients, params: rparams, branchId,
    } = req.body;

    if (!name || !reportType || !frequency || !recipients?.length) {
      return R.badRequest(res, 'name, reportType, frequency y recipients son requeridos');
    }

    let resolvedBranchId = branchId || req.user.branchId;
    if (branchId) {
      const branch = await db.queryOne(
        `SELECT id FROM branches WHERE id = :bid AND organization_id = :orgId`,
        { bid: branchId, orgId: req.user.orgId }
      );
      if (!branch) return R.forbidden(res, 'La sucursal no pertenece a la organizacion');
      resolvedBranchId = branch.id;
    }

    const nextRun = calcNextRun(frequency, dayOfWeek, dayOfMonth);

    const [r] = await db.query(
      `INSERT INTO scheduled_reports
         (org_id, branch_id, name, report_type, frequency, day_of_week, day_of_month,
          format, recipients, params, next_run_at, created_by)
       VALUES (:orgId, :bid, :name, :type, :freq, :dow, :dom, :fmt, :recip, :params, :next, :uid)`,
      {
        orgId: req.user.orgId,
        bid: resolvedBranchId,
        name, type: reportType, freq: frequency,
        dow: dayOfWeek || null,
        dom: dayOfMonth || null,
        fmt: format,
        recip: JSON.stringify(recipients),
        params: rparams ? JSON.stringify(rparams) : null,
        next: nextRun,
        uid: req.user.userId,
      }
    );
    return R.created(res, { id: r.insertId, nextRunAt: nextRun });
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const row = await db.queryOne(
      'SELECT id FROM scheduled_reports WHERE id=:id AND org_id=:orgId',
      { id: req.params.id, orgId: req.user.orgId }
    );
    if (!row) return R.notFound(res);

    const fields = [];
    const vals = { id: req.params.id };
    // SECURITY: branch_id removido de allowed — tiene su propia validación de org más abajo
    const allowed = ['name', 'frequency', 'day_of_week', 'day_of_month', 'format', 'recipients', 'params', 'is_active'];

    for (const [k, v] of Object.entries(req.body)) {
      const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!allowed.includes(col)) continue;
      fields.push(`${col} = :${col}`);
      vals[col] = Array.isArray(v) || typeof v === 'object' ? JSON.stringify(v) : v;
    }

    // SECURITY: si se solicita cambiar branch_id, verificar que pertenece a la org
    if (req.body.branchId) {
      const branch = await db.queryOne(
        'SELECT id FROM branches WHERE id = :bid AND organization_id = :orgId',
        { bid: req.body.branchId, orgId: req.user.orgId }
      );
      if (!branch) return R.forbidden(res, 'La sucursal no pertenece a la organizacion');
      fields.push('branch_id = :branch_id');
      vals.branch_id = branch.id;
    }
    if (!fields.length) return R.badRequest(res, 'Sin campos para actualizar');

    const { frequency, dayOfWeek, dayOfMonth } = req.body;
    if (frequency) {
      const nextRun = calcNextRun(frequency, dayOfWeek, dayOfMonth);
      fields.push('next_run_at = :nextRun');
      vals.nextRun = nextRun;
    }

    await db.query(`UPDATE scheduled_reports SET ${fields.join(', ')} WHERE id = :id`, vals);
    return R.noContent(res);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM scheduled_reports WHERE id=:id AND org_id=:orgId',
      { id: req.params.id, orgId: req.user.orgId }
    );
    return R.noContent(res);
  } catch (e) { next(e); }
});

router.post('/:id/run', async (req, res, next) => {
  try {
    const sr = await db.queryOne(
      'SELECT * FROM scheduled_reports WHERE id=:id AND org_id=:orgId',
      { id: req.params.id, orgId: req.user.orgId }
    );
    if (!sr) return R.notFound(res);

    const [runRow] = await db.query(
      `INSERT INTO report_runs (scheduled_report_id, org_id, branch_id, report_type, format, status, params, triggered_by, started_at)
       VALUES (:sid, :orgId, :bid, :type, :fmt, 'running', :params, :uid, NOW())`,
      {
        sid: sr.id, orgId: req.user.orgId, bid: sr.branch_id,
        type: sr.report_type, fmt: sr.format,
        params: sr.params, uid: req.user.userId,
      }
    );
    const runId = runRow.insertId;

    setImmediate(async () => {
      try {
        const params = sr.params ? JSON.parse(sr.params) : {};
        const data = await fetchReportData(sr.report_type, sr.branch_id, sr.org_id, params);
        const meta = { from: params.from, to: params.to, generatedBy: 'Programado' };
        let fileSize = 0;
        let subject = `Reporte: ${sr.name}`;

        if (sr.format === 'excel') {
          const cols = defaultCols(sr.report_type);
          const rows = Array.isArray(data) ? data : (data.byType || []);
          const buffer = await toExcel({ title: sr.name, columns: cols, rows, meta });
          fileSize = buffer.length;
          const recipients = JSON.parse(sr.recipients);
          for (const email of recipients) {
            await sendReportEmail({
              email,
              subject,
              reportName: sr.name,
              buffer,
              filename: `${sr.report_type}.xlsx`,
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }).catch((err) => log.warn('scheduled report email failed', { err: err.message, scheduledReportId: sr.id, email }));
          }
        } else if (sr.format === 'pdf') {
          let buf;
          if (sr.report_type === 'revenue') buf = await generateRevenuePdf({ rows: data, meta });
          else if (sr.report_type === 'appointments') buf = await generateAppointmentsReportPdf({ ...data, meta });
          else if (sr.report_type === 'diagnoses') buf = await generateDiagnosesReportPdf({ rows: data, meta });
          if (buf) {
            fileSize = buf.length;
            const recipients = JSON.parse(sr.recipients);
            for (const email of recipients) {
              await sendReportEmail({
                email,
                subject,
                reportName: sr.name,
                buffer: buf,
                filename: `${sr.report_type}.pdf`,
                mimeType: 'application/pdf',
              }).catch((err) => log.warn('scheduled report email failed', { err: err.message, scheduledReportId: sr.id, email }));
            }
          }
        }

        await db.query(
          `UPDATE report_runs SET status='completed', file_size_bytes=:sz, finished_at=NOW() WHERE id=:id`,
          { sz: fileSize, id: runId }
        );
        await db.query(
          `UPDATE scheduled_reports SET last_run_at=NOW(), next_run_at=:next WHERE id=:id`,
          { next: calcNextRun(sr.frequency, sr.day_of_week, sr.day_of_month), id: sr.id }
        );
      } catch (err) {
        log.error('scheduled report run failed', { err: err.message, scheduledReportId: sr.id, runId });
        await db.query(
          `UPDATE report_runs SET status='failed', error_message=:msg, finished_at=NOW() WHERE id=:id`,
          { msg: err.message, id: runId }
        );
      }
    });

    return R.accepted(res, { runId, message: 'Reporte en proceso. Se enviará por email al terminar.' });
  } catch (e) { next(e); }
});

module.exports = router;

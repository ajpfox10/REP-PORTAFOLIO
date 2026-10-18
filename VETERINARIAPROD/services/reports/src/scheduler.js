'use strict';

/**
 * Envío de reportes programados.
 *
 * - executeScheduledReport: genera el archivo y lo manda a los destinatarios.
 * - runDueReports: busca los programados vencidos y los ejecuta. Cada fila se
 *   "reclama" moviendo next_run_at con un UPDATE condicional, así dos réplicas
 *   del servicio nunca envían el mismo reporte dos veces.
 * - startScheduler: corre runDueReports cada REPORTS_SCHEDULER_INTERVAL_MS.
 */

const {
  db,
  log,
  sendReportEmail,
  calcNextRun,
  fetchReportData,
  defaultCols,
  toExcel,
  toCsv,
  generateRevenuePdf,
  generateAppointmentsReportPdf,
  generateDiagnosesReportPdf,
} = require('./reports.common');

const MIME = {
  excel: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { ext: 'pdf', type: 'application/pdf' },
  csv: { ext: 'csv', type: 'text/csv; charset=utf-8' },
};

function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value; // columnas JSON: mysql2 ya las devuelve parseadas
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseRecipients(value) {
  const parsed = parseJsonField(value, null);
  const list = Array.isArray(parsed) ? parsed : String(value || '').split(',');
  return list.map((email) => String(email).trim()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function rowsOf(data) {
  return Array.isArray(data) ? data : (data?.byType || []);
}

async function buildAttachment(sr, data, meta) {
  const format = MIME[sr.format] ? sr.format : 'excel';
  let buffer;
  if (format === 'pdf') {
    if (sr.report_type === 'revenue') buffer = await generateRevenuePdf({ rows: data, meta });
    else if (sr.report_type === 'appointments') buffer = await generateAppointmentsReportPdf({ ...data, meta });
    else if (sr.report_type === 'diagnoses') buffer = await generateDiagnosesReportPdf({ rows: data, meta });
  } else if (format === 'csv') {
    buffer = Buffer.from(toCsv({ columns: defaultCols(sr.report_type), rows: rowsOf(data) }), 'utf8');
  } else {
    buffer = await toExcel({ title: sr.name, columns: defaultCols(sr.report_type), rows: rowsOf(data), meta });
  }
  if (!buffer) throw new Error(`No se pudo generar el reporte ${sr.report_type} en formato ${format}`);
  return { buffer, filename: `${sr.report_type}.${MIME[format].ext}`, mimeType: MIME[format].type };
}

async function startRun(sr, triggeredBy = null) {
  const [row] = await db.query(
    `INSERT INTO report_runs (scheduled_report_id, org_id, branch_id, report_type, format, status, params, triggered_by, started_at)
     VALUES (:sid, :orgId, :bid, :type, :fmt, 'running', :params, :uid, NOW())`,
    {
      sid: sr.id,
      orgId: sr.org_id,
      bid: sr.branch_id,
      type: sr.report_type,
      fmt: sr.format,
      params: sr.params ? (typeof sr.params === 'string' ? sr.params : JSON.stringify(sr.params)) : null,
      uid: triggeredBy,
    }
  );
  return row.insertId;
}

async function executeScheduledReport(sr, runId) {
  try {
    const params = parseJsonField(sr.params, {}) || {};
    const data = await fetchReportData(sr.report_type, sr.branch_id, sr.org_id, params);
    const meta = { from: params.from, to: params.to, generatedBy: 'Envío programado' };
    const attachment = await buildAttachment(sr, data, meta);

    const recipients = parseRecipients(sr.recipients);
    let sent = 0;
    for (const email of recipients) {
      try {
        await sendReportEmail({ email, subject: `Reporte: ${sr.name}`, reportName: sr.name, ...attachment });
        sent += 1;
      } catch (err) {
        log.warn('scheduled report email failed', { err: err.message, scheduledReportId: sr.id, email });
      }
    }
    if (recipients.length && sent === 0) throw new Error('No se pudo enviar el reporte a ningún destinatario');

    await db.query(
      `UPDATE report_runs SET status='completed', file_size_bytes=:sz, finished_at=NOW() WHERE id=:id`,
      { sz: attachment.buffer.length, id: runId }
    );
    await db.query(
      `UPDATE scheduled_reports SET last_run_at=NOW(), next_run_at=:next WHERE id=:id`,
      { next: calcNextRun(sr.frequency, sr.day_of_week, sr.day_of_month), id: sr.id }
    );
    return { status: 'completed', sent };
  } catch (err) {
    log.error('scheduled report run failed', { err: err.message, scheduledReportId: sr.id, runId });
    await db.query(
      `UPDATE report_runs SET status='failed', error_message=:msg, finished_at=NOW() WHERE id=:id`,
      { msg: String(err.message).slice(0, 500), id: runId }
    ).catch(() => {});
    return { status: 'failed', error: err.message };
  }
}

/**
 * Ejecuta los reportes programados vencidos.
 * @returns {Promise<number>} cantidad de reportes ejecutados
 */
async function runDueReports({ limit = 20 } = {}) {
  const due = await db.query(
    `SELECT * FROM scheduled_reports
      WHERE COALESCE(is_active, 1) = 1
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
      LIMIT ${Math.max(1, Math.min(100, Number(limit) || 20))}`
  );

  let executed = 0;
  for (const sr of due) {
    // Reclamo optimista: solo una instancia logra mover next_run_at.
    const [claim] = await db.query(
      `UPDATE scheduled_reports SET next_run_at = :next
        WHERE id = :id AND next_run_at = :previous`,
      { id: sr.id, previous: sr.next_run_at, next: calcNextRun(sr.frequency, sr.day_of_week, sr.day_of_month) }
    );
    if (!claim?.affectedRows) continue;
    const runId = await startRun(sr, null);
    await executeScheduledReport(sr, runId);
    executed += 1;
  }
  return executed;
}

function startScheduler({ intervalMs = parseInt(process.env.REPORTS_SCHEDULER_INTERVAL_MS || '300000', 10) } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const executed = await runDueReports();
      if (executed) log.info('scheduled reports executed', { executed });
    } catch (err) {
      log.warn('scheduled reports tick failed', { err: err.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, Math.max(60000, intervalMs));
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}

module.exports = {
  startRun,
  executeScheduledReport,
  runDueReports,
  startScheduler,
  _private: { parseRecipients, parseJsonField, buildAttachment },
};

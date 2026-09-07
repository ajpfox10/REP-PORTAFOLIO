'use strict';

require('dotenv').config();

const db = require('../../shared/db');

async function archiveTable({ name, insertSql, deleteSql, params }) {
  try {
    await db.transaction(async (conn) => {
      await conn.query(insertSql, params);
      await conn.query(deleteSql, params);
    });
  } catch (err) {
    // Keep source rows when archiving fails. The next run can retry safely.
    console.warn(`[archive-logs] ${name} skipped: ${err.message}`);
  }
}

async function archiveAuditLogs(retentionDays) {
  await archiveTable({
    name: 'audit_log_immutable',
    params: { days: retentionDays },
    insertSql: `INSERT INTO audit_log_immutable_archive
       (created_at, org_id, audit_log_id, payload_json, prev_hash, entry_hash, export_status)
     SELECT created_at, org_id, audit_log_id, payload_json, prev_hash, entry_hash, 'archived'
     FROM audit_log_immutable
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
    deleteSql: `DELETE FROM audit_log_immutable
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
  });
}

async function archiveNotificationLogs(retentionDays) {
  await archiveTable({
    name: 'notification_logs',
    params: { days: retentionDays },
    insertSql: `INSERT INTO notification_logs_archive
       (created_at, branch_id, user_id, client_id, channel, title, body, status, error_message, external_id, deleted_at)
     SELECT created_at, branch_id, user_id, client_id, channel, title, body, status, error_message, external_id, deleted_at
     FROM notification_logs
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
    deleteSql: `DELETE FROM notification_logs
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
  });
}

async function archiveMessageLogs(retentionDays) {
  await archiveTable({
    name: 'message_logs',
    params: { days: retentionDays },
    insertSql: `INSERT INTO message_logs_archive
       (created_at, branch_id, client_id, user_id, channel, recipient, template_name, status, external_id, error_message, payload_json)
     SELECT created_at, branch_id, client_id, user_id, channel, recipient, template_name, status, external_id, error_message, payload_json
     FROM message_logs
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
    deleteSql: `DELETE FROM message_logs
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
  });
}

async function archiveSecurityAlerts(retentionDays) {
  await archiveTable({
    name: 'security_alerts',
    params: { days: retentionDays },
    insertSql: `INSERT INTO security_alerts_archive
       (created_at, organization_id, user_id, alert_type, severity, status, title, description, metadata_json)
     SELECT created_at,
            org_id,
            user_id,
            alert_type,
            severity,
            'archived',
            alert_type,
            details,
            details
     FROM security_alerts
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
    deleteSql: `DELETE FROM security_alerts
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
  });
}

async function archiveReportRuns(retentionDays) {
  await archiveTable({
    name: 'report_runs',
    params: { days: retentionDays },
    insertSql: `INSERT INTO report_runs_archive
       (created_at, scheduled_report_id, status, output_path, generated_by, error_message, metadata_json)
     SELECT created_at, scheduled_report_id, status, output_path, generated_by, error_message, metadata_json
     FROM report_runs
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
    deleteSql: `DELETE FROM report_runs
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
  });
}

async function archiveServiceRegistrySnapshots(retentionDays) {
  await archiveTable({
    name: 'service_registry_snapshots',
    params: { days: retentionDays },
    insertSql: `INSERT INTO service_registry_snapshots_archive
       (created_at, service_name, service_url, health_status, metadata_json)
     SELECT created_at, service_name, service_url, health_status, metadata_json
     FROM service_registry_snapshots
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
    deleteSql: `DELETE FROM service_registry_snapshots
     WHERE created_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
  });
}

async function main() {
  const retentionDays = Math.max(30, parseInt(process.env.LOG_ARCHIVE_RETENTION_DAYS || '90', 10));
  await archiveAuditLogs(retentionDays);
  await archiveNotificationLogs(retentionDays);
  await archiveMessageLogs(retentionDays);
  await archiveSecurityAlerts(retentionDays);
  await archiveReportRuns(retentionDays);
  await archiveServiceRegistrySnapshots(retentionDays);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[archive-logs]', err.message);
    process.exit(1);
  });

'use strict';

require('dotenv').config();

const axios = require('axios');
const db = require('../../shared/db');
const { exportAuditLogs, rowsToNdjson } = require('../../shared/audit');

async function main() {
  const orgRows = await db.query('SELECT id FROM organizations WHERE is_active = 1');
  const endpoint = process.env.SIEM_ENDPOINT;
  if (!endpoint) throw new Error('SIEM_ENDPOINT not configured');

  for (const org of orgRows) {
    const { rows } = await exportAuditLogs({
      orgId: org.id,
      source: 'immutable',
      format: 'json',
      dateFrom: process.env.SIEM_EXPORT_DATE_FROM,
      dateTo: process.env.SIEM_EXPORT_DATE_TO,
      limit: process.env.SIEM_EXPORT_LIMIT || 10000,
    });
    if (!rows.length) continue;

    await axios.post(endpoint, rowsToNdjson(rows), {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-SIEM-Org-Id': String(org.id),
      },
      timeout: 30000,
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[siem-export]', err.message);
    process.exit(1);
  });

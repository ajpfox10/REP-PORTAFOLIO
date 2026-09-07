'use strict';

const { Router } = require('express');
const {
  R,
  toExcel,
  toCsv,
  generateRevenuePdf,
  generateAppointmentsReportPdf,
  generateDiagnosesReportPdf,
  fetchReportData,
  defaultCols,
} = require('../reports.common');
const { trackExport } = require('../../../../shared/dlp');

const router = Router();

router.post('/:type/export', async (req, res, next) => {
  try {
    const { type } = req.params;
    const format = req.body.format || req.query.format || 'excel';
    const params = { ...req.query, ...req.body };

    const data = await fetchReportData(type, req.user.branchId, req.user.orgId, params);
    const from = params.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const to = params.to || new Date().toISOString().slice(0, 10);
    const meta = { from, to, branch: req.user.branchName, generatedBy: req.user.email };

    // DLP: rechazar si el usuario superó el umbral de export en la ventana de tiempo
    const rows = Array.isArray(data) ? data : (data.byType || []);
    const dlp = await trackExport(req.user.userId, req.user.orgId, rows.length);
    if (dlp.exceeded) {
      return R.tooMany(res, `Export limit exceeded (${dlp.count} of ${dlp.threshold} records in the last 5 minutes)`);
    }

    if (format === 'pdf') {
      let pdfBuf;
      if (type === 'revenue') pdfBuf = await generateRevenuePdf({ rows: data, meta });
      else if (type === 'appointments') pdfBuf = await generateAppointmentsReportPdf({ ...data, meta });
      else if (type === 'diagnoses') pdfBuf = await generateDiagnosesReportPdf({ rows: data, meta });
      else return R.badRequest(res, `PDF no disponible para tipo: ${type}`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-${type}-${from}-${to}.pdf"`);
      return res.send(pdfBuf);
    }

    const columns = defaultCols(type) || Object.keys(rows[0] || {}).map((k) => ({ key: k, header: k }));
    const title = `Reporte ${type} — ${from} a ${to}`;

    if (format === 'excel') {
      const buf = await toExcel({ title, columns, rows, meta });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-${type}-${from}-${to}.xlsx"`);
      return res.send(buf);
    }

    if (format === 'csv') {
      const csv = toCsv({ columns, rows });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-${type}-${from}-${to}.csv"`);
      return res.send(csv);
    }

    return R.badRequest(res, `Formato no soportado: ${format}. Usar: pdf, excel, csv`);
  } catch (e) {
    if (e.code === 'UNKNOWN_REPORT') return R.badRequest(res, e.message);
    next(e);
  }
});

module.exports = router;

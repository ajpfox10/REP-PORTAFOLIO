'use strict';

/**
 * Generador de PDFs — pdfkit.
 * Expone: generateInvoicePdf, generateMedicalRecordPdf, generateLabReportPdf
 *
 * Uso:
 *   const { generateInvoicePdf } = require('../../shared/pdf');
 *   const buffer = await generateInvoicePdf(invoiceData);
 *   res.set('Content-Type', 'application/pdf');
 *   res.send(buffer);
 */

const PDFDocument = require('pdfkit');
const { formatDate, formatDateTime, formatNumber } = require('./locale');

// ── Paleta de colores ─────────────────────────────────────────────────────────
const C = {
  primary:    '#2563eb',
  dark:       '#1e293b',
  gray:       '#64748b',
  lightGray:  '#f1f5f9',
  border:     '#e2e8f0',
  success:    '#16a34a',
  danger:     '#dc2626',
  white:      '#ffffff',
};

// ── Helper: crear buffer desde stream ────────────────────────────────────────
function streamToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', err   => reject(err));
  });
}

// ── Helpers de layout ─────────────────────────────────────────────────────────
function drawHRule(doc, y, color = C.border) {
  doc.moveTo(40, y).lineTo(555, y).strokeColor(color).lineWidth(0.5).stroke();
}

function drawRect(doc, x, y, w, h, color) {
  doc.rect(x, y, w, h).fillColor(color).fill();
}

function header(doc, clinicName, clinicAddress, clinicCuit, clinicPhone) {
  // Barra superior azul
  drawRect(doc, 0, 0, 595, 80, C.primary);

  doc.fillColor(C.white).fontSize(20).font('Helvetica-Bold')
    .text(clinicName || 'VetManager Pro', 40, 25);
  doc.fontSize(9).font('Helvetica')
    .text(clinicAddress || '', 40, 50)
    .text(clinicPhone ? `Tel: ${clinicPhone}` : '', 40, 62);

  if (clinicCuit) {
    doc.fontSize(9).text(`CUIT: ${clinicCuit}`, 400, 50, { align: 'right', width: 155 });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTURA PDF
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {object} data
 * @param {object}   data.invoice     — Datos de la factura (DB)
 * @param {object[]} data.items       — Ítems de la factura
 * @param {object[]} data.payments    — Pagos realizados
 * @param {object}   data.clinic      — Datos de la sucursal/clínica
 * @param {object}   data.client      — Datos del cliente
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf({ invoice, items = [], payments = [], clinic = {}, client = {} }) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  const buf = streamToBuffer(doc);

  // ── Header ────────────────────────────────────────────────────────────────
  header(doc, clinic.name, clinic.address, clinic.cuit, clinic.phone);

  // ── Título y número ───────────────────────────────────────────────────────
  doc.fillColor(C.dark).fontSize(16).font('Helvetica-Bold')
    .text('FACTURA', 40, 100);

  const tipoLabel = invoice.afip_tipo === 1 ? 'A' : invoice.afip_tipo === 6 ? 'B' : 'C';
  if (tipoLabel) {
    drawRect(doc, 260, 95, 30, 25, C.primary);
    doc.fillColor(C.white).fontSize(16).font('Helvetica-Bold').text(tipoLabel, 265, 99);
  }

  doc.fillColor(C.gray).fontSize(10).font('Helvetica')
    .text(`N° ${invoice.afip_punto_venta || '0001'}-${String(invoice.afip_nro_comprobante || invoice.invoice_number || '').padStart(8, '0')}`, 300, 103);

  doc.fillColor(C.dark).fontSize(10)
    .text(`Fecha: ${formatDate(invoice.issued_date)}`, 400, 100, { align: 'right', width: 155 });

  if (invoice.afip_cae) {
    doc.fontSize(9).fillColor(C.gray)
      .text(`CAE: ${invoice.afip_cae}`, 40, 125)
      .text(`Vto. CAE: ${invoice.afip_cae_vto ? formatDate(invoice.afip_cae_vto) : '-'}`, 200, 125);
  }

  // ── Datos del cliente ─────────────────────────────────────────────────────
  drawHRule(doc, 145);
  drawRect(doc, 40, 150, 515, 20, C.lightGray);
  doc.fillColor(C.gray).fontSize(8).font('Helvetica-Bold')
    .text('DATOS DEL CLIENTE', 44, 155);

  doc.fillColor(C.dark).fontSize(10).font('Helvetica')
    .text(`${client.first_name || ''} ${client.last_name || ''}`, 40, 178)
    .text(client.email || '', 40, 192)
    .text(client.phone ? `Tel: ${client.phone}` : '', 40, 206);

  if (client.tax_id) {
    doc.text(`CUIT/DNI: ${client.tax_id}`, 300, 178);
  }

  // ── Tabla de ítems ────────────────────────────────────────────────────────
  drawHRule(doc, 225);
  const tableTop = 230;

  // Encabezados
  drawRect(doc, 40, tableTop, 515, 20, C.dark);
  doc.fillColor(C.white).fontSize(8).font('Helvetica-Bold')
    .text('DESCRIPCIÓN',             44, tableTop + 6)
    .text('CANT.',                  310, tableTop + 6, { width: 50, align: 'right' })
    .text('P. UNIT.',               365, tableTop + 6, { width: 70, align: 'right' })
    .text('DESC.',                  440, tableTop + 6, { width: 40, align: 'right' })
    .text('TOTAL',                  485, tableTop + 6, { width: 70, align: 'right' });

  let y = tableTop + 25;
  let subtotal = 0;

  for (let i = 0; i < items.length; i++) {
    const item  = items[i];
    const total = item.quantity * item.unit_price * (1 - (item.discount_pct || 0) / 100);
    subtotal   += total;

    if (i % 2 === 0) drawRect(doc, 40, y - 4, 515, 18, C.lightGray);

    doc.fillColor(C.dark).fontSize(9).font('Helvetica')
      .text(item.description || '-',         44, y, { width: 260 })
      .text(String(item.quantity),           310, y, { width: 50, align: 'right' })
      .text(`$${Number(item.unit_price).toFixed(2)}`, 365, y, { width: 70, align: 'right' })
      .text(item.discount_pct ? `${item.discount_pct}%` : '-', 440, y, { width: 40, align: 'right' })
      .text(`$${total.toFixed(2)}`,          485, y, { width: 70, align: 'right' });

    y += 18;
  }

  // ── Totales ───────────────────────────────────────────────────────────────
  drawHRule(doc, y + 5);
  y += 15;

  const taxAmount  = invoice.tax_amount  || 0;
  const discAmount = invoice.discount_amount || 0;
  const total      = invoice.total_amount || subtotal;

  const totalsX = 380;
  doc.fontSize(9).fillColor(C.gray)
    .text('Subtotal:',   totalsX, y, { width: 90, align: 'right' })
    .text(`$${subtotal.toFixed(2)}`, totalsX + 95, y, { width: 80, align: 'right' });
  y += 14;

  if (discAmount > 0) {
    doc.text('Descuento:', totalsX, y, { width: 90, align: 'right' })
      .text(`-$${Number(discAmount).toFixed(2)}`, totalsX + 95, y, { width: 80, align: 'right' });
    y += 14;
  }

  if (taxAmount > 0) {
    doc.text('IVA:', totalsX, y, { width: 90, align: 'right' })
      .text(`$${Number(taxAmount).toFixed(2)}`, totalsX + 95, y, { width: 80, align: 'right' });
    y += 14;
  }

  drawRect(doc, totalsX - 5, y, 180, 22, C.primary);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11)
    .text('TOTAL:', totalsX, y + 6, { width: 90, align: 'right' })
    .text(`$${Number(total).toFixed(2)}`, totalsX + 95, y + 6, { width: 80, align: 'right' });
  y += 30;

  // ── Estado de pago ────────────────────────────────────────────────────────
  const isPaid = invoice.status === 'paid';
  const statusColor = isPaid ? C.success : C.danger;
  const statusText  = isPaid ? 'PAGADA' : 'PENDIENTE DE PAGO';

  drawRect(doc, 40, y, 100, 22, statusColor);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(10)
    .text(statusText, 40, y + 6, { width: 100, align: 'center' });

  // ── Pie ───────────────────────────────────────────────────────────────────
  drawRect(doc, 0, 790, 595, 52, C.lightGray);
  doc.fillColor(C.gray).font('Helvetica').fontSize(8)
    .text('Documento generado por VetManager Pro', 40, 805, { align: 'center', width: 515 });

  doc.end();
  return buf;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORIA CLÍNICA PDF
// ═══════════════════════════════════════════════════════════════════════════════

async function generateMedicalRecordPdf({ record, patient, clinic = {} }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const buf = streamToBuffer(doc);

  header(doc, clinic.name, clinic.address, clinic.cuit, clinic.phone);

  doc.fillColor(C.dark).fontSize(14).font('Helvetica-Bold')
    .text('HISTORIA CLÍNICA', 40, 100);

  doc.fontSize(10).font('Helvetica')
    .text(`Paciente: ${patient.name}`, 40, 125)
    .text(`Especie: ${patient.species || '-'}  |  Raza: ${patient.breed || '-'}`, 40, 140)
    .text(`Fecha de visita: ${formatDate(record.visit_date)}`, 40, 155)
    .text(`Veterinario: ${record.vet_name || '-'}`, 300, 155);

  drawHRule(doc, 175);

  let y = 185;
  const sections = [
    { label: 'Motivo de consulta',    value: record.reason_for_visit },
    { label: 'Anamnesis',             value: record.anamnesis },
    { label: 'Examen físico',         value: record.physical_exam_notes },
    { label: 'Diagnóstico',           value: record.diagnosis },
    { label: 'Tratamiento',           value: record.treatment_plan },
    { label: 'Observaciones',         value: record.notes },
  ];

  for (const s of sections) {
    if (!s.value) continue;
    doc.fillColor(C.primary).font('Helvetica-Bold').fontSize(10).text(s.label, 40, y);
    y += 15;
    doc.fillColor(C.dark).font('Helvetica').fontSize(10)
      .text(s.value, 40, y, { width: 515 });
    y += doc.heightOfString(s.value, { width: 515 }) + 12;
    drawHRule(doc, y - 4);
  }

  doc.end();
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateRevenuePdf
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera PDF de reporte de ingresos.
 * @param {object} opts
 * @param {object[]} opts.rows    — datos de revenue (period, gross_revenue, net_revenue, etc.)
 * @param {object}   opts.meta   — { from, to, branch, generatedBy }
 * @param {object}   [opts.clinic]
 * @returns {Promise<Buffer>}
 */
async function generateRevenuePdf ({ rows, meta = {}, clinic = {} }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const buf = streamToBuffer(doc);

  // ── Header ──
  doc.rect(0, 0, 595, 70).fill(C.primary);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(18)
    .text(clinic.name || 'VetManager Pro', 40, 18);
  doc.font('Helvetica').fontSize(10)
    .text('Reporte de Ingresos', 40, 40);
  if (meta.branch) doc.text(`Sucursal: ${meta.branch}`, 40, 52);

  // Período en header
  doc.font('Helvetica').fontSize(9)
    .text(`${meta.from || ''} → ${meta.to || 'hoy'}`, 400, 30, { width: 155, align: 'right' });

  let y = 90;

  // ── KPIs resumen ──
  if (rows.length) {
    const totalGross = rows.reduce((s, r) => s + (Number(r.gross_revenue) || 0), 0);
    const totalNet   = rows.reduce((s, r) => s + (Number(r.net_revenue)   || 0), 0);
    const totalColl  = rows.reduce((s, r) => s + (Number(r.collected)     || 0), 0);
    const kpis = [
      { label: 'Ingresos Brutos',  value: `$${fmtNum(totalGross)}` },
      { label: 'Ingresos Netos',   value: `$${fmtNum(totalNet)}`   },
      { label: 'Cobrado',          value: `$${fmtNum(totalColl)}`  },
      { label: 'Pendiente',        value: `$${fmtNum(totalGross - totalColl)}` },
    ];

    const boxW = 118, boxH = 48, gap = 8, startX = 40;
    kpis.forEach((kpi, i) => {
      const x = startX + i * (boxW + gap);
      doc.roundedRect(x, y, boxW, boxH, 6).fillAndStroke(C.lightGray, C.border);
      doc.fillColor(C.gray).font('Helvetica').fontSize(8).text(kpi.label, x + 8, y + 8, { width: boxW - 16 });
      doc.fillColor(C.primary).font('Helvetica-Bold').fontSize(14).text(kpi.value, x + 8, y + 22, { width: boxW - 16 });
    });
    y += boxH + 24;
  }

  // ── Tabla de datos ──
  const cols = [
    { key: 'period',        header: 'Período',     w: 90,  align: 'left'  },
    { key: 'invoices',      header: 'Facturas',    w: 60,  align: 'right' },
    { key: 'gross_revenue', header: 'Bruto ($)',   w: 90,  align: 'right' },
    { key: 'net_revenue',   header: 'Neto ($)',    w: 90,  align: 'right' },
    { key: 'collected',     header: 'Cobrado ($)', w: 90,  align: 'right' },
    { key: 'outstanding',   header: 'Pendiente ($)',w: 90, align: 'right' },
  ];

  y = _pdfTable(doc, cols, rows, y);

  // ── Footer ──
  _pdfFooter(doc, meta.generatedBy);

  doc.end();
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateAppointmentsReportPdf
// ─────────────────────────────────────────────────────────────────────────────

async function generateAppointmentsReportPdf ({ summary, byType, meta = {}, clinic = {} }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const buf = streamToBuffer(doc);

  // Header
  doc.rect(0, 0, 595, 70).fill(C.primary);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(18).text(clinic.name || 'VetManager Pro', 40, 18);
  doc.font('Helvetica').fontSize(10).text('Reporte de Turnos', 40, 40);
  doc.font('Helvetica').fontSize(9).text(`${meta.from || ''} → ${meta.to || 'hoy'}`, 400, 30, { width: 155, align: 'right' });

  let y = 90;

  // KPIs
  if (summary) {
    const kpis = [
      { label: 'Total Turnos',       value: String(summary.total_scheduled || 0) },
      { label: 'Completados',        value: `${summary.completion_rate || 0}%`   },
      { label: 'Cancelados',         value: String(summary.cancelled || 0)        },
      { label: 'No Show',            value: `${summary.no_show_rate || 0}%`      },
    ];
    const boxW = 118, boxH = 48, gap = 8, startX = 40;
    kpis.forEach((kpi, i) => {
      const x = startX + i * (boxW + gap);
      doc.roundedRect(x, y, boxW, boxH, 6).fillAndStroke(C.lightGray, C.border);
      doc.fillColor(C.gray).font('Helvetica').fontSize(8).text(kpi.label, x + 8, y + 8, { width: boxW - 16 });
      doc.fillColor(C.primary).font('Helvetica-Bold').fontSize(14).text(kpi.value, x + 8, y + 22, { width: boxW - 16 });
    });
    y += 80;
  }

  // Tabla por tipo
  if (byType && byType.length) {
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(11).text('Distribución por tipo', 40, y);
    y += 16;
    const cols = [
      { key: 'type',  header: 'Tipo de Turno', w: 200, align: 'left'  },
      { key: 'count', header: 'Cantidad',      w: 80,  align: 'right' },
      { key: 'pct',   header: '% del total',   w: 80,  align: 'right' },
    ];
    y = _pdfTable(doc, cols, byType, y);
  }

  _pdfFooter(doc, meta.generatedBy);
  doc.end();
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateDiagnosesReportPdf
// ─────────────────────────────────────────────────────────────────────────────

async function generateDiagnosesReportPdf ({ rows, meta = {}, clinic = {} }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const buf = streamToBuffer(doc);

  doc.rect(0, 0, 595, 70).fill(C.primary);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(18).text(clinic.name || 'VetManager Pro', 40, 18);
  doc.font('Helvetica').fontSize(10).text('Diagnósticos más frecuentes', 40, 40);
  doc.font('Helvetica').fontSize(9).text(`${meta.from || ''} → ${meta.to || 'hoy'}`, 400, 30, { width: 155, align: 'right' });

  const cols = [
    { key: 'diagnosis_name', header: 'Diagnóstico',  w: 190, align: 'left'  },
    { key: 'diagnosis_code', header: 'Código',       w: 70,  align: 'left'  },
    { key: 'species',        header: 'Especie',      w: 80,  align: 'left'  },
    { key: 'frequency',      header: 'Frecuencia',   w: 70,  align: 'right' },
    { key: 'pct',            header: '% total',      w: 60,  align: 'right' },
  ];

  _pdfTable(doc, cols, rows, 90);
  _pdfFooter(doc, meta.generatedBy);
  doc.end();
  return buf;
}

// ─── Helpers de PDF ───────────────────────────────────────────────────────────

function fmtNum (n) {
  return formatNumber(n);
}

/**
 * Renderiza una tabla en el PDF y devuelve la coordenada Y final.
 */
function _pdfTable (doc, cols, rows, startY) {
  const rowH   = 18;
  const startX = 40;
  let y        = startY;

  // Header de tabla
  doc.rect(startX, y, cols.reduce((s, c) => s + c.w, 0), rowH).fill(C.primary);
  let x = startX;
  cols.forEach(col => {
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9)
      .text(col.header, x + 4, y + 4, { width: col.w - 8, align: col.align || 'left' });
    x += col.w;
  });
  y += rowH;

  // Filas
  rows.forEach((row, ri) => {
    if (y > 750) {   // nueva página
      doc.addPage();
      y = 40;
    }
    const bg = ri % 2 === 0 ? C.white : C.lightGray;
    doc.rect(startX, y, cols.reduce((s, c) => s + c.w, 0), rowH).fill(bg);

    x = startX;
    cols.forEach(col => {
      const val = row[col.key] != null ? String(row[col.key]) : '';
      doc.fillColor(C.dark).font('Helvetica').fontSize(9)
        .text(val, x + 4, y + 4, { width: col.w - 8, align: col.align || 'left' });
      x += col.w;
    });

    // borde inferior
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    doc.moveTo(startX, y + rowH).lineTo(startX + totalW, y + rowH)
      .strokeColor(C.border).lineWidth(0.5).stroke();
    y += rowH;
  });

  return y + 10;
}

function _pdfFooter (doc, generatedBy) {
  const pages = doc.bufferedPageRange ? doc.bufferedPageRange() : null;
  doc.fontSize(8).fillColor(C.gray)
    .text(
      `Generado por: ${generatedBy || 'VetManager'} — ${formatDateTime(new Date())}`,
      40, 800, { align: 'center', width: 515 }
    );
}

module.exports = {
  generateInvoicePdf,
  generateMedicalRecordPdf,
  generateRevenuePdf,
  generateAppointmentsReportPdf,
  generateDiagnosesReportPdf,
};

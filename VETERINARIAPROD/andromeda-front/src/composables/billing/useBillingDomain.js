import { billingApi } from '../../api'

export function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export function normalizeInvoice(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.invoice_id ?? row.invoiceId ?? null,
    invoice_number: row.invoice_number ?? row.number ?? row.invoiceNumber ?? '',
    client_name: row.client_name ?? row.client?.name ?? row.clientName ?? '',
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    email: row.email ?? row.client?.email ?? '',
    currency: row.currency ?? row.currency_code ?? '',
    status: row.status ?? 'draft',
    issued_date: row.issued_date ?? row.issuedDate ?? null,
    due_date: row.due_date ?? row.dueDate ?? null,
    paid_amount: row.paid_amount ?? row.paidAmount ?? 0,
    total_amount: row.total_amount ?? row.totalAmount ?? 0,
  }
}

export function normalizeConsolRow(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    branch_name: row.branch_name ?? row.branchName ?? '',
    overdue_invoices: row.overdue_invoices ?? row.overdueInvoices ?? 0,
    outstanding_amount: row.outstanding_amount ?? row.outstandingAmount ?? 0,
    avg_days_overdue: row.avg_days_overdue ?? row.avgDaysOverdue ?? null,
  }
}

export function normalizeInvoiceDetail(detail) {
  if (!detail || typeof detail !== 'object') return null
  return {
    ...detail,
    id: detail.id ?? detail.invoice_id ?? detail.invoiceId ?? null,
    invoice_number: detail.invoice_number ?? detail.number ?? detail.invoiceNumber ?? '',
    status: detail.status ?? 'draft',
    client_name: detail.client_name ?? detail.client?.name ?? detail.clientName ?? '',
    patient_name: detail.patient_name ?? detail.patient?.name ?? detail.patientName ?? '',
    email: detail.email ?? detail.client_email ?? detail.client?.email ?? '',
    phone: detail.phone ?? detail.client_phone ?? detail.client?.phone ?? '',
    tax_id: detail.tax_id ?? detail.client?.tax_id ?? '',
    species: detail.species ?? '',
    currency: detail.currency ?? detail.currency_code ?? '',
    subtotal: detail.subtotal ?? 0,
    tax_amount: detail.tax_amount ?? detail.taxAmount ?? 0,
    discount_amount: detail.discount_amount ?? detail.discountAmount ?? 0,
    total_amount: detail.total_amount ?? detail.totalAmount ?? 0,
    paid_amount: detail.paid_amount ?? detail.paidAmount ?? null,
    items: asArray(detail.items ?? detail.invoice_items ?? detail.invoiceItems).map((it) => ({
      ...it,
      description: it.description ?? it.name ?? '',
      quantity: it.quantity ?? 0,
      unit_price: it.unit_price ?? it.unitPrice ?? 0,
      total: it.total ?? it.line_total ?? it.lineTotal ?? 0,
    })),
    payments: asArray(detail.payments).map((payment) => ({
      ...payment,
      amount: payment.amount ?? 0,
      payment_method: payment.payment_method ?? payment.paymentMethod ?? '',
      payment_status: payment.payment_status ?? payment.paymentStatus ?? '',
      reference: payment.reference ?? '',
      paid_at: payment.paid_at ?? payment.paidAt ?? null,
    })),
  }
}

export function buildInvoicePayload(form) {
  const payload = {
    clientId: parseInt(form.clientId, 10) || null,
    currencyId: parseInt(form.currencyId || '1', 10),
    items: form.items.filter((item) => item.description).map((item) => ({
      ...(item.serviceId ? { serviceId: parseInt(item.serviceId, 10) } : {}),
      description: item.description,
      quantity: item.quantity || 1,
      unitPrice: parseFloat(item.unit_price) || 0,
      ...(item.tax_pct !== '' ? { taxPct: parseFloat(item.tax_pct) || 0 } : {}),
      ...(item.discount_pct !== '' ? { discountPct: parseFloat(item.discount_pct) || 0 } : {}),
    })),
  }

  if (form.patientId) payload.patientId = parseInt(form.patientId, 10)
  if (form.appointmentId) payload.appointmentId = parseInt(form.appointmentId, 10)
  if (form.dueDate) payload.dueDate = form.dueDate
  if (form.notes) payload.notes = form.notes

  return payload
}

export function filterInvoicesBySearch(rows, needle) {
  const query = String(needle || '').trim().toLowerCase()
  if (!query) return rows
  return rows.filter((row) => [row.invoice_number, row.client_name, row.patient_name, row.email]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query)))
}

export async function listInvoices(filters = {}) {
  const params = { page: filters.page ?? 1, limit: filters.limit ?? 20 }
  if (filters.status) params.status = filters.status
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  // Pasar búsqueda a la API para que opere sobre todos los registros, no solo la página actual
  if (filters.search && filters.search.trim()) params.search = filters.search.trim()

  const { data } = await billingApi.invoices.list(params)
  const rows = asArray(data?.data || data?.invoices || data).map(normalizeInvoice).filter(Boolean)
  const meta = data?.meta || {}
  return {
    rows,
    meta: {
      page: meta.page || params.page,
      totalPages: meta.totalPages || 1,
    },
  }
}

export async function getInvoiceDetail(invoiceId) {
  const { data } = await billingApi.invoices.get(invoiceId)
  return normalizeInvoiceDetail(data?.data || data)
}

export async function createInvoice(form) {
  const payload = buildInvoicePayload(form)
  const { data } = await billingApi.invoices.create(payload)
  return data?.data || data || null
}

export async function cancelInvoice(invoiceId, reason = 'Cancelada desde facturación') {
  const { data } = await billingApi.invoices.cancel(invoiceId, reason)
  return data?.data || data || null
}

export async function markInvoicePaid(invoiceId, paymentMethod) {
  const { data } = await billingApi.invoices.markPaid(invoiceId, paymentMethod)
  return data?.data || data || null
}

export async function loadConsolidatedBilling(filters = {}) {
  const params = {}
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to

  const [summaryRes, outstandingRes] = await Promise.allSettled([
    billingApi.consolidated.summary(params),
    billingApi.consolidated.outstanding(),
  ])
  if (summaryRes.status === 'rejected' && outstandingRes.status === 'rejected') {
    throw summaryRes.reason
  }
  const summaryData = summaryRes.status === 'fulfilled' ? summaryRes.value.data : {}
  const outstandingData = outstandingRes.status === 'fulfilled' ? outstandingRes.value.data : []

  return {
    summary: summaryData?.data || summaryData || {},
    outstanding: asArray(outstandingData?.data || outstandingData)
      .map(normalizeConsolRow)
      .filter(Boolean),
  }
}

export default function useBillingDomain() {
  return {
    asArray,
    normalizeInvoice,
    normalizeConsolRow,
    normalizeInvoiceDetail,
    buildInvoicePayload,
    filterInvoicesBySearch,
    listInvoices,
    getInvoiceDetail,
    createInvoice,
    cancelInvoice,
    markInvoicePaid,
    loadConsolidatedBilling,
  }
}

import { inventoryApi } from '../../api'

export function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export function normalizeInventoryItem(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.item_id ?? row.itemId ?? null,
    name: row.name ?? row.item_name ?? row.itemName ?? '',
    sku: row.sku ?? row.code ?? '',
    item_type: row.item_type ?? row.itemType ?? row.type ?? '',
    quantity_available: row.quantity_available ?? row.quantityAvailable ?? row.quantity ?? row.stock ?? 0,
    minimum_stock: row.minimum_stock ?? row.minimumStock ?? row.min_stock ?? 0,
    reorder_point: row.reorder_point ?? row.reorderPoint ?? null,
    unit_cost: row.unit_cost ?? row.unitCost ?? null,
    sale_price: row.sale_price ?? row.salePrice ?? null,
    expiry_date: row.expiry_date ?? row.expiryDate ?? null,
    supplier_name: row.supplier_name ?? row.supplierName ?? '',
    supplier_id: row.supplier_id ?? row.supplierId ?? null,
    requires_prescription: row.requires_prescription ?? row.requiresPrescription ?? false,
    is_active: row.is_active ?? row.isActive ?? true,
  }
}

export function normalizeAlert(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.alert_id ?? row.alertId ?? null,
    item_name: row.item_name ?? row.itemName ?? row.name ?? '',
    sku: row.sku ?? row.code ?? '',
    alert_type: row.alert_type ?? row.alertType ?? '',
    current_stock: row.current_stock ?? row.currentStock ?? row.stock ?? null,
    threshold: row.threshold ?? row.limit ?? null,
    expiry_date: row.expiry_date ?? row.expiryDate ?? null,
    created_at: row.created_at ?? row.createdAt ?? null,
  }
}

export function normalizeSupplier(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.supplier_id ?? row.supplierId ?? null,
    name: row.name ?? row.company_name ?? row.companyName ?? '',
    tax_id: row.tax_id ?? row.taxId ?? '',
    contact_name: row.contact_name ?? row.contactName ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    payment_terms: row.payment_terms ?? row.paymentTerms ?? 30,
    address: row.address ?? '',
    notes: row.notes ?? '',
  }
}

export function normalizeOrder(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.order_id ?? row.orderId ?? null,
    supplier_id: row.supplier_id ?? row.supplierId ?? null,
    status: row.status ?? '',
    ordered_date: row.ordered_date ?? row.orderedDate ?? null,
    expected_date: row.expected_date ?? row.expectedDate ?? null,
    total: row.total ?? row.amount ?? null,
  }
}

export async function loadInventory(params = {}) {
  const query = { page: params.page ?? 1, limit: params.limit ?? 25 }
  if (params.search) query.search = params.search
  if (params.itemType) query.itemType = params.itemType
  if (params.stockStatus) query.stockStatus = params.stockStatus
  const { data } = await inventoryApi.list(query)
  return {
    rows: asArray(data?.data || data?.items || data).map(normalizeInventoryItem).filter(Boolean),
    meta: data?.meta || { page: query.page, totalPages: 1 },
  }
}

export async function createInventoryItem(form) {
  const payload = {
    name: form.name,
    itemType: form.category,
    salePrice: parseFloat(form.salePrice),
  }
  if (form.sku) payload.sku = form.sku
  if (form.unitCost !== '') payload.unitCost = parseFloat(form.unitCost)
  if (form.minStock !== '') { const v = parseInt(form.minStock, 10); if (!isNaN(v)) payload.minimumStock = v }
  if (form.reorderPoint !== '') { const v = parseInt(form.reorderPoint, 10); if (!isNaN(v)) payload.reorderPoint = v }
  if (form.description) payload.description = form.description
  if (form.supplierId) payload.supplierId = parseInt(form.supplierId, 10)
  payload.requiresPrescription = !!form.requiresPrescription
  payload.isActive = !!form.isActive

  const { data: created } = await inventoryApi.items.create(payload)
  if (parseInt(form.stock, 10) > 0 && created?.id) {
    await inventoryApi.batches.create({
      itemId: created.id,
      lotNumber: 'INICIAL',
      quantityReceived: parseInt(form.stock, 10),
      expiryDate: form.expirationDate || undefined,
    })
  }
  return created?.data || created || null
}

export async function loadInventoryAlerts() {
  const { data } = await inventoryApi.alerts()
  return asArray(data?.data || data?.alerts || data).map(normalizeAlert).filter(Boolean)
}

export async function resolveInventoryAlert(id) {
  return inventoryApi.resolveAlert(id)
}

export async function loadSuppliers() {
  const { data } = await inventoryApi.suppliers.list()
  return asArray(data?.data || data?.suppliers || data).map(normalizeSupplier).filter(Boolean)
}

export async function saveSupplier(supplierForm, editingSupplierId) {
  const payload = {
    name: supplierForm.name,
    taxId: supplierForm.taxId || undefined,
    contactName: supplierForm.contactName || undefined,
    email: supplierForm.email || undefined,
    phone: supplierForm.phone || undefined,
    address: supplierForm.address || undefined,
    paymentTerms: supplierForm.paymentTerms ?? 30,
    notes: supplierForm.notes || undefined,
  }
  if (editingSupplierId) {
    return inventoryApi.suppliers.update(editingSupplierId, payload)
  }
  return inventoryApi.suppliers.create(payload)
}

export async function deleteSupplierById(id) {
  return inventoryApi.suppliers.delete(id)
}

export async function loadPurchaseOrders() {
  const { data } = await inventoryApi.purchaseOrders.list()
  return asArray(data?.data || data?.orders || data).map(normalizeOrder).filter(Boolean)
}

export async function createPurchaseOrder(orderForm) {
  const payload = {
    supplierId: orderForm.supplierId,
    orderedDate: orderForm.orderedDate || undefined,
    expectedDate: orderForm.expectedDate || undefined,
    notes: orderForm.notes || undefined,
    items: orderForm.items.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
      unitCost: item.unitCost !== '' ? parseFloat(item.unitCost) : undefined,
    })),
  }
  return inventoryApi.purchaseOrders.create(payload)
}

export async function sendPurchaseOrder(id) {
  return inventoryApi.purchaseOrders.send(id)
}

export async function cancelPurchaseOrder(id) {
  return inventoryApi.purchaseOrders.cancel(id)
}

export default function useInventoryDomain() {
  return {
    asArray,
    normalizeInventoryItem,
    normalizeAlert,
    normalizeSupplier,
    normalizeOrder,
    loadInventory,
    createInventoryItem,
    loadInventoryAlerts,
    resolveInventoryAlert,
    loadSuppliers,
    saveSupplier,
    deleteSupplierById,
    loadPurchaseOrders,
    createPurchaseOrder,
    sendPurchaseOrder,
    cancelPurchaseOrder,
  }
}

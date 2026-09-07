<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">💰</span>
        <div>
          <h2 class="page-title">{{ t('billing.title') }}</h2>
          <p class="page-sub">{{ t('billing.subtitle') }}</p>
        </div>
      </div>
      <BaseButton v-if="activeTab === 'facturas'" type="button" @click="openModal()">{{ t('billing.newInvoice') }}</BaseButton>
    </div>

    <!-- Tab Navigation -->
    <div class="tab-nav">
      <button
        class="tab-btn"
        :class="{ 'tab-btn--active': activeTab === 'facturas' }"
        @click="activeTab = 'facturas'"
      >💰 {{ t('billing.invoicesTab') }}</button>
      <button
        class="tab-btn"
        :class="{ 'tab-btn--active': activeTab === 'consolidado' }"
        @click="activeTab = 'consolidado'"
      >📊 {{ t('billing.consolidatedTab') }}</button>
    </div>

    <!-- ===== TAB: FACTURAS ===== -->
    <template v-if="activeTab === 'facturas'">

      <!-- KPIs financieros -->
      <div class="kpi-row">
        <div class="kpi-card" style="--bc:#D6F3EC;--tc:#1A9E7F">
          <span class="kpi-icon">💵</span>
          <div>
            <strong>${{ summary.paid }}</strong>
            <span>{{ t('billing.paidToday') }}</span>
          </div>
        </div>
        <div class="kpi-card" style="--bc:#FFF3CC;--tc:#8A6200">
          <span class="kpi-icon">⏳</span>
          <div>
            <strong>{{ summary.pending }}</strong>
            <span>{{ t('billing.pending') }}</span>
          </div>
        </div>
        <div class="kpi-card" style="--bc:#FDEAEA;--tc:#c0392b">
          <span class="kpi-icon">❌</span>
          <div>
            <strong>{{ summary.overdue }}</strong>
            <span>{{ t('billing.overdue') }}</span>
          </div>
        </div>
        <div class="kpi-card" style="--bc:#D6EEFF;--tc:#1A5FAA">
          <span class="kpi-icon">📋</span>
          <div>
            <strong>{{ summary.total }}</strong>
            <span>{{ t('billing.issuedToday') }}</span>
          </div>
        </div>
      </div>

      <!-- Filtros -->
      <div class="filters">
        <label for="billing-date-from" class="sr-only">{{ t('billing.from') }}</label>
        <input id="billing-date-from" name="billing-date-from" v-model="dateFrom" type="date" class="filter-input" @change="load()" />
        <label for="billing-date-to" class="sr-only">{{ t('billing.to') }}</label>
        <input id="billing-date-to" name="billing-date-to" v-model="dateTo" type="date" class="filter-input" @change="load()" />
        <label for="billing-status-filter" class="sr-only">{{ t('billing.allStatuses') }}</label>
        <select id="billing-status-filter" name="billing-status-filter" v-model="statusFilter" class="filter-select" @change="load()">
          <option value="">{{ t('billing.allStatuses') }}</option>
          <option value="draft">{{ t('billing.draft') }}</option>
          <option value="pending">{{ t('billing.pendingStatus') }}</option>
          <option value="paid">{{ t('billing.paidStatus') }}</option>
          <option value="overdue">{{ t('billing.overdueStatus') }}</option>
          <option value="cancelled">{{ t('billing.cancelledStatus') }}</option>
        </select>
        <label for="billing-search" class="sr-only">{{ t('billing.searchPlaceholder') }}</label>
        <input id="billing-search" name="billing-search" v-model.trim="search" type="search" :placeholder="t('billing.searchPlaceholder')" class="filter-input filter-input--grow" @input="debouncedLoad()" />
      </div>

      <div v-if="loading" class="loading-state" role="status" aria-live="polite"><span class="spin spin--dark" /> {{ t('billing.loading') }}</div>
      <div v-else-if="error" class="alert alert--error" role="alert">{{ error }}</div>
      <div v-else-if="items.length === 0" class="empty-state">
        <span class="empty-state__emoji">💰</span>
        <p>{{ t('billing.empty') }}</p>
      </div>

      <div v-else class="card">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('billing.invoiceNumber') }}</th>
              <th>{{ t('billing.clientPatient') }}</th>
              <th>{{ t('billing.issueDate') }}</th>
              <th>{{ t('billing.dueDate') }}</th>
              <th>Moneda</th>
              <th>Pagado</th>
              <th>{{ t('billing.total') }}</th>
              <th>{{ t('billing.status') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in items" :key="inv.id">
              <td><strong class="inv-num">{{ inv.invoice_number || inv.number || `#${inv.id}` }}</strong></td>
              <td>
                <div>
                  <strong>{{ inv.client_name || inv.owner_name || '—' }}</strong>
                  <span class="sub">{{ inv.patient_name || '' }}</span>
                </div>
              </td>
              <td class="sub">{{ formatDate(inv.issued_date) }}</td>
              <td :class="dueDateClass(inv.due_date)">{{ formatDate(inv.due_date) }}</td>
              <td class="sub">{{ inv.currency || '—' }}</td>
              <td class="sub">${{ formatMoney(inv.paid_amount) }}</td>
              <td><strong>${{ formatMoney(inv.total_amount) }}</strong></td>
              <td><span class="badge" :class="`inv-${inv.status}`">{{ invoiceStatusLabel(inv.status) }}</span></td>
              <td>
                <div class="row-actions">
                  <button type="button" v-if="inv.status === 'pending' || inv.status === 'draft'" class="btn-xs btn-xs--green" @click="openPayModal(inv)">{{ t('billing.markPaid') }}</button>
                  <button type="button" class="btn-xs btn-xs--blue" @click="viewInvoice(inv)" :title="t('billing.viewDetail')">👁</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pagination.totalPages > 1" class="pagination">
        <button type="button" :disabled="pagination.page <= 1" @click="load(pagination.page - 1)">{{ t('billing.previous') }}</button>
        <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
        <button :disabled="pagination.page >= pagination.totalPages" @click="load(pagination.page + 1)">{{ t('billing.next') }}</button>
      </div>

    </template>

    <!-- ===== TAB: CONSOLIDADO ===== -->
    <template v-else-if="activeTab === 'consolidado'">
      <div class="consol-filters card">
        <div class="consol-filters__inner">
          <div class="field">
            <label for="billing-consol-from">{{ t('billing.from') }}</label>
            <input id="billing-consol-from" name="billing-consol-from" v-model="consolFrom" type="date" class="filter-input" />
          </div>
          <div class="field">
            <label for="billing-consol-to">{{ t('billing.to') }}</label>
            <input id="billing-consol-to" name="billing-consol-to" v-model="consolTo" type="date" class="filter-input" />
          </div>
          <button type="button" class="btn-primary" @click="loadConsolidated()" :disabled="consolLoading">
            <span v-if="consolLoading" class="spin spin--sm" />
            <span v-else>{{ t('billing.search') }}</span>
          </button>
        </div>
      </div>

      <div v-if="consolLoading" class="loading-state"><span class="spin spin--dark" /> {{ t('billing.loadingSummary') }}</div>
      <div v-else-if="consolError" class="alert alert--error">{{ consolError }}</div>

      <template v-else-if="consolSummary">
        <!-- Summary KPI Cards -->
        <div class="section-title">{{ t('billing.summaryTitle') }}</div>
        <div class="kpi-row">
          <template v-for="(value, key) in consolSummary" :key="key">
            <div v-if="value !== null && value !== undefined" class="kpi-card" style="--bc:#EEF2FF;--tc:#3730A3">
              <span class="kpi-icon">📊</span>
              <div>
                <strong>{{ formatConsolValue(key, value) }}</strong>
                <span>{{ formatConsolLabel(key) }}</span>
              </div>
            </div>
          </template>
        </div>

        <!-- Outstanding Table -->
        <div class="section-title" style="margin-top:8px">{{ t('billing.overdueByBranchTitle') }}</div>
        <div v-if="!consolOutstanding || consolOutstanding.length === 0" class="empty-state" style="padding:30px">
          <span class="empty-state__emoji">✅</span>
          <p>{{ t('billing.emptyOverdue') }}</p>
        </div>
        <div v-else class="card">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('billing.branch') }}</th>
                <th>{{ t('billing.overdueInvoices') }}</th>
                <th>{{ t('billing.pendingAmount') }}</th>
                <th>{{ t('billing.avgOverdueDays') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in consolOutstanding" :key="row.branch_name">
                <td><strong>{{ row.branch_name || '—' }}</strong></td>
                <td><span class="badge inv-overdue">{{ row.overdue_invoices }}</span></td>
                <td><strong class="text-danger">${{ formatMoney(row.outstanding_amount) }}</strong></td>
                <td>{{ row.avg_days_overdue != null ? Math.round(row.avg_days_overdue) + ' días' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <div v-else class="empty-state">
        <span class="empty-state__emoji">📊</span>
        <p>{{ t('billing.selectRangePrompt') }}</p>
      </div>
    </template>

    <!-- ==================== MODAL: Nueva factura ==================== -->
    <Transition name="modal">
      <div v-if="showModal" class="modal-backdrop" @click.self="closeModal()">
        <div class="modal">
          <div class="modal__header">
            <h3>💰 {{ t('billing.newModalTitle') }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="closeModal()">✕</BaseButton>
          </div>
          <form @submit.prevent="handleCreate" novalidate>
            <div class="form-body">
              <div class="form-grid">
                <div class="field">
                  <label for="billing-client-id">{{ t('billing.clientIdLabel') }} <span class="req">*</span></label>
                  <input id="billing-client-id" name="billing-client-id" v-model.trim="form.clientId" type="text" :placeholder="t('billing.clientIdLabel')" :disabled="saving" required />
                  <span v-if="fe.clientId" class="field-error">{{ fe.clientId }}</span>
                </div>
                <div class="field">
                  <label for="billing-patient-id">{{ t('billing.patientIdLabel') }}</label>
                  <input id="billing-patient-id" name="billing-patient-id" v-model.trim="form.patientId" type="text" :placeholder="t('billing.patientIdLabel')" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="billing-appointment-id">Turno ID</label>
                  <input id="billing-appointment-id" name="billing-appointment-id" v-model.trim="form.appointmentId" type="text" placeholder="Opcional" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="billing-due-date">{{ t('billing.dueDateLabel') }}</label>
                  <input id="billing-due-date" name="billing-due-date" v-model="form.dueDate" type="date" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="billing-currency-id">Moneda ID</label>
                  <input id="billing-currency-id" name="billing-currency-id" v-model.trim="form.currencyId" type="text" placeholder="1" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="billing-payment-method">{{ t('billing.paymentMethodLabel') }}</label>
                  <select id="billing-payment-method" name="billing-payment-method" v-model="form.paymentMethod" :disabled="saving">
                    <option value="">{{ t('billing.noSpecific') }}</option>
                    <option value="cash">{{ t('billing.cash') }}</option>
                    <option value="credit_card">{{ t('billing.creditCard') }}</option>
                    <option value="debit_card">{{ t('billing.debitCard') }}</option>
                    <option value="bank_transfer">{{ t('billing.bankTransfer') }}</option>
                    <option value="other">{{ t('billing.other') }}</option>
                  </select>
                </div>
              </div>

              <!-- Ítems -->
              <div class="items-section">
                <div class="items-header">
                  <span class="section-label">{{ t('billing.itemsLabel') }}</span>
                  <button type="button" class="btn-add-item" @click="addItem()">+ {{ t('billing.addItem') }}</button>
                </div>
                <div class="items-list">
                  <div v-for="(item, idx) in form.items" :key="idx" class="item-row">
                    <input :id="`billing-item-service-${idx}`" :name="`billing-item-service-${idx}`" v-model.trim="item.serviceId" type="text" placeholder="Srv ID" class="item-svc" :disabled="saving" aria-label="Servicio del item" />
                    <input :id="`billing-item-description-${idx}`" :name="`billing-item-description-${idx}`" v-model.trim="item.description" type="text" :placeholder="t('billing.descriptionPlaceholder')" class="item-desc" :disabled="saving" :aria-label="t('billing.descriptionPlaceholder')" />
                    <input :id="`billing-item-quantity-${idx}`" :name="`billing-item-quantity-${idx}`" v-model.number="item.quantity" type="number" min="1" :placeholder="t('billing.quantityPlaceholder')" class="item-qty" :disabled="saving" :aria-label="t('billing.quantityPlaceholder')" />
                    <input :id="`billing-item-unit-price-${idx}`" :name="`billing-item-unit-price-${idx}`" v-model.number="item.unit_price" type="number" min="0" step="0.01" :placeholder="t('billing.unitPricePlaceholder')" class="item-price" :disabled="saving" :aria-label="t('billing.unitPricePlaceholder')" />
                    <input :id="`billing-item-tax-${idx}`" :name="`billing-item-tax-${idx}`" v-model.number="item.tax_pct" type="number" min="0" step="0.01" placeholder="% IVA" class="item-tax" :disabled="saving" aria-label="IVA del item" />
                    <input :id="`billing-item-discount-${idx}`" :name="`billing-item-discount-${idx}`" v-model.number="item.discount_pct" type="number" min="0" step="0.01" placeholder="% Desc." class="item-tax" :disabled="saving" aria-label="Descuento del item" />
                    <span class="item-total">${{ ((item.quantity || 0) * (item.unit_price || 0)).toFixed(2) }}</span>
                    <button type="button" class="btn-del-item" @click="removeItem(idx)" :disabled="form.items.length <= 1">✕</button>
                  </div>
                </div>
                <div class="items-total">
                  <span>{{ t('billing.totalLabel') }}</span>
                  <strong>${{ invoiceTotal.toFixed(2) }}</strong>
                </div>
              </div>

              <div class="field">
                <label for="billing-notes">{{ t('billing.notesLabel') }}</label>
                <textarea id="billing-notes" name="billing-notes" v-model.trim="form.notes" rows="2" :placeholder="t('billing.notesPlaceholder')" :disabled="saving" />
              </div>
            </div>
            <div v-if="saveError" class="alert alert--error mx" role="alert">{{ saveError }}</div>
            <div class="modal__actions">
              <BaseButton type="button" variant="ghost" @click="closeModal()" :disabled="saving">{{ t('common.cancel') }}</BaseButton>
              <BaseButton type="submit" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" /> <span v-else>{{ t('billing.emitInvoice') }}</span>
              </BaseButton>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- ==================== MODAL: Ver detalle de factura ==================== -->
    <Transition name="modal">
      <div v-if="showViewModal" class="modal-backdrop" @click.self="closeViewModal()">
        <div class="modal modal--detail">
          <div class="modal__header">
            <h3>📄 {{ t('billing.detailTitle') }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="closeViewModal()">✕</BaseButton>
          </div>

          <div v-if="detailLoading" class="detail-loading" role="status" aria-live="polite">
            <span class="spin spin--dark" /> {{ t('billing.loadingDetail') }}
          </div>
          <div v-else-if="detailError" class="alert alert--error mx" style="margin:16px 24px" role="alert">{{ detailError }}</div>
          <template v-else-if="detailInvoice">
            <div class="detail-body">

              <!-- Cabecera con número y monto -->
              <div class="detail-hero">
                <div>
                  <span class="detail-inv-num">{{ detailInvoice.invoice_number || `#${detailInvoice.id}` }}</span>
                  <span class="badge" :class="`inv-${detailInvoice.status}`" style="margin-left:10px">{{ invoiceStatusLabel(detailInvoice.status) }}</span>
                </div>
                <div class="detail-amount">${{ formatMoney(detailInvoice.total_amount) }}</div>
              </div>

              <!-- Info grid -->
              <div class="detail-grid">
                <div class="detail-field">
                  <span class="detail-label">{{ t('billing.clientLabel') }}</span>
                  <span class="detail-value">{{ detailInvoice.client_name || '—' }}</span>
                </div>
                <div class="detail-field" v-if="detailInvoice.email">
                  <span class="detail-label">Email</span>
                  <span class="detail-value">{{ detailInvoice.email }}</span>
                </div>
                <div class="detail-field" v-if="detailInvoice.phone">
                  <span class="detail-label">Teléfono</span>
                  <span class="detail-value">{{ detailInvoice.phone }}</span>
                </div>
                <div class="detail-field" v-if="detailInvoice.tax_id">
                  <span class="detail-label">CUIT / Doc.</span>
                  <span class="detail-value">{{ detailInvoice.tax_id }}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">{{ t('billing.patientLabel') }}</span>
                  <span class="detail-value">{{ detailInvoice.patient_name || '—' }}</span>
                </div>
                <div class="detail-field" v-if="detailInvoice.species">
                  <span class="detail-label">Especie</span>
                  <span class="detail-value">{{ detailInvoice.species }}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">{{ t('billing.issuedDateLabel') }}</span>
                  <span class="detail-value">{{ formatDate(detailInvoice.issued_date) }}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">{{ t('billing.dueDateLabel') }}</span>
                  <span class="detail-value" :class="dueDateClass(detailInvoice.due_date)">{{ formatDate(detailInvoice.due_date) }}</span>
                </div>
                <div v-if="detailInvoice.paid_amount != null" class="detail-field">
                  <span class="detail-label">{{ t('billing.amountPaidLabel') }}</span>
                  <span class="detail-value">${{ formatMoney(detailInvoice.paid_amount) }}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Moneda</span>
                  <span class="detail-value">{{ detailInvoice.currency || '—' }}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Subtotal</span>
                  <span class="detail-value">${{ formatMoney(detailInvoice.subtotal) }}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Impuestos</span>
                  <span class="detail-value">${{ formatMoney(detailInvoice.tax_amount) }}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Descuento</span>
                  <span class="detail-value">${{ formatMoney(detailInvoice.discount_amount) }}</span>
                </div>
              </div>

              <!-- Notas -->
              <div v-if="detailInvoice.notes" class="detail-notes">
                <span class="detail-label">{{ t('billing.notesLabel') }}</span>
                <p>{{ detailInvoice.notes }}</p>
              </div>

              <!-- Items -->
              <div v-if="detailInvoice.items && detailInvoice.items.length" class="detail-items">
                <div class="detail-label" style="margin-bottom:8px">{{ t('billing.itemsLabel') }}</div>
                <table class="table table--compact">
                  <thead>
                    <tr>
                      <th>{{ t('billing.descriptionHeader') }}</th>
                      <th style="text-align:right">{{ t('billing.quantityHeader') }}</th>
                      <th style="text-align:right">{{ t('billing.unitPriceHeader') }}</th>
                      <th style="text-align:right">{{ t('billing.totalHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(it, idx) in detailInvoice.items" :key="idx">
                      <td>{{ it.description }}</td>
                      <td style="text-align:right">{{ it.quantity }}</td>
                      <td style="text-align:right">${{ formatMoney(it.unit_price) }}</td>
                      <td style="text-align:right"><strong>${{ formatMoney(it.total) }}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="detailInvoice.payments && detailInvoice.payments.length" class="detail-items">
                <div class="detail-label" style="margin-bottom:8px">Pagos registrados</div>
                <table class="table table--compact">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Método</th>
                      <th>Referencia</th>
                      <th>Estado</th>
                      <th style="text-align:right">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="payment in detailInvoice.payments" :key="payment.id || payment.reference || payment.paid_at">
                      <td>{{ formatDate(payment.paid_at) }}</td>
                      <td>{{ payment.payment_method || '—' }}</td>
                      <td>{{ payment.reference || '—' }}</td>
                      <td>{{ payment.payment_status || '—' }}</td>
                      <td style="text-align:right"><strong>${{ formatMoney(payment.amount) }}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Actions -->
            <div v-if="detailError2" class="alert alert--error mx" role="alert">{{ detailError2 }}</div>
            <div class="modal__actions">
              <BaseButton type="button" variant="ghost" @click="closeViewModal()">{{ t('common.close') }}</BaseButton>
              <BaseButton
                v-if="detailInvoice.status !== 'paid' && detailInvoice.status !== 'cancelled'"
                type="button"
                variant="danger"
                :disabled="cancellingInvoice"
                @click="cancelInvoice(detailInvoice)"
              >
                <span v-if="cancellingInvoice" class="spin spin--sm" />
                <span v-else>{{ t('billing.cancelInvoice') }}</span>
              </BaseButton>
            </div>
          </template>
        </div>
      </div>
    </Transition>

    <!-- ==================== MODAL: Marcar como pagado ==================== -->
    <Transition name="modal">
      <div v-if="showPayModal" class="modal-backdrop" @click.self="closePayModal()">
        <div class="modal modal--sm">
          <div class="modal__header">
            <h3>💳 {{ t('billing.registerPayment') }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="closePayModal()">✕</BaseButton>
          </div>
          <div class="form-body">
            <p class="pay-invoice-ref">
              {{ t('billing.invoiceRef') }} <strong>{{ payTarget?.invoice_number || '#' + payTarget?.id }}</strong> —
              <strong>${{ formatMoney(payTarget?.total_amount) }}</strong>
            </p>
            <div class="field">
              <label for="billing-pay-method">{{ t('billing.paymentMethodLabel') }} <span class="req">*</span></label>
              <select id="billing-pay-method" name="billing-pay-method" v-model="payMethod" :disabled="payingSaving">
                <option value="">{{ t('billing.selectPaymentMethod') }}</option>
                <option value="cash">{{ t('billing.cash') }}</option>
                <option value="credit_card">{{ t('billing.creditCard') }}</option>
                <option value="debit_card">{{ t('billing.debitCard') }}</option>
                <option value="bank_transfer">{{ t('billing.bankTransfer') }}</option>
                <option value="other">{{ t('billing.other') }}</option>
              </select>
              <span v-if="payMethodError" class="field-error">{{ payMethodError }}</span>
            </div>
          </div>
          <div v-if="payError" class="alert alert--error mx" role="alert">{{ payError }}</div>
          <div class="modal__actions">
            <BaseButton type="button" variant="ghost" @click="closePayModal()" :disabled="payingSaving">{{ t('common.cancel') }}</BaseButton>
            <BaseButton type="button" :disabled="payingSaving" @click="confirmMarkPaid()">
              <span v-if="payingSaving" class="spin spin--sm" />
              <span v-else>{{ t('billing.confirmPayment') }}</span>
            </BaseButton>
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { t } from '../i18n'
import BaseButton from '../components/base/BaseButton.vue'
import { extractDetailedErrorMessage } from '../utils/errors'
import { useUiFeedback } from '../composables/useUiFeedback'
import {
  cancelInvoice as cancelInvoiceRequest,
  createInvoice as createInvoiceRequest,
  filterInvoicesBySearch,
  getInvoiceDetail as getInvoiceDetailRequest,
  listInvoices,
  loadConsolidatedBilling,
  markInvoicePaid as markInvoicePaidRequest,
} from '../composables/billing/useBillingDomain'

const { confirm, success, notifyError } = useUiFeedback()

// ── Tab ──────────────────────────────────────────────────────────────────────
const activeTab = ref('facturas')

// ── Shared helpers ────────────────────────────────────────────────────────────
function invoiceStatusLabel(status) {
  return {
    draft: t('billing.draft'),
    pending: t('billing.pendingStatus'),
    paid: t('billing.paidStatus'),
    overdue: t('billing.overdueStatus'),
    cancelled: t('billing.cancelledStatus'),
  }[status] || status || '—'
}

function formatMoney(n) {
  return parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function dueDateClass(dt) {
  if (!dt) return ''
  const days = (new Date(dt) - Date.now()) / (1000 * 60 * 60 * 24)
  if (days < 0)  return 'overdue'
  if (days < 7)  return 'due-soon'
  return ''
}

// ── Facturas list ─────────────────────────────────────────────────────────────
const items = ref([])
const loading = ref(false)
const error   = ref('')
const search  = ref('')
const dateFrom = ref(new Date().toISOString().split('T')[0])
const dateTo   = ref('')
const statusFilter = ref('')
const pagination = ref({ page: 1, totalPages: 1 })
const summary = ref({ paid: '0', pending: 0, overdue: 0, total: 0 })

async function load(page = 1) {
  loading.value = true; error.value = ''
  try {
    const { rows, meta } = await listInvoices({
      page,
      limit: 20,
      status: statusFilter.value,
      from: dateFrom.value,
      to: dateTo.value,
      search: search.value, // búsqueda server-side para operar sobre todos los registros
    })
    items.value = rows
    pagination.value = meta
    computeSummary()
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar las facturas', { context: 'Carga de facturas' })
  } finally { loading.value = false }
}

function computeSummary() {
  const all = items.value
  summary.value.total   = all.length
  summary.value.pending = all.filter(i => i.status === 'pending').length
  summary.value.overdue = all.filter(i => i.status === 'overdue').length
  const paid = all.filter(i => i.status === 'paid').reduce((s, i) => s + parseFloat(i.total_amount || 0), 0)
  summary.value.paid = paid.toLocaleString('es-AR', { minimumFractionDigits: 2 })
}

let timer = null
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 350) }

// ── Modal: Nueva factura ──────────────────────────────────────────────────────
const showModal = ref(false)
const saving    = ref(false)
const saveError = ref('')
const fe        = reactive({})

const form = reactive({
  clientId: '', patientId: '', appointmentId: '', dueDate: '', currencyId: '1', paymentMethod: '',
  items: [{ serviceId: '', description: '', quantity: 1, unit_price: '', tax_pct: '', discount_pct: '' }],
  notes: '',
})

const invoiceTotal = computed(() =>
  form.items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0)
)

function addItem()        { form.items.push({ serviceId: '', description: '', quantity: 1, unit_price: '', tax_pct: '', discount_pct: '' }) }
function removeItem(idx)  { form.items.splice(idx, 1) }
function openModal()      { resetForm(); showModal.value = true }
function closeModal()     { showModal.value = false; resetForm() }

function resetForm() {
  form.clientId = ''; form.patientId = ''; form.appointmentId = ''; form.dueDate = ''; form.currencyId = '1'; form.paymentMethod = ''
  form.items = [{ serviceId: '', description: '', quantity: 1, unit_price: '', tax_pct: '', discount_pct: '' }]; form.notes = ''
  saveError.value = ''; Object.keys(fe).forEach(k => delete fe[k])
}

function validate() {
  Object.keys(fe).forEach(k => delete fe[k])
  if (!form.clientId) fe.clientId = 'Requerido'
  for (const item of form.items) {
    if ((item.quantity || 0) < 1) {
      saveError.value = 'La cantidad debe ser mayor a 0'
      return false
    }
    if ((item.unit_price || 0) < 0) {
      saveError.value = 'El precio unitario no puede ser negativo'
      return false
    }
    const tax = parseFloat(item.tax_pct) || 0
    const disc = parseFloat(item.discount_pct) || 0
    if (tax < 0 || tax > 100 || disc < 0 || disc > 100) {
      saveError.value = 'Los porcentajes deben estar entre 0 y 100'
      return false
    }
  }
  return Object.keys(fe).length === 0
}

async function handleCreate() {
  if (!validate()) return
  saving.value = true; saveError.value = ''
  try {
    const created = await createInvoiceRequest(form)
    if (form.paymentMethod && created?.id) {
      await markInvoicePaidRequest(created.id, form.paymentMethod)
    }
    closeModal(); await load()
  } catch (e) {
    saveError.value = extractDetailedErrorMessage(e, 'No se pudo emitir la factura', { context: 'Emision de factura' })
  } finally { saving.value = false }
}

// ── Modal: Ver detalle ────────────────────────────────────────────────────────
const showViewModal    = ref(false)
const detailLoading    = ref(false)
const detailError      = ref('')
const detailError2     = ref('')
const detailInvoice    = ref(null)
const cancellingInvoice = ref(false)

async function viewInvoice(inv) {
  detailInvoice.value = null
  detailError.value   = ''
  detailError2.value  = ''
  showViewModal.value = true
  detailLoading.value = true
  try {
    detailInvoice.value = await getInvoiceDetailRequest(inv.id)
  } catch (e) {
    detailError.value = extractDetailedErrorMessage(e, 'No se pudo cargar el detalle', { context: 'Detalle de factura' })
  } finally {
    detailLoading.value = false
  }
}

function closeViewModal() {
  showViewModal.value  = false
  detailInvoice.value  = null
  detailError.value    = ''
  detailError2.value   = ''
}

async function cancelInvoice(inv) {
  const invoiceLabel = inv.invoice_number || '#' + inv.id
  const ok = await confirm({
    title: 'Cancelar factura',
    message: t('billing.cancelInvoiceConfirm', { invoice: invoiceLabel }) || `Cancelar la factura ${invoiceLabel}?`,
    confirmText: 'Cancelar factura',
    variant: 'danger',
  })
  if (!ok) return
  cancellingInvoice.value = true
  detailError2.value = ''
  try {
    const data = await cancelInvoiceRequest(inv.id)
    detailInvoice.value = { ...detailInvoice.value, status: data?.status || 'cancelled' }
    // Update the row in the list without reloading
    const row = items.value.find(i => String(i.id) === String(inv.id))
    if (row) row.status = 'cancelled'
    computeSummary()
    success('Factura cancelada correctamente.')
  } catch (e) {
    notifyError('facturacion.cancelInvoice', e, 'No se pudo cancelar la factura', { context: 'Cancelación de factura' })
    detailError2.value = extractDetailedErrorMessage(e, 'No se pudo cancelar la factura', { context: 'Cancelación de factura' })
  } finally {
    cancellingInvoice.value = false
  }
}

// ── Modal: Marcar pago ────────────────────────────────────────────────────────
const showPayModal   = ref(false)
const payTarget      = ref(null)
const payMethod      = ref('')
const payMethodError = ref('')
const payError       = ref('')
const payingSaving   = ref(false)

function openPayModal(inv) {
  payTarget.value      = inv
  payMethod.value      = ''
  payMethodError.value = ''
  payError.value       = ''
  showPayModal.value   = true
}

function closePayModal() {
  showPayModal.value = false
  payTarget.value    = null
}

async function confirmMarkPaid() {
  payMethodError.value = ''
  if (!payMethod.value) { payMethodError.value = t('billing.paymentMethodRequired'); return }
  payingSaving.value = true; payError.value = ''
  try {
    await markInvoicePaidRequest(payTarget.value.id, payMethod.value)
    const row = items.value.find(i => String(i.id) === String(payTarget.value.id))
    if (row) row.status = 'paid'
    computeSummary()
    closePayModal()
  } catch (e) {
    payError.value = extractDetailedErrorMessage(e, 'No se pudo registrar el pago', { context: 'Registro de pago' })
  } finally {
    payingSaving.value = false
  }
}

// ── Tab: Consolidado ──────────────────────────────────────────────────────────
const now = new Date()
const consolFrom = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
const consolTo   = ref(now.toISOString().split('T')[0])
const consolLoading   = ref(false)
const consolError     = ref('')
const consolSummary   = ref(null)
const consolOutstanding = ref(null)

// Labels for summary keys
const CONSOL_LABELS = {
  total_revenue:   t('billing.totalRevenue'),
  total_invoices:  t('billing.totalInvoices'),
  paid_invoices:   t('billing.paidInvoices'),
  pending_invoices: t('billing.pendingInvoices'),
  overdue_invoices: t('billing.overdueInvoicesLabel'),
  avg_invoice_amount: t('billing.avgInvoiceAmount'),
  cancelled_invoices: t('billing.cancelledInvoices'),
  collection_rate: t('billing.collectionRate'),
}
const MONEY_KEYS = ['total_revenue', 'avg_invoice_amount', 'total_amount', 'paid_amount', 'outstanding_amount']
const PERCENT_KEYS = ['collection_rate']

function formatConsolLabel(key) {
  return CONSOL_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function formatConsolValue(key, value) {
  if (MONEY_KEYS.some(k => key.includes(k.split('_')[0]) && key.includes('amount') || key === k)) {
    return '$' + parseFloat(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })
  }
  if (PERCENT_KEYS.includes(key)) return (parseFloat(value) * 100).toFixed(1) + '%'
  if (typeof value === 'number') return value.toLocaleString('es-AR')
  return value
}

async function loadConsolidated() {
  consolLoading.value = true
  consolError.value   = ''
  consolSummary.value = null
  consolOutstanding.value = null
  try {
    const { summary, outstanding } = await loadConsolidatedBilling({
      from: consolFrom.value,
      to: consolTo.value,
    })
    consolSummary.value = summary
    consolOutstanding.value = outstanding
  } catch (e) {
    consolError.value = extractDetailedErrorMessage(e, 'No se pudo cargar el consolidado', { context: 'Consolidado de facturacion' })
  } finally {
    consolLoading.value = false
  }
}

onMounted(load)
onUnmounted(() => clearTimeout(timer))
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.page { display: flex; flex-direction: column; gap: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.page-header__left { display: flex; align-items: center; gap: 14px; }
.page-emoji { font-size: 2rem; }
.page-title { font-size: 1.35rem; font-weight: 700; color: var(--text); }
.page-sub   { font-size: 0.82rem; color: var(--text-2); margin-top: 2px; }

/* ── Tab navigation ── */
.tab-nav { display: flex; gap: 4px; border-bottom: 2px solid var(--border); padding-bottom: 0; }
.tab-btn { padding: 10px 20px; border: none; background: none; cursor: pointer; font-size: 0.9rem; font-weight: 600; color: var(--text-3); border-bottom: 2px solid transparent; margin-bottom: -2px; transition: color var(--transition), border-color var(--transition); border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
.tab-btn:hover { color: var(--primary); background: var(--surface); }
.tab-btn--active { color: var(--primary); border-bottom-color: var(--primary); background: var(--white); }

/* ── KPIs ── */
.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.kpi-card { background: var(--bc); border-radius: var(--radius-lg); padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
.kpi-icon { font-size: 1.6rem; }
.kpi-card strong { display: block; font-size: 1.2rem; font-weight: 700; color: var(--tc); }
.kpi-card span   { font-size: 0.72rem; color: var(--tc); opacity: 0.8; }

/* ── Filters ── */
.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input, .filter-select { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; }
.filter-input:focus, .filter-select:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 180px; }

/* ── Table ── */
.card { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow); overflow: hidden; }
.table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.table th { text-align: left; padding: 12px 14px; font-size: 0.78rem; font-weight: 600; color: var(--text-3); letter-spacing: 0.05em; text-transform: uppercase; background: var(--surface); border-bottom: 1px solid var(--border); }
.table td { padding: 12px 14px; border-bottom: 1px solid #f0f0f0; color: var(--text); vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.table tr:hover td { background: var(--surface); }
.table--compact th, .table--compact td { padding: 9px 12px; }

.inv-num { font-family: monospace; font-size: 0.9rem; color: var(--primary); }
.sub { display: block; font-size: 0.75rem; color: var(--text-3); }
.overdue  { color: #c0392b; font-weight: 600; }
.due-soon { color: #d68910; }
.text-danger { color: #c0392b; }

.badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; }
.inv-draft     { background: var(--surface-2); color: var(--text-3); }
.inv-pending   { background: #FFF3CC; color: #8A6200; }
.inv-paid      { background: #D6F3EC; color: #1A9E7F; }
.inv-overdue   { background: #FDEAEA; color: #c0392b; }
.inv-cancelled { background: var(--surface-2); color: var(--text-3); }

.row-actions { display: flex; gap: 6px; }
.btn-xs { padding: 4px 10px; border: none; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.btn-xs:hover { opacity: 0.8; }
.btn-xs--green { background: #D6F3EC; color: #1A9E7F; }
.btn-xs--blue  { background: #D6EEFF; color: #1A5FAA; }

.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 0.85rem; color: var(--text-2); }
.pagination button { padding: 6px 14px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; font-size: 0.82rem; color: var(--text-2); }
.pagination button:hover:not(:disabled) { background: var(--surface-2); }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Buttons ── */
.btn-primary { padding: 10px 20px; background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity var(--transition), transform var(--transition); }
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { padding: 10px 20px; background: none; border: 1.5px solid var(--border); border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background var(--transition); }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }
.btn-danger { padding: 10px 20px; background: #FDEAEA; color: #c0392b; border: 1.5px solid #f5c6c6; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background var(--transition); }
.btn-danger:hover:not(:disabled) { background: #f8d7d7; }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Modals ── */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 600px; max-height: 92vh; overflow-y: auto; }
.modal--detail { max-width: 680px; }
.modal--sm { max-width: 420px; }
.modal__header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--white); z-index: 1; }
.modal__header h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.modal__close { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm); }
.modal__close:hover { background: var(--surface-2); }
.form-body { padding: 20px 24px 0; display: flex; flex-direction: column; gap: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field label { font-size: 0.82rem; font-weight: 600; color: var(--text-2); }
.field input, .field select, .field textarea { padding: 9px 12px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.9rem; color: var(--text); background: var(--surface); outline: none; transition: border-color var(--transition); }
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); }
.field textarea { resize: vertical; }
.field-error { font-size: 0.75rem; color: var(--danger); }
.req { color: var(--danger); }

/* ── Items section ── */
.items-section { border: 1.5px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.items-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--border); }
.section-label { font-size: 0.82rem; font-weight: 700; color: var(--text-2); }
.btn-add-item { background: none; border: 1.5px solid var(--primary); color: var(--primary); border-radius: var(--radius-sm); padding: 4px 10px; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
.btn-add-item:hover { background: var(--primary-xlight); }
.items-list { display: flex; flex-direction: column; gap: 0; }
.item-row { display: grid; grid-template-columns: 1fr 60px 90px 80px 30px; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--border); }
.item-row:last-child { border-bottom: none; }
.item-desc, .item-qty, .item-price { padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.85rem; color: var(--text); background: var(--surface); outline: none; }
.item-desc:focus, .item-qty:focus, .item-price:focus { border-color: var(--primary); }
.item-total { font-size: 0.85rem; font-weight: 600; color: var(--text); text-align: right; }
.btn-del-item { background: none; border: none; color: var(--text-3); cursor: pointer; font-size: 0.8rem; padding: 4px; }
.btn-del-item:hover:not(:disabled) { color: var(--danger); }
.btn-del-item:disabled { opacity: 0.3; cursor: not-allowed; }
.items-total { display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface); border-top: 1px solid var(--border); font-size: 0.9rem; color: var(--text-2); }
.items-total strong { font-size: 1.1rem; color: var(--text); }

.modal__actions { display: flex; gap: 12px; justify-content: flex-end; padding: 16px 24px 24px; }
.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.mx { margin: 0 24px 8px; }
.loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.empty-state__emoji { font-size: 3rem; }
.spin { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
.spin--sm { width: 14px; height: 14px; }
.spin--dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--primary); }
@keyframes spin { to { transform: rotate(360deg); } }
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

/* ── Invoice detail modal ── */
.detail-loading { display: flex; align-items: center; gap: 10px; padding: 40px 24px; color: var(--text-3); font-size: 0.9rem; }
.detail-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 18px; }
.detail-hero { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.detail-inv-num { font-family: monospace; font-size: 1.15rem; font-weight: 700; color: var(--primary); }
.detail-amount { font-size: 1.7rem; font-weight: 800; color: var(--text); }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.detail-field { display: flex; flex-direction: column; gap: 3px; }
.detail-label { font-size: 0.75rem; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.detail-value { font-size: 0.92rem; color: var(--text); font-weight: 500; }
.detail-notes { background: var(--surface); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 5px; }
.detail-notes p { font-size: 0.88rem; color: var(--text-2); margin: 0; }
.detail-items { display: flex; flex-direction: column; gap: 6px; }

/* ── Consolidado ── */
.consol-filters { padding: 16px 20px; }
.consol-filters__inner { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.consol-filters__inner .field { flex: 1; min-width: 140px; }
.section-title { font-size: 0.85rem; font-weight: 700; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.06em; }

/* ── Pay modal ── */
.pay-invoice-ref { font-size: 0.9rem; color: var(--text-2); margin: 0 0 4px; }

@media (max-width: 600px) {
  .form-grid { grid-template-columns: 1fr; }
  .item-row { grid-template-columns: 1fr 50px 80px 70px 28px; }
  .table th:nth-child(3), .table td:nth-child(3),
  .table th:nth-child(4), .table td:nth-child(4) { display: none; }
  .detail-hero { flex-direction: column; align-items: flex-start; }
  .detail-amount { font-size: 1.35rem; }
}
</style>

<template>
  <div v-show="active">
    <div class="section-title">{{ t('evolutions.prescription') }}</div>

    <div class="rx-add-item">
      <div class="form-grid">
        <div class="field">
          <label>{{ t('evolutions.medicationLabel') }} <span class="req">*</span></label>
          <input v-model.trim="newRxItem.medicationName" type="text" :placeholder="t('evolutions.medicationPlaceholder')" :disabled="saving" />
        </div>
        <div class="field">
          <label>{{ t('evolutions.dose') }} <span class="req">*</span></label>
          <input v-model.trim="newRxItem.dose" type="text" :placeholder="t('evolutions.dosePlaceholder')" :disabled="saving" />
        </div>
        <div class="field">
          <label>{{ t('evolutions.doseUnit') }}</label>
          <input v-model.trim="newRxItem.doseUnit" type="text" :placeholder="t('evolutions.doseUnitPlaceholder')" :disabled="saving" />
        </div>
        <div class="field">
          <label>{{ t('evolutions.frequency') }} <span class="req">*</span></label>
          <input v-model.trim="newRxItem.frequency" type="text" :placeholder="t('evolutions.frequencyPlaceholder')" :disabled="saving" />
        </div>
        <div class="field">
          <label>{{ t('evolutions.route') }}</label>
          <input v-model.trim="newRxItem.route" type="text" :placeholder="t('evolutions.routePlaceholder')" :disabled="saving" />
        </div>
        <div class="field">
          <label>{{ t('evolutions.durationDays') }}</label>
          <input v-model.number="newRxItem.durationDays" type="number" min="1" placeholder="7" :disabled="saving" />
        </div>
        <div class="field">
          <label>{{ t('evolutions.quantity') }}</label>
          <input v-model.number="newRxItem.quantity" type="number" min="0" step="0.5" :placeholder="t('evolutions.quantityPlaceholder')" :disabled="saving" />
        </div>
        <div class="field field--full">
          <label>{{ t('evolutions.ownerInstructions') }}</label>
          <textarea v-model.trim="newRxItem.instructions" rows="2" :placeholder="t('evolutions.ownerInstructionsPlaceholder')" :disabled="saving" />
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button type="button" class="btn-ghost btn-sm" @click="emit('add-item')" :disabled="saving">+ {{ t('evolutions.addItem') }}</button>
      </div>
    </div>

    <div v-if="form.prescriptionItems.length > 0" style="margin-top:14px">
      <div class="section-title">{{ t('evolutions.prescriptionItems') }} ({{ form.prescriptionItems.length }})</div>
      <div class="rx-item-list">
        <div v-for="(item, idx) in form.prescriptionItems" :key="idx" class="rx-item">
          <div class="rx-item__info">
            <strong>{{ item.medicationName }}</strong>
            <span>{{ item.dose }}{{ item.doseUnit ? ' ' + item.doseUnit : '' }} - {{ item.frequency }}</span>
            <span v-if="item.route" class="sub">{{ t('evolutions.route') }}: {{ item.route }}</span>
            <span v-if="item.durationDays" class="sub">{{ item.durationDays }} {{ t('evolutions.durationDays') }}</span>
          </div>
          <button type="button" class="rx-item__remove" @click="emit('remove-item', idx)" :disabled="saving" :title="t('evolutions.deleteItem')">&times;</button>
        </div>
      </div>
    </div>

    <div class="form-grid" style="margin-top:14px">
      <div class="field">
        <label>{{ t('evolutions.allowedRefills') }}</label>
        <input v-model.number="form.prescriptionRefills" type="number" min="0" :placeholder="t('evolutions.allowedRefillsPlaceholder')" :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>{{ t('evolutions.prescriptionNotes') }}</label>
        <textarea v-model.trim="form.prescriptionNotes" rows="2" :placeholder="t('evolutions.prescriptionNotes')" :disabled="saving" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../../i18n'

defineProps({
  active: Boolean,
  form: { type: Object, required: true },
  newRxItem: { type: Object, required: true },
  saving: Boolean,
})

const emit = defineEmits(['add-item', 'remove-item'])
</script>

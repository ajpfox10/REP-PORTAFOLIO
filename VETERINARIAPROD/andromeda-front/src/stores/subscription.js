import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { subscriptionApi } from '../api/subscription'
import { logError } from '../utils/errors'

export const PLAN_LABELS = { basic: 'Esencial', pro: 'Profesional', enterprise: 'Red de clínicas', free: 'Gratuito' }

export const useSubscriptionStore = defineStore('subscription', () => {
  const data = ref(null)
  const loading = ref(false)
  const error = ref(null)

  const summary = computed(() => data.value?.subscription || null)
  const isTrial = computed(() => summary.value?.status === 'trialing')
  const needsAttention = computed(() => ['expired', 'past_due', 'cancelled'].includes(summary.value?.status)
    || (isTrial.value && summary.value.trialDaysLeft <= 7))
  const planLabel = computed(() => PLAN_LABELS[summary.value?.effectiveTier] || PLAN_LABELS[summary.value?.plan] || '')

  async function load({ force = false } = {}) {
    if (loading.value || (data.value && !force)) return data.value
    loading.value = true
    error.value = null
    try {
      const res = await subscriptionApi.get()
      data.value = res.data?.data || res.data
    } catch (err) {
      error.value = err
      logError('subscription.load', err)
    } finally {
      loading.value = false
    }
    return data.value
  }

  function reset() {
    data.value = null
    error.value = null
  }

  return { data, loading, error, summary, isTrial, needsAttention, planLabel, load, reset }
})

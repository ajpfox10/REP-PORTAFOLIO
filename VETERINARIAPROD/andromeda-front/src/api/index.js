import http from './client'

// Base URL is already /api/v1. Paths here mirror the backend service routes.

export const appointmentsApi = {
  list:         (p)             => http.get('/appointments', { params: p }),
  get:          (id)            => http.get(`/appointments/${id}`),
  create:       (d)             => http.post('/appointments', d),
  update:       (id, d)         => http.put(`/appointments/${id}`, d),
  changeStatus: (id, status, notes) => http.patch(`/appointments/${id}/status`, { status, notes }),
  cancel:       (id, reason)    => http.patch(`/appointments/${id}/status`, { status: 'cancelled', notes: reason }),
  types:        ()              => http.get('/appointments/types'),
  today:        ()              => http.get('/appointments/today'),
}

export const patientsApi = {
  list:     (p)         => http.get('/patients', { params: p }),
  get:      (id)        => http.get(`/patients/${id}`),
  create:   (d)         => http.post('/patients', d),
  update:   (id, d)     => http.put(`/patients/${id}`, d),
  delete:   (id)        => http.delete(`/patients/${id}`),
  owners:   (id)        => http.get(`/patients/${id}/owners`),
  timeline: (id)        => http.get(`/patients/${id}/timeline`),
  species:  ()          => http.get('/patients/species/all'),
  breeds:   (speciesId) => http.get('/patients/breeds/all', { params: { speciesId } }),
}

export const clientsApi = {
  list:     (p)     => http.get('/clients', { params: p }),
  get:      (id)    => http.get(`/clients/${id}`),
  create:   (d)     => http.post('/clients', d),
  update:   (id, d) => http.put(`/clients/${id}`, d),
  patients: (id)    => http.get(`/clients/${id}/patients`),
}

export const medicalApi = {
  list:   (p)     => http.get('/medical-records', { params: p }),
  get:    (id)    => http.get(`/medical-records/${id}`),
  create: (d)     => http.post('/medical-records', d),
  update: (id, d) => http.put(`/medical-records/${id}`, d),
  anamnesis:    (recordId, d) => http.post(`/medical-records/${recordId}/anamnesis`, d),
  physicalExam: (recordId, d) => http.post(`/medical-records/${recordId}/physical-exam`, d),
  diagnoses:    (recordId, d) => http.post(`/medical-records/${recordId}/diagnoses`, d),
  treatments:   (recordId, d) => http.post(`/medical-records/${recordId}/treatments`, d),
  triage: {
    createForAppointment: (appointmentId, d) => http.post(`/appointments/${appointmentId}/triage`, d),
    createLegacy:         (appointmentId, d) => http.post(`/triage/${appointmentId}`, d),
  },
  prescriptions: {
    list:   (recordId)    => http.get(`/medical-records/${recordId}/prescriptions`),
    create: (recordId, d) => http.post(`/medical-records/${recordId}/prescriptions`, d),
  },
  followUps: {
    list:   (p) => http.get('/follow-ups', { params: p }),
    create: (d) => http.post('/follow-ups', d),
  },
}

export const vaccinationsApi = {
  list:    (p)     => http.get('/vaccinations', { params: p }),
  create:  (d)     => http.post('/vaccinations', d),
  alerts:  ()      => http.get('/vaccinations/alerts'),
  vaccines: ()     => http.get('/vaccinations/vaccines'),
  deworming: {
    list:     (p) => http.get('/vaccinations/deworming', { params: p }),
    create:   (d) => http.post('/vaccinations/deworming', d),
    alerts:   ()  => http.get('/vaccinations/deworming/alerts'),
    products: ()  => http.get('/vaccinations/deworming/products'),
  },
}

export const labApi = {
  orders: {
    list:    (p)     => http.get('/lab/orders', { params: p }),
    pending: ()      => http.get('/lab/orders/pending'),
    get:     (id)    => http.get(`/lab/orders/${id}`),
    create:  (d)     => http.post('/lab/orders', d),
    result:  (id, d) => http.post(`/lab/orders/${id}/results`, d),
  },
  tests:  () => http.get('/lab/tests'),
  panels: () => http.get('/lab/panels'),
  imaging: {
    list:          (p)     => http.get('/imaging/orders', { params: p }),
    pendingReport: ()      => http.get('/imaging/orders/pending-report'),
    create:        (d)     => http.post('/imaging/orders', d),
    get:           (id)    => http.get(`/imaging/orders/${id}`),
    addStudy:      (id, d) => http.post(`/imaging/orders/${id}/studies`, d),
    report:        (id, d) => http.post(`/imaging/orders/${id}/report`, d),
    types:         ()      => http.get('/imaging/types'),
  },
  pathology: {
    list:   (p)     => http.get('/pathology/orders', { params: p }),
    create: (d)     => http.post('/pathology/orders', d),
    get:    (id)    => http.get(`/pathology/orders/${id}`),
    result: (id, d) => http.post(`/pathology/orders/${id}/result`, d),
    types:  ()      => http.get('/pathology/types'),
  },
  surgeries: {
    list:       (p)     => http.get('/surgeries', { params: p }),
    get:        (id)    => http.get(`/surgeries/${id}`),
    create:     (d)     => http.post('/surgeries', d),
    types:      ()      => http.get('/surgeries/types/all'),
    status:     (id, d) => http.patch(`/surgeries/${id}/status`, d),
    anesthesia: (id, d) => http.post(`/surgeries/${id}/anesthesia`, d),
  },
  hospitalizations: {
    list:              (p)     => http.get('/hospitalizations', { params: p }),
    board:             ()      => http.get('/hospitalizations/board'),
    wardsAvailability: ()      => http.get('/hospitalizations/wards/availability'),
    get:               (id)    => http.get(`/hospitalizations/${id}`),
    create:            (d)     => http.post('/hospitalizations', d),
    monitoring:        (id, d) => http.post(`/hospitalizations/${id}/monitoring`, d),
    medications:       (id, d) => http.post(`/hospitalizations/${id}/medications`, d),
    discharge:         (id, d) => http.patch(`/hospitalizations/${id}/discharge`, d),
  },
}

export const billingApi = {
  invoices: {
    list:     (p)          => http.get('/invoices', { params: p }),
    get:      (id)         => http.get(`/invoices/${id}`),
    create:   (d)          => http.post('/invoices', d),
    markPaid: (id, method) => http.patch(`/invoices/${id}/pay`, { payment_method: method }),
    cancel:   (id, reason) => http.patch(`/invoices/${id}/cancel`, { reason }),
  },
  payments: {
    list:   (p) => http.get('/payments', { params: p }),
    create: (d) => http.post('/payments', d),
  },
  priceLists: {
    list:  ()   => http.get('/price-lists'),
    items: (id) => http.get(`/price-lists/${id}/items`),
  },
  inventory: {
    list:     (p)     => http.get('/inventory', { params: p }),
    create:   (d)     => http.post('/inventory/items', d),
    update:   (id, d) => http.put(`/inventory/items/${id}`, d),
    movement: (d)     => http.post('/inventory/movements', d),
    alerts:   ()      => http.get('/inventory/alerts'),
    batches:  (p)     => http.get('/inventory/batches', { params: p }),
  },
  consolidated: {
    summary:     (p) => http.get('/billing/consolidated/summary', { params: p }),
    outstanding: ()  => http.get('/billing/consolidated/outstanding'),
  },
}

export const inventoryApi = {
  list:    (p) => http.get('/inventory', { params: p }),
  alerts:  ()  => http.get('/inventory/alerts'),
  resolveAlert: (id) => http.patch(`/inventory/alerts/${id}/resolve`),
  items: {
    create: (d) => http.post('/inventory/items', d),
    update: (id, d) => http.put(`/inventory/items/${id}`, d),
  },
  batches: {
    create: (d) => http.post('/inventory/batches', d),
    list:   (p) => http.get('/inventory/batches', { params: p }),
  },
  suppliers: {
    list:   ()      => http.get('/suppliers'),
    create: (d)     => http.post('/suppliers', d),
    update: (id, d) => http.put(`/suppliers/${id}`, d),
    delete: (id)    => http.delete(`/suppliers/${id}`),
  },
  purchaseOrders: {
    list:   ()  => http.get('/purchase-orders'),
    create: (d) => http.post('/purchase-orders', d),
    send:   (id) => http.patch(`/purchase-orders/${id}/send`),
    cancel: (id) => http.patch(`/purchase-orders/${id}/cancel`),
  },
}

export const groomingApi = {
  appointments: {
    list:         (p)     => http.get('/grooming/appointments', { params: p }),
    get:          (id)    => http.get(`/grooming/appointments/${id}`),
    create:       (d)     => http.post('/grooming/appointments', d),
    updateStatus: (id, s) => http.patch(`/grooming/appointments/${id}/status`, { status: s }),
    record:       (id, d) => http.post(`/grooming/appointments/${id}/record`, d),
    today:        ()      => http.get('/grooming/appointments/today'),
  },
  groomers: () => http.get('/grooming/groomers'),
  services: () => http.get('/grooming/service-types'),
}

export const teleApi = {
  sessions: {
    list:         (p)     => http.get('/tele/sessions', { params: p }),
    get:          (id)    => http.get(`/tele/sessions/${id}`),
    create:       (d)     => http.post('/tele/sessions', d),
    updateStatus: (id, d) => http.patch(`/tele/sessions/${id}/status`, d),
  },
  stats:        () => http.get('/tele/stats'),
  platforms:    () => http.get('/tele/platforms'),
  webrtcConfig: () => http.get('/tele/webrtc/config'),
}

export const reportsApi = {
  dashboard: (p) => http.get('/reports/dashboard', { params: p }),
  kpis:      (p) => http.get('/reports/kpis', { params: p }),
  summary:   (p) => http.get('/reports/kpis', { params: p }),
  financial: (p) => http.get('/reports/revenue', { params: p }),
  patients:  (p) => http.get('/reports/new-patients', { params: p }),
  clinical:  (p) => http.get('/reports/diagnoses', { params: p }),
  inventory: (p) => http.get('/reports/lab-turnaround', { params: p }),
  staff:     (p) => http.get('/reports/grooming', { params: p }),
  revenue:   (p) => http.get('/reports/revenue', { params: p }),
  appointments: (p) => http.get('/reports/appointments', { params: p }),
  executive: (p) => http.get('/reports/executive', { params: p }),
  charts: {
    revenueTrend: (p) => http.get('/reports/charts/revenue-trend', { params: p }),
    appointmentsHeatmap: (p) => http.get('/reports/charts/appointments-heatmap', { params: p }),
    speciesDistribution: (p) => http.get('/reports/charts/species-distribution', { params: p }),
    topDiagnoses: (p) => http.get('/reports/charts/top-diagnoses-bar', { params: p }),
    paymentMethods: (p) => http.get('/reports/charts/payment-methods', { params: p }),
  },
  exportRevenue: (d) => http.post('/reports/revenue/export', d, { responseType: 'blob' }),
}

export const notificationsApi = {
  inbox:     (p)  => http.get('/notifications', { params: p }),
  markRead:  (id) => http.patch(`/notifications/${id}/read`),
  markAll:   ()   => http.patch('/notifications/read-all'),
  reminders: (p)  => http.get('/notifications/reminders', { params: p }),
  messages:  (p)  => http.get('/notifications/messages', { params: p }),
  retries:   ()   => http.get('/notifications/retries'),
}

export const documentsApi = {
  providers: () => http.get('/documents/providers'),
  accounts: {
    list:   (p)     => http.get('/documents/mail-accounts', { params: p }),
    create: (d)     => http.post('/documents/mail-accounts', d),
    update: (id, d) => http.patch(`/documents/mail-accounts/${id}`, d),
    sync:   (id)    => http.post(`/documents/mail-accounts/${id}/sync`),
  },
  inbox: {
    list:        (p)         => http.get('/documents/inbox', { params: p }),
    get:         (id)        => http.get(`/documents/inbox/${id}`),
    downloadUrl: (id)        => http.get(`/documents/inbox/${id}/download-url`),
    byPatient:   (patientId) => http.get(`/documents/inbox/patients/${patientId}`),
    manual:      (d)         => http.post('/documents/inbox/manual', d),
    upload:      (formData)  => http.post('/documents/inbox/upload', formData),
    ingest:      (id)        => http.post(`/documents/inbox/${id}/ingest`),
    associate:   (id, d)     => http.patch(`/documents/inbox/${id}/associate`, d),
  },
}

export const aiApi = {
  diagnosis:   (d)            => http.post('/ai/diagnosis', d),
  analyze:     (d)            => http.post('/ai/images/analyze', d),
  chatStart:   (d)            => http.post('/ai/chat', d),
  chatGet:     (sessionId)    => http.get(`/ai/chat/${sessionId}`),
  chatReply:   (sessionId, d) => http.post(`/ai/chat/${sessionId}/messages`, d),
  risk:        (patientId)    => http.get(`/ai/patients/${patientId}/risk`),
  riskHistory: (patientId)    => http.get(`/ai/patients/${patientId}/risk/history`),
}

export const adminApi = {
  users: {
    list:       (p)        => http.get('/auth/admin/users', { params: p }),
    create:     (d)        => http.post('/auth/admin/users', d),
    deactivate: (id)       => http.patch(`/auth/admin/users/${id}/deactivate`),
    updateRole: (id, role) => http.patch(`/auth/admin/users/${id}/role`, { role }),
  },
  branches: {
    list:   ()      => http.get('/branches'),
    create: (d)     => http.post('/branches', d),
    update: (id, d) => http.put(`/branches/${id}`, d),
  },
  roles: () => http.get('/auth/admin/rbac/roles'),
}

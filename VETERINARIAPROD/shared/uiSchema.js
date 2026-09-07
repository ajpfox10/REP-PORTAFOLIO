'use strict';

/**
 * UI Schema Engine — genera un schema de navegación/permisos para el frontend.
 *
 * El frontend consume este schema para:
 *   - Mostrar/ocultar módulos y secciones
 *   - Habilitar/deshabilitar acciones (crear, editar, borrar)
 *   - Aplicar visibilidad de campos según clasificación de datos
 *   - Activar features por feature flags del org
 *
 * Endpoint: GET /me/ui-schema
 * Cache: Redis 60s por userId:orgId
 */

const { getEffectivePermissions, ROLE_PERMISSIONS } = require('./rbac');

// Mapa de módulos de UI → permisos RBAC requeridos
const UI_MODULES = [
  {
    id:    'dashboard',
    label: 'Dashboard',
    icon:  'home',
    permissions: { read: null },   // siempre visible
    order: 0,
  },
  {
    id:    'patients',
    label: 'Pacientes',
    icon:  'paw',
    permissions: { read: 'patients:read', create: 'patients:create', update: 'patients:update', delete: 'patients:delete' },
    order: 1,
  },
  {
    id:    'clients',
    label: 'Clientes',
    icon:  'users',
    permissions: { read: 'clients:read', create: 'clients:create', update: 'clients:update', delete: 'clients:delete' },
    order: 2,
  },
  {
    id:    'appointments',
    label: 'Turnos',
    icon:  'calendar',
    permissions: { read: 'appointments:read', create: 'appointments:create', update: 'appointments:update', delete: 'appointments:delete' },
    order: 3,
  },
  {
    id:    'medical_records',
    label: 'Historias Clínicas',
    icon:  'file-medical',
    permissions: { read: 'medical_records:read', create: 'medical_records:create', update: 'medical_records:update' },
    order: 4,
  },
  {
    id:    'lab_imaging',
    label: 'Lab & Imágenes',
    icon:  'flask',
    permissions: { read: 'lab:read', create: 'lab:create' },
    order: 5,
  },
  {
    id:    'billing',
    label: 'Facturación',
    icon:  'receipt',
    permissions: { read: 'billing:read', create: 'billing:create', update: 'billing:update' },
    order: 6,
  },
  {
    id:    'inventory',
    label: 'Inventario',
    icon:  'boxes',
    permissions: { read: 'inventory:read', create: 'inventory:create', update: 'inventory:update' },
    order: 7,
  },
  {
    id:    'grooming',
    label: 'Grooming',
    icon:  'scissors',
    permissions: { read: 'grooming:read', create: 'grooming:create' },
    order: 8,
  },
  {
    id:    'reports',
    label: 'Reportes',
    icon:  'chart-bar',
    permissions: { read: 'reports:read' },
    order: 9,
  },
  {
    id:    'branches',
    label: 'Sucursales',
    icon:  'building',
    permissions: { read: 'branches:read', create: 'branches:create', update: 'branches:update' },
    order: 10,
  },
  {
    id:    'staff',
    label: 'Personal',
    icon:  'user-md',
    permissions: { read: 'staff:read', create: 'staff:create', update: 'staff:update' },
    order: 11,
  },
  {
    id:    'admin',
    label: 'Administración',
    icon:  'cog',
    permissions: { read: 'settings:read', update: 'settings:update' },
    order: 12,
  },
];

// Clasificación de visibilidad de datos por rol
const DATA_VISIBILITY_BY_ROLE = {
  superadmin:      { clients_pii: 'full', medical_records: 'full', billing_data: 'full' },
  org_admin:       { clients_pii: 'full', medical_records: 'full', billing_data: 'full' },
  branch_manager:  { clients_pii: 'full', medical_records: 'restricted', billing_data: 'summary' },
  veterinarian:    { clients_pii: 'full', medical_records: 'full', billing_data: 'none' },
  vet_technician:  { clients_pii: 'summary', medical_records: 'full', billing_data: 'none' },
  receptionist:    { clients_pii: 'full', medical_records: 'none', billing_data: 'summary' },
  groomer:         { clients_pii: 'summary', medical_records: 'none', billing_data: 'none' },
  billing_admin:   { clients_pii: 'summary', medical_records: 'none', billing_data: 'full' },
  client:          { clients_pii: 'own', medical_records: 'own', billing_data: 'own' },
};

/**
 * Genera el schema de UI para un usuario dado.
 *
 * @param {Object} user - { userId, orgId, branchId, roles, email }
 * @param {Object} flags - mapa de feature flags del org { featureName: bool }
 * @returns {Object} UI schema
 */
async function generateUiSchema(user, flags = {}) {
  const userRoles   = user.roles || [];
  const permissions = new Set();

  // Acumular todos los permisos de los roles del usuario
  for (const role of userRoles) {
    const rolePerms = ROLE_PERMISSIONS[role] || [];
    for (const perm of rolePerms) {
      if (perm === '*') {
        // Superadmin wildcard — tiene todo
        permissions.add('*');
        break;
      }
      permissions.add(perm);
    }
  }

  const hasPerm = (perm) => {
    if (!perm) return true;        // sin permiso requerido = público
    if (permissions.has('*')) return true;
    return permissions.has(perm);
  };

  // Construir módulos con acciones disponibles
  const modules = UI_MODULES
    .map(mod => {
      const actions = {};
      let anyVisible = false;

      for (const [action, perm] of Object.entries(mod.permissions)) {
        actions[action] = hasPerm(perm);
        if (actions[action]) anyVisible = true;
      }

      return {
        id:      mod.id,
        label:   mod.label,
        icon:    mod.icon,
        order:   mod.order,
        visible: anyVisible,
        actions,
      };
    })
    .filter(m => m.visible)
    .sort((a, b) => a.order - b.order);

  // Visibilidad de datos (máximo nivel entre todos los roles del usuario)
  const LEVEL_ORDER = { none: 0, own: 1, summary: 2, restricted: 3, full: 4 };
  const dataVisibility = {};

  for (const role of userRoles) {
    const roleVisibility = DATA_VISIBILITY_BY_ROLE[role] || {};
    for (const [key, level] of Object.entries(roleVisibility)) {
      const current = dataVisibility[key] || 'none';
      if ((LEVEL_ORDER[level] || 0) > (LEVEL_ORDER[current] || 0)) {
        dataVisibility[key] = level;
      }
    }
  }

  // Features activos (filtrar solo los relevantes para la UI)
  const UI_RELEVANT_FLAGS = [
    'telemedicine', 'ai_diagnosis', 'online_booking', 'grooming',
    'lab_imaging', 'multi_branch', 'reporting_advanced', 'api_access',
    'billing_stripe', 'captcha_login', 'two_factor_required',
  ];

  const features = {};
  for (const flag of UI_RELEVANT_FLAGS) {
    features[flag] = flags[flag] ?? false;
  }

  return {
    user: {
      userId:   user.userId,
      email:    user.email,
      roles:    userRoles,
      orgId:    user.orgId,
      branchId: user.branchId,
    },
    modules,
    features,
    dataVisibility,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { generateUiSchema, UI_MODULES };

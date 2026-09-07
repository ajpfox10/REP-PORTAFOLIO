'use strict';

const { Router } = require('express');
const db = require('../../../../shared/db');
const R  = require('../../../../shared/response');
const { requireInternalSig } = require('../../../../shared/internalAuth');   // BUG-003
const { fromHeaders, requireOrgContext } = require('../../../../shared/requestContext');

function requireSuperAdmin(req, res, next) {
  const roles = req.user?.roles || [];
  if (roles.includes('superadmin')) return next();
  return R.forbidden(res, 'Se requiere rol superadmin', 'FORBIDDEN');
}

const router = Router();

// Tablas de negocio con sus metadatos y filtro de organización
const TABLES = [
  { key: 'patients',            label: 'Pacientes',               filter: 'org',    description: 'Animales registrados en el sistema' },
  { key: 'clients',             label: 'Clientes / Propietarios', filter: 'branch', description: 'Dueños responsables de los pacientes' },
  { key: 'appointments',        label: 'Turnos',                  filter: 'branch', description: 'Citas agendadas para los pacientes' },
  { key: 'appointment_types',   label: 'Tipos de Turno',          filter: 'none',   description: 'Categorías de consultas disponibles' },
  { key: 'vaccinations',        label: 'Vacunaciones',            filter: 'branch', description: 'Historial de vacunas aplicadas' },
  { key: 'vaccines',            label: 'Vacunas (catálogo)',       filter: 'none',   description: 'Vacunas disponibles en el sistema' },
  { key: 'medical_records',     label: 'Fichas Médicas',          filter: 'branch', description: 'Registro de cada consulta veterinaria' },
  { key: 'species',             label: 'Especies',                filter: 'none',   description: 'Catálogo de especies animales' },
  { key: 'breeds',              label: 'Razas',                   filter: 'none',   description: 'Razas por especie' },
  { key: 'inventory_items',     label: 'Inventario',              filter: 'branch', description: 'Medicamentos e insumos de la clínica' },
  { key: 'invoices',            label: 'Facturas',                filter: 'branch', description: 'Comprobantes de cobro a clientes' },
  { key: 'surgeries',           label: 'Cirugías',                filter: 'branch', description: 'Procedimientos quirúrgicos' },
  { key: 'hospitalizations',    label: 'Hospitalizaciones',       filter: 'branch', description: 'Internaciones de pacientes' },
  { key: 'prescriptions',       label: 'Recetas',                 filter: 'branch', description: 'Recetas médicas emitidas' },
  { key: 'grooming_appointments',label: 'Turnos de Grooming',     filter: 'branch', description: 'Citas de peluquería y baño' },
  { key: 'lab_orders',          label: 'Pedidos de Lab.',         filter: 'branch', description: 'Órdenes de análisis de laboratorio' },
  { key: 'lab_tests',           label: 'Análisis (catálogo)',      filter: 'none',   description: 'Tipos de análisis disponibles' },
  { key: 'medications',         label: 'Medicamentos',            filter: 'none',   description: 'Catálogo de medicamentos' },
  { key: 'suppliers',           label: 'Proveedores',             filter: 'none',   description: 'Proveedores de insumos y medicamentos' },
  { key: 'services_catalog',    label: 'Catálogo de Servicios',   filter: 'none',   description: 'Servicios ofrecidos por la clínica' },
];

const TABLE_MAP = Object.fromEntries(TABLES.map(t => [t.key, t]));

// GET /admin/preview — lista de tablas
router.get('/', requireInternalSig, fromHeaders, requireOrgContext, requireSuperAdmin, (_req, res) => {
  return R.ok(res, { tables: TABLES.map(({ key, label, description }) => ({ key, label, description })) });
});

// GET /admin/preview/:tableName — columnas reales (DESCRIBE) + 10 registros
router.get('/:tableName', requireInternalSig, fromHeaders, requireOrgContext, requireSuperAdmin, async (req, res, next) => {
  try {
    const def = TABLE_MAP[req.params.tableName];
    if (!def) {
      return R.notFound(res, 'Tabla no disponible', 'NOT_FOUND');
    }

    const orgId    = req.user.orgId;
    const branchId = req.user.branchId;

    // Columnas reales via DESCRIBE (simple y confiable)
    const rawCols = await db.query(`DESCRIBE \`${def.key}\``);
    const columns = rawCols.map(c => ({
      name:     c.Field,
      type:     c.Type,
      nullable: c.Null === 'YES',
      key:      c.Key,
      default:  c.Default,
    }));

    // Filtro por organización
    let where = '';
    let params = {};
    if (def.filter === 'org' && orgId) {
      where = 'WHERE organization_id = :orgId';
      params = { orgId };
    } else if (def.filter === 'branch' && orgId) {
      where = 'WHERE branch_id IN (SELECT id FROM branches WHERE organization_id = :orgId)';
      params = { orgId };
    }

    // OT-071: build explicit column list — exclude encrypted BLOBs and binary hashes
    const EXCLUDED_COLUMNS = new Set([
      'password_hash', 'password', 'hashed_password',
      'encrypted_value', 'field_iv', 'encryption_iv',
      'private_key', 'secret', 'token_hash', 'refresh_token_hash',
      'session_token', 'api_key_hash',
    ]);
    const EXCLUDED_TYPES = /^(blob|mediumblob|longblob|tinyblob|varbinary|binary)/i;

    const safeColumns = rawCols
      .filter((c) => !EXCLUDED_COLUMNS.has(c.Field) && !EXCLUDED_TYPES.test(c.Type))
      .map((c) => `\`${c.Field}\``)
      .join(', ');

    const rows = await db.query(
      `SELECT ${safeColumns} FROM \`${def.key}\` ${where} ORDER BY id DESC LIMIT 10`,
      params,
    );

    return R.ok(res, {
      table:       def.key,
      label:       def.label,
      description: def.description,
      columns,
      rows,
    });
  } catch (e) { next(e); }
});

module.exports = router;

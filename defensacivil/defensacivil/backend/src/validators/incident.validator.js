const { body } = require('express-validator');

const STATUSES   = ['RECIBIDO', 'EN_CAMINO', 'EN_ESCENA', 'CONTROLADO', 'CERRADO', 'CANCELADO'];
const PRIORITIES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];
const UNIT_TYPES = ['BOMBEROS', 'POLICIA', 'AMBULANCIA', 'DEFENSA_CIVIL', 'RESCATE', 'GENDARMERIA', 'PREFECTURA', 'EJERCITO', 'CRUZ_ROJA', 'OTRO'];
const RES_TYPES  = ['VEHICULO', 'EQUIPO', 'MATERIAL', 'HERRAMIENTA', 'OTRO'];

// optional({ values: 'falsy' }) en express-validator v7 saltea undefined, null Y string vacío ""
const OPT = { values: 'falsy' };

const createIncidentRules = [
  body('incident_type_id').isInt({ min: 1 }).withMessage('Tipo de incidente inválido'),
  body('incident_subtype_id').optional(OPT).isInt({ min: 1 }),
  body('title')
    .trim()
    .notEmpty().withMessage('El título es requerido')
    .isLength({ min: 5, max: 200 }).withMessage('Entre 5 y 200 caracteres'),
  body('description')
    .trim()
    .notEmpty().withMessage('La descripción es requerida')
    .isLength({ min: 10, max: 5000 }).withMessage('Entre 10 y 5000 caracteres'),
  body('priority').optional(OPT).isIn(PRIORITIES).withMessage('Prioridad inválida'),
  body('province_id').optional(OPT).isInt({ min: 1 }),
  body('partido_id').optional(OPT).isInt({ min: 1 }),
  body('locality_id').optional(OPT).isInt({ min: 1 }),
  body('address').optional(OPT).trim().isLength({ max: 255 }),
  body('latitude').optional(OPT).isFloat({ min: -90, max: 90 }).withMessage('Latitud inválida'),
  body('longitude').optional(OPT).isFloat({ min: -180, max: 180 }).withMessage('Longitud inválida'),
  body('affected_persons_count').optional(OPT).isInt({ min: 0 }),
  body('injured_count').optional(OPT).isInt({ min: 0 }),
  body('deceased_count').optional(OPT).isInt({ min: 0 }),
  body('evacuated_count').optional(OPT).isInt({ min: 0 }),
  body('assigned_officer').optional(OPT).trim().isLength({ max: 100 }),
  body('notes').optional(OPT).trim().isLength({ max: 5000 }),
];

const updateIncidentRules = [
  body('incident_type_id').optional(OPT).isInt({ min: 1 }),
  body('incident_subtype_id').optional(OPT).isInt({ min: 1 }),
  body('title').optional(OPT).trim().isLength({ min: 5, max: 200 }),
  body('description').optional(OPT).trim().isLength({ min: 10, max: 5000 }),
  body('status').optional(OPT).isIn(STATUSES).withMessage('Estado inválido'),
  body('priority').optional(OPT).isIn(PRIORITIES).withMessage('Prioridad inválida'),
  body('province_id').optional(OPT).isInt({ min: 1 }),
  body('partido_id').optional(OPT).isInt({ min: 1 }),
  body('locality_id').optional(OPT).isInt({ min: 1 }),
  body('address').optional(OPT).trim().isLength({ max: 255 }),
  body('latitude').optional(OPT).isFloat({ min: -90, max: 90 }),
  body('longitude').optional(OPT).isFloat({ min: -180, max: 180 }),
  body('affected_persons_count').optional(OPT).isInt({ min: 0 }),
  body('injured_count').optional(OPT).isInt({ min: 0 }),
  body('deceased_count').optional(OPT).isInt({ min: 0 }),
  body('evacuated_count').optional(OPT).isInt({ min: 0 }),
  body('assigned_officer').optional(OPT).trim().isLength({ max: 100 }),
  body('notes').optional(OPT).trim().isLength({ max: 5000 }),
];

const updateStatusRules = [
  body('status').isIn(STATUSES).withMessage('Estado inválido'),
  body('notes').optional().isLength({ max: 500 }).trim(),
];

const addUnitRules = [
  body('unit_name').notEmpty().withMessage('Nombre de unidad requerido').isLength({ max: 100 }).trim(),
  body('unit_type').isIn(UNIT_TYPES).withMessage('Tipo de unidad inválido'),
  body('unit_number').optional().isLength({ max: 30 }).trim(),
  body('personnel_count').optional().isInt({ min: 0 }),
  body('arrived_at').optional({ nullable: true }).isISO8601(),
  body('notes').optional().isLength({ max: 255 }).trim(),
];

const addResourceRules = [
  body('resource_type').isIn(RES_TYPES).withMessage('Tipo de recurso inválido'),
  body('resource_name').notEmpty().withMessage('Nombre de recurso requerido').isLength({ max: 100 }).trim(),
  body('quantity').optional().isInt({ min: 1 }),
  body('notes').optional().isLength({ max: 255 }).trim(),
];

module.exports = {
  createIncidentRules, updateIncidentRules, updateStatusRules,
  addUnitRules, addResourceRules,
};

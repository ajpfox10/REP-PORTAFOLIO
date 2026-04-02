const { body } = require('express-validator');

const STATUSES   = ['RECIBIDO', 'EN_CAMINO', 'EN_ESCENA', 'CONTROLADO', 'CERRADO', 'CANCELADO'];
const PRIORITIES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];
const UNIT_TYPES = ['BOMBEROS', 'POLICIA', 'AMBULANCIA', 'DEFENSA_CIVIL', 'RESCATE', 'GENDARMERIA', 'PREFECTURA', 'EJERCITO', 'CRUZ_ROJA', 'OTRO'];
const RES_TYPES  = ['VEHICULO', 'EQUIPO', 'MATERIAL', 'HERRAMIENTA', 'OTRO'];

const createIncidentRules = [
  body('incident_type_id').isInt({ min: 1 }).withMessage('Tipo de incidente inválido'),
  body('incident_subtype_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('title')
    .notEmpty().withMessage('El título es requerido')
    .isLength({ min: 5, max: 200 }).withMessage('Entre 5 y 200 caracteres')
    .trim(),
  body('description')
    .notEmpty().withMessage('La descripción es requerida')
    .isLength({ min: 10, max: 5000 }).withMessage('Entre 10 y 5000 caracteres')
    .trim(),
  body('priority').optional().isIn(PRIORITIES).withMessage('Prioridad inválida'),
  body('province_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('partido_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('locality_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('address').optional().isLength({ max: 255 }).trim(),
  body('latitude').optional({ nullable: true }).isFloat({ min: -55, max: -22 }).withMessage('Latitud inválida para Argentina'),
  body('longitude').optional({ nullable: true }).isFloat({ min: -73, max: -53 }).withMessage('Longitud inválida para Argentina'),
  body('affected_persons_count').optional().isInt({ min: 0 }),
  body('injured_count').optional().isInt({ min: 0 }),
  body('deceased_count').optional().isInt({ min: 0 }),
  body('evacuated_count').optional().isInt({ min: 0 }),
  body('assigned_officer').optional().isLength({ max: 100 }).trim(),
  body('notes').optional().isLength({ max: 5000 }).trim(),
];

const updateIncidentRules = [
  body('incident_type_id').optional().isInt({ min: 1 }),
  body('incident_subtype_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('title').optional().isLength({ min: 5, max: 200 }).trim(),
  body('description').optional().isLength({ min: 10, max: 5000 }).trim(),
  body('status').optional().isIn(STATUSES).withMessage('Estado inválido'),
  body('priority').optional().isIn(PRIORITIES).withMessage('Prioridad inválida'),
  body('province_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('partido_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('locality_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('address').optional().isLength({ max: 255 }).trim(),
  body('latitude').optional({ nullable: true }).isFloat({ min: -55, max: -22 }),
  body('longitude').optional({ nullable: true }).isFloat({ min: -73, max: -53 }),
  body('affected_persons_count').optional().isInt({ min: 0 }),
  body('injured_count').optional().isInt({ min: 0 }),
  body('deceased_count').optional().isInt({ min: 0 }),
  body('evacuated_count').optional().isInt({ min: 0 }),
  body('assigned_officer').optional().isLength({ max: 100 }).trim(),
  body('notes').optional().isLength({ max: 5000 }).trim(),
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

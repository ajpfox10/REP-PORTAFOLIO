const { body, param, query } = require('express-validator');

// Territorio continental e insular argentino (sin Antártida)
const LAT_RANGE = { min: -56, max: -21 };
const LNG_RANGE = { min: -74, max: -53 };

const STATUSES   = ['RECIBIDO', 'EN_CAMINO', 'EN_ESCENA', 'CONTROLADO', 'CERRADO', 'CANCELADO'];
const PRIORITIES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];
const UNIT_TYPES = ['BOMBEROS', 'POLICIA', 'AMBULANCIA', 'DEFENSA_CIVIL', 'RESCATE', 'GENDARMERIA', 'PREFECTURA', 'EJERCITO', 'CRUZ_ROJA', 'OTRO'];
const RES_TYPES  = ['VEHICULO', 'EQUIPO', 'MATERIAL', 'HERRAMIENTA', 'OTRO'];

const createIncidentRules = [
  body('incident_type_id').isInt({ min: 1 }).withMessage('Tipo de incidente inválido'),
  body('incident_subtype_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('title')
    .notEmpty().withMessage('El título es requerido')
    .isLength({ min: 5, max: 200 }).withMessage('Entre 5 y 200 caracteres')
    .trim(),
  body('description')
    .notEmpty().withMessage('La descripción es requerida')
    .isLength({ min: 10, max: 5000 }).withMessage('Entre 10 y 5000 caracteres')
    .trim(),
  body('priority').optional().isIn(PRIORITIES).withMessage('Prioridad inválida'),
  body('province_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('partido_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('locality_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('address').optional().isLength({ max: 255 }).trim(),
  body('latitude').optional({ values: 'falsy' }).isFloat(LAT_RANGE).withMessage('Latitud inválida para Argentina'),
  body('longitude').optional({ values: 'falsy' }).isFloat(LNG_RANGE).withMessage('Longitud inválida para Argentina'),
  body('affected_persons_count').optional().isInt({ min: 0 }),
  body('injured_count').optional().isInt({ min: 0 }),
  body('deceased_count').optional().isInt({ min: 0 }),
  body('evacuated_count').optional().isInt({ min: 0 }),
  body('assigned_officer').optional().isLength({ max: 100 }).trim(),
  body('notes').optional().isLength({ max: 5000 }).trim(),
];

const updateIncidentRules = [
  body('incident_type_id').optional().isInt({ min: 1 }),
  body('incident_subtype_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('title').optional().isLength({ min: 5, max: 200 }).trim(),
  body('description').optional().isLength({ min: 10, max: 5000 }).trim(),
  body('status').optional().isIn(STATUSES).withMessage('Estado inválido'),
  body('priority').optional().isIn(PRIORITIES).withMessage('Prioridad inválida'),
  body('province_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('partido_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('locality_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('address').optional().isLength({ max: 255 }).trim(),
  body('latitude').optional({ values: 'falsy' }).isFloat(LAT_RANGE),
  body('longitude').optional({ values: 'falsy' }).isFloat(LNG_RANGE),
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
  body('arrived_at').optional({ values: 'falsy' }).isISO8601(),
  body('notes').optional().isLength({ max: 255 }).trim(),
];

const addResourceRules = [
  body('resource_type').isIn(RES_TYPES).withMessage('Tipo de recurso inválido'),
  body('resource_name').notEmpty().withMessage('Nombre de recurso requerido').isLength({ max: 100 }).trim(),
  body('quantity').optional().isInt({ min: 1 }),
  body('notes').optional().isLength({ max: 255 }).trim(),
];

// Nota de campo (chofer): texto, nuevo estado y/o ubicación actualizada
const addNoteRules = [
  param('uuid').isUUID(),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 500 }).trim(),
  body('status').optional({ values: 'falsy' }).isIn(STATUSES).withMessage('Estado inválido'),
  body('latitude').optional({ values: 'falsy' }).isFloat(LAT_RANGE).withMessage('Latitud inválida para Argentina').toFloat(),
  body('longitude').optional({ values: 'falsy' }).isFloat(LNG_RANGE).withMessage('Longitud inválida para Argentina').toFloat(),
  body().custom(b => {
    const has = v => v !== undefined && v !== null && v !== '';
    if (!has(b?.notes) && !has(b?.status) && !has(b?.latitude)) throw new Error('Indique una nota, un estado o una ubicación');
    if (has(b.latitude) !== has(b.longitude)) throw new Error('Latitud y longitud van juntas');
    return true;
  }),
];

const uuidParam = [param('uuid').isUUID().withMessage('Identificador inválido')];

const listRules = [
  query('status').optional().isIn(STATUSES),
  query('priority').optional().isIn(PRIORITIES),
  query(['incident_type_id', 'province_id', 'partido_id', 'locality_id']).optional().isInt({ min: 1 }),
  query(['dateFrom', 'dateTo']).optional().isISO8601({ strict: true }).withMessage('Fecha inválida'),
  query('search').optional().isString().isLength({ max: 100 }),
  query(['page', 'limit']).optional().isInt({ min: 1 }),
];

module.exports = {
  createIncidentRules, updateIncidentRules, updateStatusRules,
  addUnitRules, addResourceRules, addNoteRules, uuidParam, listRules,
  STATUSES, PRIORITIES,
};

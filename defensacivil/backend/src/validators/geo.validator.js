const { body, param, query } = require('express-validator');
const { INFRA_TYPES } = require('../models/geo.model');

const LAT_RANGE = { min: -56, max: -21 };
const LNG_RANGE = { min: -74, max: -53 };

const idParam = [param('id').isInt({ min: 1 }).withMessage('Identificador inválido')];

const optionalId = name => body(name).optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Valor inválido');

// En la edición todos los campos son opcionales; en el alta el nombre (y el tipo) son obligatorios
function placeRules({ partial }) {
  const name = body('name').isString().trim().isLength({ min: 2, max: 150 }).withMessage('El nombre debe tener entre 2 y 150 caracteres');
  return [
    partial ? name.optional() : name,
    body('address').optional({ values: 'falsy' }).isString().trim().isLength({ max: 255 }),
    body('phone').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
    optionalId('province_id'),
    optionalId('partido_id'),
    body('latitude').optional({ values: 'null' }).isFloat(LAT_RANGE).withMessage('Latitud inválida para Argentina'),
    body('longitude').optional({ values: 'null' }).isFloat(LNG_RANGE).withMessage('Longitud inválida para Argentina'),
  ];
}

function infraRules({ partial }) {
  const type = body('type').isIn(INFRA_TYPES).withMessage('Tipo inválido');
  return [
    partial ? type.optional() : type,
    ...placeRules({ partial }),
    body('beds').optional({ values: 'falsy' }).isInt({ min: 0, max: 100000 }).withMessage('Cantidad de camas inválida'),
    body('level').optional({ values: 'falsy' }).isString().trim().isLength({ max: 30 }),
  ];
}

const createInfrastructureRules = infraRules({ partial: false });
const updateInfrastructureRules = [...idParam, ...infraRules({ partial: true })];
const createStationRules = placeRules({ partial: false });
const updateStationRules = [...idParam, ...placeRules({ partial: true })];

const infraListRules = [
  query('type').optional().isIn(INFRA_TYPES),
  query(['province_id', 'partido_id']).optional().isInt({ min: 1 }),
];

const stationListRules = [query('province_id').optional().isInt({ min: 1 })];

module.exports = {
  idParam, infraListRules, stationListRules,
  createInfrastructureRules, updateInfrastructureRules,
  createStationRules, updateStationRules,
};

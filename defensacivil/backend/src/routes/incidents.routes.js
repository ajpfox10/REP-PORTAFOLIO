const router       = require('express').Router();
const { param }    = require('express-validator');
const ctrl         = require('../controllers/incidents.controller');
const { authenticateToken } = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { createAuditLog }    = require('../middleware/auditLog');
const { validate }          = require('../middleware/validate');
const {
  createIncidentRules, updateIncidentRules, updateStatusRules,
  addUnitRules, addResourceRules, addNoteRules, uuidParam, listRules,
} = require('../validators/incident.validator');

// Roles:
//  admin       todo
//  medium      operador: carga y edita sus incidentes
//  telefonista recibe llamadas y carga incidentes
//  chofer      en el lugar: informa novedades, estado y ubicación
//  read        solo consulta
const all     = authorize('admin', 'medium', 'read', 'telefonista', 'chofer');
const writers = authorize('admin', 'medium', 'telefonista', 'chofer');
const admins  = authorize('admin');

const idParam = name => param(name).isInt({ min: 1 }).withMessage('Identificador inválido');

router.use(authenticateToken);

router.get('/',          all, validate(listRules), ctrl.list);
router.get('/map',       all, validate(listRules), ctrl.mapPoints);
router.get('/dashboard', all,                      ctrl.dashboard);
router.get('/:uuid',     all, validate(uuidParam), ctrl.getOne);

router.post('/',
  writers,
  validate(createIncidentRules),
  createAuditLog('CREATE_INCIDENT', 'incidents'),
  ctrl.create
);

router.put('/:uuid',
  writers,
  validate([...uuidParam, ...updateIncidentRules]),
  createAuditLog('UPDATE_INCIDENT', 'incidents'),
  ctrl.update
);

router.delete('/:uuid',
  admins,
  validate(uuidParam),
  createAuditLog('DELETE_INCIDENT', 'incidents'),
  ctrl.softDelete
);

// Unidades
router.post('/:uuid/units',           writers, validate([...uuidParam, ...addUnitRules]),           ctrl.addUnit);
router.delete('/:uuid/units/:unitId', writers, validate([...uuidParam, idParam('unitId')]),          ctrl.removeUnit);

// Recursos
router.post('/:uuid/resources',               writers, validate([...uuidParam, ...addResourceRules]),       ctrl.addResource);
router.delete('/:uuid/resources/:resourceId', writers, validate([...uuidParam, idParam('resourceId')]),     ctrl.removeResource);

// Estado
router.post('/:uuid/status',
  writers,
  validate([...uuidParam, ...updateStatusRules]),
  createAuditLog('STATUS_CHANGE', 'incidents'),
  ctrl.updateStatus
);
router.get('/:uuid/history', all, validate(uuidParam), ctrl.getStatusHistory);

// Nota de campo (novedad, estado y/o ubicación)
router.post('/:uuid/note',
  writers,
  validate(addNoteRules),
  createAuditLog('FIELD_NOTE', 'incidents'),
  ctrl.addNote
);

module.exports = router;

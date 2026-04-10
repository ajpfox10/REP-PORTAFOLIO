const router       = require('express').Router();
const ctrl         = require('../controllers/incidents.controller');
const { authenticateToken } = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { createAuditLog }    = require('../middleware/auditLog');
const { validate }          = require('../middleware/validate');
const {
  createIncidentRules, updateIncidentRules, updateStatusRules,
  addUnitRules, addResourceRules,
} = require('../validators/incident.validator');

const auth    = authenticateToken;
const all     = authorize('admin', 'medium', 'read', 'telefonista', 'chofer');
const writers = authorize('admin', 'medium', 'telefonista', 'chofer');
const admins  = authorize('admin');

router.get('/',          auth, all,     ctrl.list);
router.get('/map',       auth, all,     ctrl.mapPoints);
router.get('/dashboard', auth, all,     ctrl.dashboard);
router.get('/:uuid',     auth, all,     ctrl.getOne);

router.post('/',
  auth, writers,
  validate(createIncidentRules),
  createAuditLog('CREATE_INCIDENT', 'incidents'),
  ctrl.create
);

router.put('/:uuid',
  auth, writers,
  validate(updateIncidentRules),
  createAuditLog('UPDATE_INCIDENT', 'incidents'),
  ctrl.update
);

router.delete('/:uuid',
  auth, admins,
  createAuditLog('DELETE_INCIDENT', 'incidents'),
  ctrl.softDelete
);

// Units
router.post('/:uuid/units',           auth, writers, validate(addUnitRules), ctrl.addUnit);
router.delete('/:uuid/units/:unitId', auth, writers,                         ctrl.removeUnit);

// Resources
router.post('/:uuid/resources',               auth, writers, validate(addResourceRules), ctrl.addResource);
router.delete('/:uuid/resources/:resourceId', auth, writers,                             ctrl.removeResource);

// Status
router.post('/:uuid/status',
  auth, writers,
  validate(updateStatusRules),
  createAuditLog('STATUS_CHANGE', 'incidents'),
  ctrl.updateStatus
);
router.get('/:uuid/history', auth, all, ctrl.getStatusHistory);
router.post('/:uuid/note',   auth, all, ctrl.addNote);;

module.exports = router;

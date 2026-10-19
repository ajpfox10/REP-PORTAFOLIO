const router = require('express').Router();
const ctrl   = require('../controllers/geo.controller');
const { authenticateToken } = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { createAuditLog }    = require('../middleware/auditLog');
const { validate }          = require('../middleware/validate');
const v = require('../validators/geo.validator');

const canEdit = authorize('admin', 'medium');

router.use(authenticateToken);

router.get('/provinces',                                                   ctrl.getProvinces);
router.get('/provinces/:id/partidos', validate(v.idParam),                  ctrl.getPartidos);
router.get('/partidos/:id/localities', validate(v.idParam),                 ctrl.getLocalities);
router.get('/incident-types',                                               ctrl.getIncidentTypes);

// Infraestructura
router.get('/infrastructure',        validate(v.infraListRules), ctrl.getInfrastructure);
router.post('/infrastructure',       canEdit, validate(v.createInfrastructureRules), createAuditLog('CREATE_INFRA', 'infrastructure'), ctrl.createInfrastructure);
router.put('/infrastructure/:id',    canEdit, validate(v.updateInfrastructureRules), createAuditLog('UPDATE_INFRA', 'infrastructure'), ctrl.updateInfrastructure);
router.delete('/infrastructure/:id', canEdit, validate(v.idParam),                   createAuditLog('DELETE_INFRA', 'infrastructure'), ctrl.deleteInfrastructure);

// Comisarías
router.get('/police-stations',        validate(v.stationListRules), ctrl.getPoliceStations);
router.post('/police-stations',       canEdit, validate(v.createStationRules), createAuditLog('CREATE_STATION', 'police_stations'), ctrl.createPoliceStation);
router.put('/police-stations/:id',    canEdit, validate(v.updateStationRules), createAuditLog('UPDATE_STATION', 'police_stations'), ctrl.updatePoliceStation);
router.delete('/police-stations/:id', canEdit, validate(v.idParam),            createAuditLog('DELETE_STATION', 'police_stations'), ctrl.deletePoliceStation);

module.exports = router;

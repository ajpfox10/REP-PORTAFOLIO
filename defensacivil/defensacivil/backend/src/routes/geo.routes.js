const router = require('express').Router();
const ctrl   = require('../controllers/geo.controller');
const { authenticateToken } = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');

const auth    = authenticateToken;
const canEdit = [authenticateToken, authorize('admin', 'medium')];

router.get('/provinces',                    auth, ctrl.getProvinces);
router.get('/provinces/:id/partidos',       auth, ctrl.getPartidos);
router.get('/partidos/:id/localities',      auth, ctrl.getLocalities);
router.get('/incident-types',               auth, ctrl.getIncidentTypes);

// Infrastructure points
router.get   ('/infrastructure',        auth,     ctrl.getInfrastructure);
router.post  ('/infrastructure',        canEdit,  ctrl.createInfrastructure);
router.put   ('/infrastructure/:id',    canEdit,  ctrl.updateInfrastructure);
router.delete('/infrastructure/:id',    canEdit,  ctrl.deleteInfrastructure);

// Police stations
router.get   ('/police-stations',       auth,     ctrl.getPoliceStations);
router.post  ('/police-stations',       canEdit,  ctrl.createPoliceStation);
router.put   ('/police-stations/:id',   canEdit,  ctrl.updatePoliceStation);
router.delete('/police-stations/:id',   canEdit,  ctrl.deletePoliceStation);

module.exports = router;

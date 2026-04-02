const router = require('express').Router();
const ctrl   = require('../controllers/geo.controller');
const { authenticateToken } = require('../middleware/auth');

router.get('/provinces',                    authenticateToken, ctrl.getProvinces);
router.get('/provinces/:id/partidos',       authenticateToken, ctrl.getPartidos);
router.get('/partidos/:id/localities',      authenticateToken, ctrl.getLocalities);
router.get('/police-stations',              authenticateToken, ctrl.getPoliceStations);
router.get('/incident-types',               authenticateToken, ctrl.getIncidentTypes);
router.get('/infrastructure',               authenticateToken, ctrl.getInfrastructure);

module.exports = router;

const router = require('express').Router();
const ctrl   = require('../controllers/audit.controller');
const { authenticateToken }    = require('../middleware/auth');
const { authorize }            = require('../middleware/rbac');

router.get('/',                 authenticateToken, authorize('admin'),                  ctrl.list);
router.get('/incident/:uuid',   authenticateToken, authorize('admin', 'medium'),        ctrl.byIncident);

module.exports = router;

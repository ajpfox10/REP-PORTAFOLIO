const router = require('express').Router();
const { param, query } = require('express-validator');
const ctrl   = require('../controllers/audit.controller');
const { authenticateToken } = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { validate }          = require('../middleware/validate');

const listRules = [
  query('user_id').optional().isInt({ min: 1 }),
  query('action').optional().isString().isLength({ max: 50 }),
  query(['dateFrom', 'dateTo']).optional().isISO8601({ strict: true }).withMessage('Fecha inválida'),
  query(['page', 'limit']).optional().isInt({ min: 1 }),
];

router.get('/',               authenticateToken, authorize('admin'),           validate(listRules), ctrl.list);
router.get('/incident/:uuid', authenticateToken, authorize('admin', 'medium'), validate([param('uuid').isUUID()]), ctrl.byIncident);

module.exports = router;

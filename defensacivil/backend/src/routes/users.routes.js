const router = require('express').Router();
const ctrl   = require('../controllers/users.controller');
const { authenticateToken } = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { createAuditLog }    = require('../middleware/auditLog');
const { validate }          = require('../middleware/validate');
const { createUserRules, updateUserRules, resetPasswordRules, uuidParam } = require('../validators/user.validator');

router.use(authenticateToken, authorize('admin'));

router.get('/',                   ctrl.list);
router.get('/:uuid',              validate(uuidParam), ctrl.getOne);
router.post('/',                  validate(createUserRules), createAuditLog('CREATE_USER', 'users'), ctrl.create);
router.put('/:uuid',              validate(updateUserRules), createAuditLog('UPDATE_USER', 'users'), ctrl.update);
router.put('/:uuid/password',     validate(resetPasswordRules), createAuditLog('RESET_PASSWORD', 'users'), ctrl.resetPassword);
router.put('/:uuid/toggle-active', validate(uuidParam), createAuditLog('TOGGLE_USER', 'users'), ctrl.toggleActive);

module.exports = router;

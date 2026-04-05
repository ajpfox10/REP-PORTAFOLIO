const router = require('express').Router();
const ctrl   = require('../controllers/users.controller');
const { authenticateToken } = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { createAuditLog }    = require('../middleware/auditLog');
const { validate }          = require('../middleware/validate');
const { createUserRules, updateUserRules, resetPasswordRules } = require('../validators/user.validator');

const auth   = authenticateToken;
const admins = authorize('admin');

router.get('/',                   auth, admins, ctrl.list);
router.get('/:uuid',              auth, admins, ctrl.getOne);
router.post('/',                  auth, admins, validate(createUserRules), createAuditLog('CREATE_USER','users'), ctrl.create);
router.put('/:uuid',              auth, admins, validate(updateUserRules), createAuditLog('UPDATE_USER','users'), ctrl.update);
router.put('/:uuid/password',     auth, admins, validate(resetPasswordRules), createAuditLog('RESET_PASSWORD','users'), ctrl.resetPassword);
router.put('/:uuid/toggle-active',auth, admins, createAuditLog('TOGGLE_USER','users'), ctrl.toggleActive);

module.exports = router;

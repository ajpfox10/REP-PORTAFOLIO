const router      = require('express').Router();
const authCtrl    = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter }       = require('../middleware/rateLimiter');
const { validate }          = require('../middleware/validate');
const { loginRules, refreshRules, changePasswordRules } = require('../validators/auth.validator');

router.post('/login',           authLimiter, validate(loginRules),          authCtrl.login);
router.post('/refresh',                      validate(refreshRules),         authCtrl.refresh);
router.post('/logout',          authenticateToken,                           authCtrl.logout);
router.get('/me',               authenticateToken,                           authCtrl.me);
router.put('/change-password',  authenticateToken, validate(changePasswordRules), authCtrl.changePassword);

module.exports = router;

const router      = require('express').Router();
const authCtrl    = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter }       = require('../middleware/rateLimiter');
const { validate }          = require('../middleware/validate');
const { loginRules, changePasswordRules } = require('../validators/auth.validator');

router.post('/login',           authLimiter, validate(loginRules),                   authCtrl.login);
router.post('/refresh',                                                              authCtrl.refresh);
router.post('/logout',                                                               authCtrl.logout);
router.get('/me',               authenticateToken,                                   authCtrl.me);
router.put('/change-password',  authenticateToken, authLimiter, validate(changePasswordRules), authCtrl.changePassword);

module.exports = router;

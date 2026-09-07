'use strict';

const ADMIN_ROLES = ['superadmin', 'org_admin'];

function isAdminRole(user) {
  return (user?.roles || []).some((role) => ADMIN_ROLES.includes(role));
}

function requireAdminRole(req, res, next) {
  if (req.user?.authType === 'api_key') {
    return res.status(403).json({
      success: false,
      error: { message: 'Admin endpoints require an interactive user session', code: 'FORBIDDEN' },
    });
  }
  if (isAdminRole(req.user)) return next();
  return res.status(403).json({
    success: false,
    error: { message: 'Se requiere rol org_admin o superadmin', code: 'FORBIDDEN' },
  });
}

module.exports = {
  ADMIN_ROLES,
  isAdminRole,
  requireAdminRole,
};

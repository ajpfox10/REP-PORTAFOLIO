'use strict';

/**
 * ABAC — Attribute-Based Access Control
 *
 * Complementa el RBAC existente con validaciones de atributos del recurso:
 *   - Branch scope: el recurso pertenece a la misma sucursal del usuario
 *   - Owner scope: el recurso fue creado por el mismo usuario
 *   - Attribute match: reglas configurables de atributos
 *
 * Uso:
 *   router.get('/:id',
 *     requirePerm('patients:read'),
 *     loadResource('patients', 'id'),   // pone req.resource
 *     requireBranchScope(),             // valida branch_id
 *     handler
 *   );
 */

const { ROLE_PERMISSIONS } = require('./rbac');

// Roles que pueden ver recursos de cualquier sucursal dentro del org
const CROSS_BRANCH_ROLES = new Set([
  'superadmin', 'org_admin', 'branch_manager', 'billing_admin',
]);

// Roles que solo pueden ver sus propios recursos (sin importar branch)
const OWNER_ONLY_ROLES = new Set([
  // vacío por defecto — usar requireOwnerScope explícitamente si se necesita
]);

/**
 * Middleware que carga un recurso de DB y lo pone en req.resource.
 * Usar ANTES de requireBranchScope / requireOwnerScope.
 *
 * @param {Function} loader - async (req) => resource | null
 * @param {string}   notFoundMessage
 */
function loadResource(loader, notFoundMessage = 'Resource not found') {
  return async (req, res, next) => {
    try {
      const resource = await loader(req);
      if (!resource) {
        return res.status(404).json({
          success: false,
          error: { message: notFoundMessage, code: 'DB_001' },
        });
      }
      req.resource = resource;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Middleware que valida que req.resource pertenece a la misma sucursal del usuario.
 * Bypass para roles cross-branch (superadmin, org_admin, branch_manager).
 *
 * @param {string} branchField - campo en req.resource que contiene el branch_id
 */
function requireBranchScope(branchField = 'branch_id') {
  return (req, res, next) => {
    const roles = req.user?.roles || [];

    // Roles cross-branch pueden ver todo dentro del org
    if (roles.some(r => CROSS_BRANCH_ROLES.has(r))) return next();

    const resourceBranchId = req.resource?.[branchField];
    const userBranchId     = req.user?.branchId;

    // Si el recurso no tiene branch_id, no se puede aplicar scope → pass-through
    if (resourceBranchId == null) {
      return res.status(403).json({
        success: false,
        error: { message: 'Resource branch scope is missing', code: 'RBAC_004' },
      });
    }

    // Sin branch en el token, no se puede validar → denegar por seguridad
    if (userBranchId == null) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Branch context required to access this resource',
          code:    'RBAC_004',
        },
      });
    }

    if (String(resourceBranchId) !== String(userBranchId)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Resource belongs to a different branch',
          code:    'RBAC_004',
        },
      });
    }

    next();
  };
}

/**
 * Middleware que valida que req.resource fue creado por el usuario actual.
 * Bypass para roles privilegiados.
 *
 * @param {string} ownerField - campo en req.resource que contiene el owner (user_id / created_by)
 * @param {string[]} bypassRoles - roles que pueden ver recursos de cualquier owner
 */
function requireOwnerScope(
  ownerField  = 'created_by',
  bypassRoles = ['superadmin', 'org_admin', 'branch_manager'],
) {
  return (req, res, next) => {
    const roles = req.user?.roles || [];
    if (roles.some(r => bypassRoles.includes(r))) return next();

    const resourceOwner = req.resource?.[ownerField];
    const userId        = req.user?.userId;

    if (resourceOwner == null || userId == null) {
      return res.status(403).json({
        success: false,
        error: { message: 'Resource owner scope is missing', code: 'RBAC_003' },
      });
    }

    if (String(resourceOwner) !== String(userId)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'You can only access your own resources',
          code:    'RBAC_003',
        },
      });
    }

    next();
  };
}

/**
 * Crea un middleware que valida atributos del recurso contra atributos del usuario.
 * Permite reglas compuestas.
 *
 * @param {Array<{roles: string[], resourceField: string, userField: string, bypassRoles?: string[]}>} rules
 *
 * @example
 *   requireAttributeMatch([
 *     { roles: ['veterinarian'], resourceField: 'branch_id', userField: 'branchId' },
 *     { roles: ['client'],       resourceField: 'client_id', userField: 'userId'   },
 *   ])
 */
function requireAttributeMatch(rules) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];

    for (const rule of rules) {
      const bypass = rule.bypassRoles || ['superadmin', 'org_admin'];

      // Si el usuario tiene un rol bypass, saltar esta regla
      if (userRoles.some(r => bypass.includes(r))) continue;

      // Si el usuario tiene el rol afectado por la regla
      if (rule.roles.some(r => userRoles.includes(r))) {
        const resourceVal = req.resource?.[rule.resourceField];
        const userVal     = req.user?.[rule.userField];

        if (resourceVal == null || userVal == null) {
          return res.status(403).json({
            success: false,
            error: {
              message: `Access denied: ${rule.resourceField} scope missing`,
              code: 'RBAC_003',
            },
          });
        }

        if (String(resourceVal) !== String(userVal)) {
          return res.status(403).json({
            success: false,
            error: {
              message: `Access denied: ${rule.resourceField} mismatch`,
              code:    'RBAC_003',
            },
          });
        }
      }
    }

    next();
  };
}

module.exports = {
  loadResource,
  requireBranchScope,
  requireOwnerScope,
  requireAttributeMatch,
  CROSS_BRANCH_ROLES,
};

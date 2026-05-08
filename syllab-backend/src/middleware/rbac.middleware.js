'use strict';

/**
 * Role hierarchy: ADMIN > INSTRUCTOR/PROCTOR > STUDENT
 * Factory: requireRole('INSTRUCTOR', 'ADMIN') — pass allowed roles
 * Returns 403 Forbidden for wrong role (not 401)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        status: 401,
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Role ${req.user.role} is not permitted to access this resource. Required: ${allowedRoles.join(' or ')}`,
        status: 403,
      });
    }

    next();
  };
}

/**
 * Ownership check — student can only access their own data
 * Instructor/Admin can access any
 */
function requireOwnershipOrRole(getResourceOwnerId, ...privilegedRoles) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required', status: 401 });
    }

    if (privilegedRoles.includes(req.user.role)) return next();

    try {
      const ownerId = await getResourceOwnerId(req);
      if (ownerId !== req.user.id) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not have permission to access this resource',
          status: 403,
        });
      }
      next();
    } catch {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied', status: 403 });
    }
  };
}

module.exports = { requireRole, requireOwnershipOrRole };

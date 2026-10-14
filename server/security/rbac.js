/**
 * Phase 14 — role-based permissions (dev-friendly, explicit).
 * Roles: viewer | engineer | verifier | admin
 */

export const ROLES = Object.freeze({
  viewer: {
    "model.read": true,
    "runtime.read": true,
    "runtime.write": false,
    "verify.run": false,
    "connect.mutate": false,
    "logic.deploy": false,
    "security.admin": false
  },
  engineer: {
    "model.read": true,
    "model.write": true,
    "runtime.read": true,
    "runtime.write": true,
    "verify.run": true,
    "connect.mutate": true,
    "logic.deploy": true,
    "security.admin": false
  },
  verifier: {
    "model.read": true,
    "runtime.read": true,
    "runtime.write": true,
    "verify.run": true,
    "connect.mutate": false,
    "logic.deploy": false,
    "security.admin": false
  },
  admin: {
    "model.read": true,
    "model.write": true,
    "runtime.read": true,
    "runtime.write": true,
    "verify.run": true,
    "connect.mutate": true,
    "logic.deploy": true,
    "security.admin": true,
    "live.integration": true
  }
});

export function resolveRole(req) {
  const hdr = req.headers["x-p6-role"] || req.headers["x-role"];
  const q = req.query?.role;
  const role = String(hdr || q || process.env.P6_DEFAULT_ROLE || "engineer").toLowerCase();
  return ROLES[role] ? role : "viewer";
}

export function can(role, permission) {
  const perms = ROLES[role] || ROLES.viewer;
  return !!perms[permission];
}

export function requirePerm(permission) {
  return (req, res, next) => {
    const role = resolveRole(req);
    req.p6Role = role;
    if (!can(role, permission)) {
      return res.status(403).json({
        ok: false,
        error: `Forbidden: role '${role}' lacks ${permission}`,
        role
      });
    }
    next();
  };
}

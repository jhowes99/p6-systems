/**
 * Simple tier-based feature gating: core < pro < enterprise.
 * Use requireTier("pro") or requireTier("enterprise") middleware on gated routes.
 */

import { getLicenseTier } from "./config_store.js";

const TIER_ORDER = { core: 0, pro: 1, enterprise: 2 };

export function hasTier(requiredTier) {
  const required = TIER_ORDER[requiredTier] ?? -1;
  const current = TIER_ORDER[getLicenseTier()] ?? 0;
  return current >= required;
}

/**
 * Express middleware. Call next() if current tier >= required; else 403 with OT-friendly JSON.
 */
export function requireTier(requiredTier) {
  const label = requiredTier === "enterprise" ? "Enterprise" : requiredTier === "pro" ? "Pro" : "Core";
  return (req, res, next) => {
    if (hasTier(requiredTier)) return next();
    res.status(403).json({
      ok: false,
      error: `This feature requires ${label}. Contact your administrator to upgrade.`
    });
  };
}

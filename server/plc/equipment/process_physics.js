/**
 * Shared lumped-parameter process physics for Virtual Commissioning.
 *
 * Fidelity: cylindrical tank geometry + constant-density volume balance +
 * rated pump flow. NOT CFD, pipe network hydraulics, NPSH curves, or
 * compressible-flow. Tolerances below are for demo conservation checks.
 */

export const PHYSICS_FIDELITY = Object.freeze({
  model: "lumped_mass_balance_v1",
  supports: [
    "cylindrical_tank_geometry",
    "constant_density_volume_balance",
    "rated_pump_flow_gpm",
    "valve_travel_time",
    "dry_run_low_source_shutdown",
    "dest_high_level_switch",
    "simple_discharge_pressure_proxy"
  ],
  unsupported: [
    "pipe_friction_headloss",
    "NPSH_cavitation_curves",
    "multi_phase_flow",
    "thermal_effects",
    "CFD_or_transient_wave",
    "certified_safety_functions"
  ],
  /** Absolute volume conservation tolerance (US gallons) over a short transfer window */
  massBalanceAbsTolGal: 0.75,
  /** Relative conservation tolerance vs transferred volume */
  massBalanceRelTol: 0.03,
  /** Level % comparison tolerance after round-trip writes */
  levelPctTol: 0.15
});

const GAL_PER_M3 = 264.172052;

/**
 * @param {{ heightM: number, diameterM: number }} geom
 * @returns {number} tank capacity in US gallons
 */
export function tankCapacityGal(geom) {
  const r = Number(geom.diameterM) / 2;
  const h = Number(geom.heightM);
  const m3 = Math.PI * r * r * h;
  return m3 * GAL_PER_M3;
}

/**
 * Volume (gal) at level percent for cylindrical tank.
 */
export function volumeGalFromLevelPct(levelPct, geom) {
  const pct = Math.max(0, Math.min(100, Number(levelPct) || 0));
  return tankCapacityGal(geom) * (pct / 100);
}

/**
 * Level percent from volume (gal).
 */
export function levelPctFromVolumeGal(volGal, geom) {
  const cap = tankCapacityGal(geom);
  if (!(cap > 0)) return 0;
  return Math.max(0, Math.min(100, (Number(volGal) / cap) * 100));
}

/**
 * Integrate constant flow (GPM) over one scan.
 * @returns {{ dVolGal: number, dtMin: number }}
 */
export function integrateFlowGal(flowGpm, scanMs) {
  const dtMin = Math.max(0, Number(scanMs) || 0) / 60000;
  return { dVolGal: Number(flowGpm) * dtMin, dtMin };
}

/**
 * Transfer volume from source → dest; returns new levels + actual transferred gal.
 * Conserves mass within clamp (empty source / full dest reduce actual transfer).
 */
export function transferBetweenTanks({
  sourceLevelPct,
  destLevelPct,
  flowGpm,
  scanMs,
  sourceGeom,
  destGeom
}) {
  const { dVolGal } = integrateFlowGal(flowGpm, scanMs);
  if (!(dVolGal > 0)) {
    return {
      sourceLevelPct: Number(sourceLevelPct),
      destLevelPct: Number(destLevelPct),
      transferredGal: 0,
      flowLimited: false
    };
  }

  let srcVol = volumeGalFromLevelPct(sourceLevelPct, sourceGeom);
  let dstVol = volumeGalFromLevelPct(destLevelPct, destGeom);
  const srcCap = tankCapacityGal(sourceGeom);
  const dstCap = tankCapacityGal(destGeom);

  const maxFromSrc = srcVol;
  const maxToDst = Math.max(0, dstCap - dstVol);
  const actual = Math.min(dVolGal, maxFromSrc, maxToDst);

  srcVol -= actual;
  dstVol += actual;

  return {
    sourceLevelPct: levelPctFromVolumeGal(srcVol, sourceGeom),
    destLevelPct: levelPctFromVolumeGal(dstVol, destGeom),
    transferredGal: actual,
    flowLimited: actual + 1e-9 < dVolGal,
    sourceVolGal: srcVol,
    destVolGal: dstVol,
    sourceCapGal: srcCap,
    destCapGal: dstCap
  };
}

/**
 * Check conservation: Δsource + Δdest ≈ 0 within tolerances.
 */
export function checkMassBalance({
  sourceBeforePct,
  destBeforePct,
  sourceAfterPct,
  destAfterPct,
  sourceGeom,
  destGeom,
  absTolGal = PHYSICS_FIDELITY.massBalanceAbsTolGal,
  relTol = PHYSICS_FIDELITY.massBalanceRelTol
}) {
  const s0 = volumeGalFromLevelPct(sourceBeforePct, sourceGeom);
  const d0 = volumeGalFromLevelPct(destBeforePct, destGeom);
  const s1 = volumeGalFromLevelPct(sourceAfterPct, sourceGeom);
  const d1 = volumeGalFromLevelPct(destAfterPct, destGeom);
  const dSource = s1 - s0;
  const dDest = d1 - d0;
  const residual = dSource + dDest;
  const moved = Math.max(Math.abs(dSource), Math.abs(dDest), 1e-9);
  const ok = Math.abs(residual) <= Math.max(absTolGal, relTol * moved);
  return { ok, residualGal: residual, movedGal: moved, dSourceGal: dSource, dDestGal: dDest };
}

/**
 * Switch Runtime ladder + equipment simulation to match the bound P6 project.
 * Replaces (does not stack) prior demo plant hooks so tank ↔ water transfer stay honest.
 */

import { attachTankTransfer } from "./tank_transfer.js";
import { attachWaterTransfer } from "./water_transfer.js";
import { attachEngineeringPlant, ensureEngineeringSignals } from "./engineering_plant.js";
import { WATER_TRANSFER_SLUG, WATER_TRANSFER_NAME } from "../../model/seed_water_transfer.js";
import { TANK_TRANSFER_DEMO_SLUG } from "../../model/seed_tank_transfer_demo.js";

/**
 * @param {object|null} project
 * @returns {"tank_transfer"|"water_transfer"|"engineering"|null}
 */
export function detectPlantTemplate(project) {
  if (!project) return null;
  const meta = project.meta || {};
  const slug = String(meta.slug || "").toLowerCase();
  // Explicit engineering / imported project takes priority over name heuristics
  if (meta.plantTemplate === "engineering" || meta.workspaceMode === "project") {
    return "engineering";
  }
  if (slug === TANK_TRANSFER_DEMO_SLUG || meta.masterSpecSection === 40 || meta.samplePlant === true) {
    return "tank_transfer";
  }
  if (slug === WATER_TRANSFER_SLUG || project.name === WATER_TRANSFER_NAME) {
    return "water_transfer";
  }
  const tags = new Set((project.signals || []).map((s) => s.tag));
  if (tags.has("LSH101.High") || tags.has("XV101.OpenCommand") || tags.has("ESTOP101.Healthy")) {
    return "water_transfer";
  }
  if (tags.has("LT-101.High") || tags.has("VALVE-101.OpenCommand") || tags.has("ESD-101.Healthy")) {
    return "tank_transfer";
  }
  // Imported / scratch projects with equipment → generic engineering plant
  if ((project.equipment || []).length > 0) return "engineering";
  return null;
}

/**
 * Install the plant IR + equipment for the project. Clears prior plant hooks first.
 * @returns {{ ok: boolean, template: string|null, attached: boolean, signalsEnsured?: object }}
 */
export function attachPlantForProject(plc, io, project) {
  const template = detectPlantTemplate(project);
  if (!template || !plc || !io) {
    return { ok: true, template: template || null, attached: false };
  }

  // Drop stacked demo hooks from earlier attaches
  plc.equipmentStep = null;
  plc.onReset = null;

  let signalsEnsured = null;
  if (template === "tank_transfer") {
    attachTankTransfer(plc, io);
  } else if (template === "water_transfer") {
    attachWaterTransfer(plc, io);
  } else if (template === "engineering") {
    signalsEnsured = ensureEngineeringSignals(project);
    attachEngineeringPlant(plc, io, project);
  }

  plc._plantTemplate = template;
  return { ok: true, template, attached: true, signalsEnsured };
}

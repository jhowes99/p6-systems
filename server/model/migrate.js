/**
 * Canonical model migrations. Never silently break persisted projects.
 */

import { SCHEMA_VERSION, normalizeProject } from "./schema.js";

/**
 * Ordered migrations: fromVersion → apply → results in fromVersion+1
 * Each fn(project) mutates/returns project at the next schema version.
 */
const MIGRATIONS = [
  // v0 (missing schemaVersion) → v1
  {
    from: 0,
    to: 1,
    name: "introduce-schema-v1",
    apply(project) {
      const n = normalizeProject(project);
      n.schemaVersion = 1;
      if (!n.modelVersion) n.modelVersion = 1;
      if (!n.legacy) {
        n.legacy = { ladderIR: null, ioMap: {}, causeEffectRules: [], ioEntries: [] };
      }
      return n;
    }
  },
  {
    from: 1,
    to: 2,
    name: "cem2-schema-v2",
    apply(project) {
      const n = normalizeProject(project);
      n.schemaVersion = 2;
      if (!Array.isArray(n.controlSequences)) n.controlSequences = [];
      if (!Array.isArray(n.vendorMappings)) n.vendorMappings = [];
      if (n.lastValidation === undefined) n.lastValidation = null;

      const touchEntity = (item) => {
        if (!item || typeof item !== "object") return item;
        if (!item.updatedAt) item.updatedAt = new Date().toISOString();
        if (item.validationStatus == null) item.validationStatus = "UNKNOWN";
        if (Array.isArray(item.sourceDocumentIds) && !item.sourceDocumentRefs) {
          item.sourceDocumentRefs = [...item.sourceDocumentIds];
        }
        return item;
      };

      n.equipment = n.equipment.map(touchEntity);
      n.instruments = n.instruments.map(touchEntity);
      n.signals = n.signals.map(touchEntity);
      n.interlocks = n.interlocks.map(touchEntity);
      n.testCases = n.testCases.map(touchEntity);
      return n;
    }
  }
];

export function getTargetSchemaVersion() {
  return SCHEMA_VERSION;
}

/**
 * Migrate a project document to SCHEMA_VERSION.
 * @returns {{ project, migrationsApplied: string[] }}
 */
export function migrateProject(raw) {
  let project = raw && typeof raw === "object" ? { ...raw } : normalizeProject({ name: "Unnamed" });
  let version = Number(project.schemaVersion);
  if (!Number.isFinite(version) || version < 0) version = 0;

  const migrationsApplied = [];
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      throw new Error(`No migration path from schemaVersion ${version} to ${SCHEMA_VERSION}`);
    }
    project = step.apply(project);
    project.schemaVersion = step.to;
    version = step.to;
    migrationsApplied.push(step.name);
  }

  project = normalizeProject(project);
  project.schemaVersion = SCHEMA_VERSION;
  return { project, migrationsApplied };
}

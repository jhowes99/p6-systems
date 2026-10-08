/**
 * Milestone A — Ignition Engineering Generator: UDT definitions + instances.
 * Proposal-only until engineer approval. Never auto-deploys to Gateway.
 *
 * Target format: Ignition 8.3-compatible tag JSON (UdtType / instance tags).
 * Shared SoR: canonical project equipment + EquipmentLibrary member names.
 */

import fs from "fs";
import path from "path";
import { EquipmentLibrary } from "../plc/equipment/library.js";

export const TARGET_IGNITION_VERSION = "8.3.9";

/** Reusable UDT blueprints keyed by P6 equipment type */
export const UDT_BLUEPRINTS = {
  pump: {
    udtName: "P6_Pump",
    p6LibraryType: "Pump",
    description: "Centrifugal / process pump control faceplate",
    members: [
      { name: "RunCommand", dataType: "Boolean", p6Suffix: "RunCommand" },
      { name: "RunningFeedback", dataType: "Boolean", p6Suffix: "RunningFeedback" },
      { name: "FaultFeedback", dataType: "Boolean", p6Suffix: "Fault" },
      { name: "Available", dataType: "Boolean", p6Suffix: "Available", optional: true },
      { name: "Interlocked", dataType: "Boolean", p6Suffix: "Interlocked", optional: true },
      { name: "OperatingState", dataType: "String", p6Suffix: "OperatingState", optional: true },
      { name: "RuntimeStatus", dataType: "String", p6Suffix: "RuntimeStatus", optional: true }
    ]
  },
  motor: {
    udtName: "P6_Motor",
    p6LibraryType: "Motor",
    description: "Motor starter / VFD faceplate",
    members: [
      { name: "RunCommand", dataType: "Boolean", p6Suffix: "RunCommand" },
      { name: "Energize", dataType: "Boolean", p6Suffix: "Energize" },
      { name: "RunningFeedback", dataType: "Boolean", p6Suffix: "RunningFeedback" },
      { name: "FaultFeedback", dataType: "Boolean", p6Suffix: "Fault" },
      { name: "Available", dataType: "Boolean", p6Suffix: "Available" },
      { name: "Interlocked", dataType: "Boolean", p6Suffix: "Interlocked", optional: true },
      { name: "OperatingState", dataType: "String", p6Suffix: "OperatingState", optional: true }
    ]
  },
  valve: {
    udtName: "P6_Valve",
    p6LibraryType: "Valve",
    description: "On/off valve with position feedback",
    members: [
      { name: "OpenCommand", dataType: "Boolean", p6Suffix: "OpenCommand" },
      { name: "OpenedFeedback", dataType: "Boolean", p6Suffix: "OpenedFeedback" },
      { name: "ClosedFeedback", dataType: "Boolean", p6Suffix: "ClosedFeedback" },
      { name: "FaultFeedback", dataType: "Boolean", p6Suffix: "Fault" }
    ]
  }
};

function engDir() {
  const cwd = process.cwd();
  if (path.basename(cwd) === "server") {
    return path.join(cwd, "data", "canonical", "ignition_engineering");
  }
  return path.join(cwd, "server", "data", "canonical", "ignition_engineering");
}

function packagePath(projectId) {
  return path.join(engDir(), projectId, "udt_package.json");
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function defaultOptions(opts = {}) {
  return {
    targetIgnitionVersion: opts.targetIgnitionVersion || TARGET_IGNITION_VERSION,
    naming: {
      udtPrefix: opts.naming?.udtPrefix ?? "P6_",
      instanceFolder: opts.naming?.instanceFolder ?? "Equipment",
      provider: opts.naming?.provider ?? "P6",
      projectFolder: opts.naming?.projectFolder ?? null
    },
    typesFilter: opts.typesFilter || ["pump"], // Milestone A: pump first
    // Motor pairing is opt-in (Water Transfer M101 has partial signals vs full P6_Motor)
    includeRelatedMotor: opts.includeRelatedMotor === true
  };
}

function opcNodeId(projectName, signalTag) {
  const proj = String(projectName || "Project").replace(/\s+/g, "");
  return `ns=2;s=P6Systems/Projects/${proj}/${signalTag}`;
}

function ignitionTagPath(naming, projectFolder, equipmentTag, member) {
  const parts = [
    `[${naming.provider}]`,
    naming.instanceFolder,
    projectFolder,
    equipmentTag,
    member
  ].filter(Boolean);
  // [P6]Equipment/WaterTransferSystem/P101/RunCommand
  return `${parts[0]}${parts.slice(1).join("/")}`;
}

function buildUdtType(blueprint, naming) {
  const name = blueprint.udtName.startsWith(naming.udtPrefix)
    ? blueprint.udtName
    : `${naming.udtPrefix}${blueprint.udtName.replace(/^P6_/, "")}`;

  const tags = blueprint.members.map((m) => ({
    name: m.name,
    tagType: "AtomicTag",
    dataType: m.dataType,
    valueSource: "memory",
    documentation: `P6 member → *.${m.p6Suffix}`
  }));

  return {
    name,
    tagType: "UdtType",
    typeId: `p6:${name}`,
    documentation: blueprint.description,
    tags,
    p6LibraryType: blueprint.p6LibraryType,
    p6EquipmentType: Object.keys(UDT_BLUEPRINTS).find(
      (k) => UDT_BLUEPRINTS[k].udtName === blueprint.udtName
    )
  };
}

function resolveSignal(signals, equipmentTag, suffix) {
  const exact = `${equipmentTag}.${suffix}`;
  const hit = signals.find((s) => s.tag === exact);
  if (hit) return hit;
  // Soft aliases used in Water Transfer seed
  const aliases = {
    Fault: ["Fault", "FaultFeedback"],
    Available: ["Available"],
    Interlocked: ["Interlocked"],
    OperatingState: ["OperatingState", "State"],
    RuntimeStatus: ["RuntimeStatus", "Status"]
  };
  for (const alt of aliases[suffix] || []) {
    const t = `${equipmentTag}.${alt}`;
    const s = signals.find((x) => x.tag === t);
    if (s) return s;
  }
  return null;
}

function buildInstance({
  equipment,
  blueprint,
  udtTypeName,
  naming,
  projectFolder,
  projectName,
  signals
}) {
  const members = [];
  const missing = [];
  for (const m of blueprint.members) {
    const sig = resolveSignal(signals, equipment.tag, m.p6Suffix);
    if (!sig && !m.optional) {
      missing.push(`${equipment.tag}.${m.p6Suffix}`);
    }
    members.push({
      name: m.name,
      dataType: m.dataType,
      p6Signal: sig?.tag || null,
      ignitionTagPath: ignitionTagPath(naming, projectFolder, equipment.tag, m.name),
      opcuaNodeId: sig ? opcNodeId(projectName, sig.tag) : null,
      direction: "P6_TO_IGNITION",
      engineeringUnits: sig?.units || null,
      qualityHandling: "propagate_opc_quality",
      present: !!sig,
      optional: !!m.optional
    });
  }

  return {
    name: equipment.tag,
    tagType: "UdtInstance",
    typeId: udtTypeName,
    path: `[${naming.provider}]${naming.instanceFolder}/${projectFolder}/${equipment.tag}`,
    equipmentId: equipment.id || null,
    equipmentType: equipment.type,
    parameters: {},
    members,
    missingRequiredSignals: missing
  };
}

/**
 * Validate Ignition-compatible package structure.
 */
export function validateUdtPackage(pkg) {
  const errors = [];
  const warnings = [];

  if (!pkg || pkg.p6ArtifactType !== "ignition.udt.package") {
    errors.push("p6ArtifactType must be ignition.udt.package");
  }
  if (pkg?.targetIgnitionVersion !== TARGET_IGNITION_VERSION) {
    warnings.push(
      `targetIgnitionVersion ${pkg?.targetIgnitionVersion} differs from pinned ${TARGET_IGNITION_VERSION}`
    );
  }
  const typeNames = new Set();
  for (const t of pkg?.udtTypes || []) {
    if (!t.name || t.tagType !== "UdtType") errors.push(`Invalid UdtType: ${t?.name}`);
    if (typeNames.has(t.name)) errors.push(`Duplicate UDT definition: ${t.name}`);
    typeNames.add(t.name);
    if (!Array.isArray(t.tags) || !t.tags.length) errors.push(`UDT ${t.name} has no members`);
    const mem = new Set();
    for (const tag of t.tags || []) {
      if (!tag.name) errors.push(`UDT ${t.name} has unnamed member`);
      if (mem.has(tag.name)) errors.push(`UDT ${t.name} duplicate member ${tag.name}`);
      mem.add(tag.name);
      if (!tag.dataType) errors.push(`UDT ${t.name}.${tag.name} missing dataType`);
    }
  }
  const instanceNames = new Set();
  for (const inst of pkg?.udtInstances || []) {
    if (!inst.name) errors.push("Instance missing name");
    if (instanceNames.has(inst.name)) errors.push(`Duplicate instance: ${inst.name}`);
    instanceNames.add(inst.name);
    if (!typeNames.has(inst.typeId) && !typeNames.has(inst.typeId?.replace(/^p6:/, ""))) {
      // typeId may be name or p6:Name
      const ok = [...typeNames].some((n) => n === inst.typeId || `p6:${n}` === inst.typeId);
      if (!ok) errors.push(`Instance ${inst.name} references unknown type ${inst.typeId}`);
    }
    for (const m of inst.members || []) {
      if (m.missingRequiredSignals) continue;
      if (!m.optional && !m.present) {
        warnings.push(`Instance ${inst.name}: missing P6 signal for ${m.name}`);
      }
      if (m.present && !m.opcuaNodeId) {
        errors.push(`Instance ${inst.name}.${m.name} missing opcuaNodeId`);
      }
    }
    if (inst.missingRequiredSignals?.length) {
      warnings.push(
        `Instance ${inst.name}: missing required signals ${inst.missingRequiredSignals.join(", ")}`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Generate UDT package from canonical project (proposal).
 */
export function generateUdtPackage(project, opts = {}) {
  const options = defaultOptions(opts);
  const projectFolder =
    options.naming.projectFolder ||
    String(project?.name || "Project").replace(/\s+/g, "");
  const naming = options.naming;
  const signals = project?.signals || [];
  const equipment = project?.equipment || [];

  const typesNeeded = new Set(options.typesFilter.map((t) => String(t).toLowerCase()));
  if (options.includeRelatedMotor && typesNeeded.has("pump")) {
    // Water Transfer often pairs P101 + M101; include motor UDT when motors exist
    if (equipment.some((e) => String(e.type).toLowerCase() === "motor")) {
      typesNeeded.add("motor");
    }
  }

  const udtTypes = [];
  const typeNameByEquipType = {};
  for (const eqType of typesNeeded) {
    const bp = UDT_BLUEPRINTS[eqType];
    if (!bp) continue;
    // Cross-check library exists
    if (!EquipmentLibrary[bp.p6LibraryType]) {
      throw new Error(`Equipment library missing type ${bp.p6LibraryType}`);
    }
    const ut = buildUdtType(bp, naming);
    udtTypes.push(ut);
    typeNameByEquipType[eqType] = ut.name;
  }

  const udtInstances = [];
  for (const eq of equipment) {
    const t = String(eq.type || "").toLowerCase();
    if (!typesNeeded.has(t)) continue;
    const bp = UDT_BLUEPRINTS[t];
    if (!bp) continue;
    udtInstances.push(
      buildInstance({
        equipment: eq,
        blueprint: bp,
        udtTypeName: typeNameByEquipType[t],
        naming,
        projectFolder,
        projectName: project?.name,
        signals
      })
    );
  }

  const pkg = {
    p6ArtifactType: "ignition.udt.package",
    generator: "p6.connect.ignition_udt",
    targetIgnitionVersion: options.targetIgnitionVersion,
    projectId: project?.id || null,
    projectName: project?.name || null,
    reviewRequired: true,
    approved: false,
    approvedAt: null,
    approvedBy: null,
    naming,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    note:
      "Proposal only — engineer must approve before export/deploy. Does not overwrite Ignition Gateway configs.",
    udtTypes,
    udtInstances,
    validation: null
  };
  pkg.validation = validateUdtPackage(pkg);
  return pkg;
}

export function loadUdtPackage(projectId) {
  const p = packagePath(projectId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function saveUdtPackage(projectId, pkg) {
  ensureDir(path.dirname(packagePath(projectId)));
  const next = {
    ...pkg,
    projectId,
    updatedAt: new Date().toISOString(),
    validation: validateUdtPackage(pkg)
  };
  fs.writeFileSync(packagePath(projectId), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function approveUdtPackage(projectId, { actor = "engineer" } = {}) {
  const pkg = loadUdtPackage(projectId);
  if (!pkg) throw new Error("No UDT package to approve — generate first");
  const validation = validateUdtPackage(pkg);
  if (!validation.ok) {
    throw new Error(`Cannot approve invalid package: ${validation.errors.join("; ")}`);
  }
  pkg.approved = true;
  pkg.approvedAt = new Date().toISOString();
  pkg.approvedBy = actor;
  pkg.reviewRequired = false;
  pkg.validation = validation;
  return saveUdtPackage(projectId, pkg);
}

export function getEngineeringStatus() {
  return {
    feature: "Ignition Engineering Generator",
    targetIgnitionVersion: TARGET_IGNITION_VERSION,
    milestones: {
      A_udt: "active",
      B_tag_map: "partial",
      C_perspective: "planned",
      D_templates: "planned"
    },
    deploy: "download_only",
    note: "Ignition optional; artifacts are proposals until approved. No invented Gateway APIs."
  };
}

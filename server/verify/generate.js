/**
 * Generate Verify tests from approved model requirements / interlocks.
 * Maps known Water Transfer requirements onto executable catalog entries.
 * Does not invent PASS — only emits catalog refs + generation metadata.
 */

import { DataClass } from "../model/schema.js";
import {
  REQUIREMENT_TEMPLATES,
  VERIFY_CATALOG,
  listCatalogSummaries,
  getCatalogTest
} from "./catalog.js";

const INTERLOCK_TO_TESTS = {
  LSH101_INHIBIT: ["P101_START_BLOCKED_LSH", "P101_INTERLOCK_STOP_LSH", "LSH101_BLOCKS_TRANSFER"],
  ESTOP101_SHUTDOWN: ["P101_ESTOP_SHUTDOWN"]
};

/**
 * @param {object} project — canonical project
 * @returns {{ ok: boolean, generated: object[], skipped: object[], requirements: object[], modelVersion: number|null }}
 */
export function generateTestsFromApprovedRequirements(project) {
  if (!project) {
    return {
      ok: false,
      error: "No project",
      generated: [],
      skipped: [],
      requirements: [],
      modelVersion: null
    };
  }

  const approvedInterlocks = (project.interlocks || []).filter(
    (i) => i.dataClass === DataClass.ENGINEER_APPROVED || i.dataClass === "ENGINEER_APPROVED"
  );
  const approvedTestCases = (project.testCases || []).filter(
    (t) => t.dataClass === DataClass.ENGINEER_APPROVED || t.dataClass === "ENGINEER_APPROVED"
  );

  const selectedIds = new Set();
  const skipped = [];
  const reqHits = [];

  // Always include start-valid + valve travel when Water Transfer equipment present
  const tags = new Set((project.equipment || []).map((e) => String(e.tag || "").toUpperCase()));
  const hasWt = tags.has("P101") || tags.has("TANK101") || tags.has("XV101");
  if (hasWt) {
    selectedIds.add("P101_START_VALID");
    selectedIds.add("XV101_VALVE_TRAVEL_FAIL");
    selectedIds.add("P101_MOTOR_FAULT_ALARM"); // blocked entry — honest
    reqHits.push(...REQUIREMENT_TEMPLATES.filter((r) =>
      ["REQ-P101-START-VALID", "REQ-XV101-TRAVEL-FAIL", "REQ-P101-MOTOR-FAULT-ALARM"].includes(r.id)
    ));
  }

  for (const ilk of approvedInterlocks) {
    const mapped = INTERLOCK_TO_TESTS[ilk.name] || [];
    if (!mapped.length) {
      skipped.push({
        reason: "No catalog mapping for approved interlock",
        interlock: ilk.name,
        status: "NOT_RUN"
      });
      continue;
    }
    for (const id of mapped) selectedIds.add(id);
    const tmpl = REQUIREMENT_TEMPLATES.find((r) => r.source === `interlock:${ilk.name}`);
    if (tmpl) reqHits.push(tmpl);
  }

  // Include approved model testCases that match catalog ids
  for (const tc of approvedTestCases) {
    const cat = getCatalogTest(tc.name);
    if (cat) selectedIds.add(cat.id);
    else {
      skipped.push({
        reason: "Approved model testCase has no executable catalog runner",
        testCase: tc.name,
        status: "NOT_RUN"
      });
    }
  }

  const generated = [...selectedIds].map((id) => {
    const cat = getCatalogTest(id);
    const summary = listCatalogSummaries().find((s) => s.id === id);
    return {
      id,
      name: cat?.name || id,
      equipment: cat?.equipment || [],
      requirementRef: cat?.requirementRef || null,
      executable: cat?.executable !== false,
      blockReason: cat?.blockReason || null,
      version: cat?.version || 1,
      passFailCriteria: cat?.passFailCriteria || null,
      description: cat?.description || summary?.description || "",
      source: "generateTestsFromApprovedRequirements",
      modelVersion: project.modelVersion ?? null
    };
  });

  // Dedupe requirements
  const requirements = [];
  const seenReq = new Set();
  for (const r of reqHits) {
    if (seenReq.has(r.id)) continue;
    seenReq.add(r.id);
    requirements.push(r);
  }

  return {
    ok: true,
    projectId: project.id,
    modelVersion: project.modelVersion ?? null,
    generated,
    skipped,
    requirements,
    catalogSize: VERIFY_CATALOG.length,
    executableCount: generated.filter((g) => g.executable).length,
    blockedCount: generated.filter((g) => !g.executable).length,
    honesty:
      "Generated tests reference the Verify catalog only. Execution against Runtime records actual PASS/FAIL/BLOCKED — never predetermined PASS."
  };
}

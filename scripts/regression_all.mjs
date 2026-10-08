/**
 * Phase 15 — full regression harness
 * Usage: node scripts/regression_all.mjs
 */

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const jobs = [
  { name: "model", cmd: "node", args: ["server/model/smoke_test.js"] },
  { name: "runtime", cmd: "node", args: ["server/plc/smoke_test_runtime.js"] },
  { name: "water_transfer", cmd: "node", args: ["server/plc/equipment/smoke_test_water_transfer.js"] },
  {
    name: "fat_estop",
    cmd: "node",
    args: [
      "--input-type=module",
      "-e",
      "import { runFatTest } from './server/verify/fat_runner.js'; const r=await runFatTest(); if(!r.pass) process.exit(1); console.log('FAT PASS');"
    ]
  },
  { name: "ocr", cmd: "node", args: ["scripts/smoke_ocr.mjs"] },
  { name: "ignition_udt", cmd: "node", args: ["scripts/smoke_ignition_udt.mjs"] }
];

let failed = 0;
for (const job of jobs) {
  console.log(`\n=== ${job.name} ===`);
  const r = spawnSync(job.cmd, job.args, { cwd: root, encoding: "utf8", shell: false });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`FAIL ${job.name} exit=${r.status}`);
    failed += 1;
  } else {
    console.log(`PASS ${job.name}`);
  }
}

console.log(`\nRegression complete: ${jobs.length - failed}/${jobs.length} passed`);
process.exit(failed ? 1 : 0);

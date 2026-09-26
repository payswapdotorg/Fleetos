import fs from "node:fs";
import path from "node:path";

const required = [
  "AGENTS.md",
  "AI_CONTINUATION.md",
  "spec/ARCHITECTURE.md",
  "spec/ARCHITECTURE-LOCK.md",
  "spec/MODULE-DEPENDENCY-MAP.md",
  "spec/WORK-ITEM-DEPENDENCY-GRAPH.md",
  "spec/work-items/WORK-ITEM-CATALOG.md",
  "spec/worker-ownership.yaml",
  "spec/ADR/TEMPLATE.md",
  "docs/tech-lead/LLM-ARCHITECT-HANDOFF.md",
  "docs/tech-lead/worker-model.md",
  "docs/tech-lead/worker-runbook.md",
  "docs/tech-lead/merge-gates.md",
  "spec/integration/ADCOS.md",
  "spec/integration/ARENA.md",
  "spec/integration/AURUM.md"
];

for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) {
    console.error("ARCHITECTURE CHECK FAILED: missing", file);
    process.exit(1);
  }
}

const lock = fs.readFileSync("spec/ARCHITECTURE-LOCK.md", "utf8");
for (const phrase of [
  "Device Twin",
  "Provider-specific APIs/types never enter core domain contracts",
  "Redis/cache/queues cannot become business truth",
  "Tenant isolation",
  "Workers implement contracts"
]) {
  if (!lock.includes(phrase)) {
    console.error("ARCHITECTURE CHECK FAILED: missing lock phrase:", phrase);
    process.exit(1);
  }
}

const ownership = fs.readFileSync("spec/worker-ownership.yaml", "utf8");
for (const phrase of ["worker_limit: 3", "shared_contract_owner: tech-lead", "worker-a:", "worker-b:", "worker-c:"]) {
  if (!ownership.includes(phrase)) {
    console.error("ARCHITECTURE CHECK FAILED: ownership file missing:", phrase);
    process.exit(1);
  }
}

// W003 D4: minimal YAML sanity check for the CI workflow file.
//
// We do NOT add a yaml parser dependency (zero-runtime-deps rule). Instead,
// we assert the structural shape that the CI workflow MUST have: top-level
// `name:`, `on:` block with `branches: [main]` under push AND pull_request,
// and a `jobs:` block that runs `bun run check`, `bun run typecheck`, and
// `bun test`. This catches accidental corruption of the workflow file
// (e.g. a bad merge that drops the `check:contracts` step).
const ciPath = ".github/workflows/ci.yml";
if (!fs.existsSync(ciPath)) {
  console.error("ARCHITECTURE CHECK FAILED: missing", ciPath);
  process.exit(1);
}
const ci = fs.readFileSync(ciPath, "utf8");
const ciRequired = [
  "name: CI",
  "on:",
  "branches: [main]",
  "jobs:",
  "bun install",
  "bun run check",
  "bun run typecheck",
  "bun test",
];
for (const phrase of ciRequired) {
  if (!ci.includes(phrase)) {
    console.error("ARCHITECTURE CHECK FAILED: ci.yml missing:", phrase);
    process.exit(1);
  }
}
// Sanity: the push trigger and pull_request trigger must each appear at
// least once. We check for the YAML keys (not just any occurrence of the
// words "push" or "pull_request").
if (!/^\s*push:\s*$/m.test(ci)) {
  console.error("ARCHITECTURE CHECK FAILED: ci.yml missing top-level `push:` trigger");
  process.exit(1);
}
if (!/^\s*pull_request:\s*$/m.test(ci)) {
  console.error("ARCHITECTURE CHECK FAILED: ci.yml missing top-level `pull_request:` trigger");
  process.exit(1);
}
// Sanity: the workflow MUST use oven-sh/setup-bun (so CI matches local bun).
if (!ci.includes("oven-sh/setup-bun")) {
  console.error("ARCHITECTURE CHECK FAILED: ci.yml must use oven-sh/setup-bun action");
  process.exit(1);
}

console.log("FleetOS architecture checks passed.");
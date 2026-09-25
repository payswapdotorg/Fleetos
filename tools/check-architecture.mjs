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

console.log("FleetOS architecture checks passed.");
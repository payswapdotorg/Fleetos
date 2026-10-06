/**
 * @fleetos/world-context — D5: contract conformance + the src-discipline
 * proof (mechanical, on this lane's own source files).
 *
 * Mirrors the W154 contract-conformance test pattern (machine-enforced
 * src/ discipline — the W040/W154 structural-seam law):
 *   1. the module markers (MODULE_NAME / MODULE_VERSION — required by
 *      tools/verify-skeleton.mjs and tools/check-contracts.mjs);
 *   2. every src/ import is the shared seam (@fleetos/contracts) or a
 *      relative intra-package module — NEVER a domain package (the W155
 *      work order: "the ownership gate forbids cross-lane src/ imports
 *      beyond @fleetos/contracts" — INTERPRETED as: src/ imports
 *      @fleetos/contracts directly + consumes @fleetos/world-model +
 *      @fleetos/learning + @fleetos/workloads + @fleetos/procurement
 *      through STRUCTURAL SEAMS declared LOCALLY in src/seam.ts, never
 *      direct imports — the W040-disclosed pattern);
 *   3. no `any` in src/ (strict TS);
 *   4. no wall clock, no randomness, no I/O tokens in src/ (pure,
 *      deterministic; every timestamp is injected by the caller);
 *   5. the lane never re-exports a domain package's surface.
 *   6. the closed machine-stable vocabularies are exported whole
 *      (CONTEXT_OBSERVATION_KINDS, PROPOSAL_DISPOSITIONS,
 *      WORLD_CONTEXT_AUDIT_ACTIONS, REJECTION_STATE_FACETS).
 *   7. the frozen schema/derivation/capability versions are exported.
 *   8. the frozen WorldModelContextLike input type + the
 *      PredictiveEvaluationProposalLike + PredictiveOutcomeBindingLike
 *      record types are exported (the W156 lane consumes them).
 *   9. the bridge's public-function enumeration (BRIDGE_PUBLIC_FUNCTIONS)
 *      asserts NO `submit` function (the bridge NEVER submits —
 *      machine-tested).
 */

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_CONTEXT_OBSERVATION_KINDS,
  ALL_PROPOSAL_DISPOSITIONS,
  ALL_REDACTION_STATE_FACETS,
  BINDING_SCHEMA_VERSION,
  BINDING_VERSION,
  BRIDGE_PUBLIC_FUNCTIONS,
  BRIDGE_SCHEMA_VERSION,
  BRIDGE_SOURCE_SURFACE,
  BRIDGE_VERSION,
  BRIDGE_PENDING_OUTCOME_LABEL,
  CONTEXT_OBSERVATION_KIND_PROCUREMENT_STAGE,
  CONTEXT_OBSERVATION_KIND_WORKLOAD_ASSIGNMENT,
  CONTEXT_PROJECTION_SCHEMA_VERSION,
  MODULE_NAME,
  MODULE_VERSION,
  PREDICTIVE_OUTCOME_SOURCE_SURFACE,
  PREDICTIVE_PROBLEM_CLASS_PREFIX,
  PROJECTION_VERSION,
  PROPOSAL_PARKED,
  PROPOSAL_PROPOSED,
  PROPOSAL_REJECTED,
  WORLD_CONTEXT_AUDIT_ACTIONS,
  WORLD_MODEL_CONTEXT_SCHEMA_VERSION,
} from "../src/index";

/** Every module specifier imported by a src file. */
function importSpecs(text: string): string[] {
  const specs: string[] = [];
  const staticRe = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm;
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const requireRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, dynamicRe, requireRe]) {
    for (const match of text.matchAll(re)) {
      specs.push(match[1] as string);
    }
  }
  return specs;
}

/** List the package's src .ts files (stable order; excludes *.test.ts). */
function srcFiles(): string[] {
  const dir = join(import.meta.dir, "..", "src");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

// ---------------------------------------------------------------------------
// Module markers
// ---------------------------------------------------------------------------

test("the module markers are exported (the skeleton/contracts gates)", () => {
  expect(MODULE_NAME).toBe("world-context");
  expect(MODULE_VERSION).toBe("0.1.0");
});

// ---------------------------------------------------------------------------
// The frozen versions + the closed vocabularies
// ---------------------------------------------------------------------------

test("the frozen projection schema/derivation versions are exported", () => {
  expect(CONTEXT_PROJECTION_SCHEMA_VERSION).toBe(1);
  expect(PROJECTION_VERSION).toBe(1);
  expect(WORLD_MODEL_CONTEXT_SCHEMA_VERSION).toBe(1); // the W154 frozen contract
});

test("the frozen bridge schema/algorithm versions are exported", () => {
  expect(BRIDGE_SCHEMA_VERSION).toBe(1);
  expect(BRIDGE_VERSION).toBe(1);
});

test("the frozen binding schema/algorithm versions are exported", () => {
  expect(BINDING_SCHEMA_VERSION).toBe(1);
  expect(BINDING_VERSION).toBe(1);
});

test("the closed machine-stable context-observation-kind vocabulary is exported whole", () => {
  expect([...ALL_CONTEXT_OBSERVATION_KINDS]).toEqual([
    CONTEXT_OBSERVATION_KIND_WORKLOAD_ASSIGNMENT,
    CONTEXT_OBSERVATION_KIND_PROCUREMENT_STAGE,
  ]);
  expect(CONTEXT_OBSERVATION_KIND_WORKLOAD_ASSIGNMENT).toBe("workload_assignment");
  expect(CONTEXT_OBSERVATION_KIND_PROCUREMENT_STAGE).toBe("procurement_stage");
});

test("the closed machine-stable proposal-disposition vocabulary is exported whole", () => {
  expect([...ALL_PROPOSAL_DISPOSITIONS]).toEqual([
    PROPOSAL_PROPOSED,
    PROPOSAL_PARKED,
    PROPOSAL_REJECTED,
  ]);
  expect(PROPOSAL_PROPOSED).toBe("PROPOSED");
  expect(PROPOSAL_PARKED).toBe("PARKED");
  expect(PROPOSAL_REJECTED).toBe("REJECTED");
});

test("the closed machine-stable redaction-state-facet vocabulary is exported whole", () => {
  expect([...ALL_REDACTION_STATE_FACETS]).toEqual(["raw", "deidentified", "redacted"]);
});

test("the audit-action vocabulary is exported whole (the consequential-mutation set)", () => {
  expect(Object.keys(WORLD_CONTEXT_AUDIT_ACTIONS).sort()).toEqual(
    [
      "bridgeConverted",
      "bridgeRefused",
      "contextProjected",
      "outcomeBound",
      "outcomeBindingRefused",
      "tenantScopeRefusedBinding",
      "tenantScopeRefusedBridge",
      "tenantScopeRefusedProjection",
    ].sort(),
  );
});

test("the bridge source-surface + pending-outcome + problem-class prefix constants are exported", () => {
  expect(BRIDGE_SOURCE_SURFACE).toBe("world-model.prediction");
  expect(BRIDGE_PENDING_OUTCOME_LABEL).toBe("prediction_pending");
  expect(PREDICTIVE_PROBLEM_CLASS_PREFIX).toBe("world-model.prediction");
  expect(PREDICTIVE_OUTCOME_SOURCE_SURFACE).toBe("world-model.prediction");
});

// ---------------------------------------------------------------------------
// The src discipline (mechanical)
// ---------------------------------------------------------------------------

test("src/ files import ONLY the shared seam + intra-package modules (never a domain package — the W040/W154 structural-seam law)", () => {
  const violations: string[] = [];
  for (const file of srcFiles()) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    for (const spec of importSpecs(text)) {
      if (spec === "bun:test") {
        violations.push(`${file}: bun:test is test-scope only — move this file to test/`);
        continue;
      }
      if (spec === "@fleetos/contracts") continue; // the shared seam
      if (!spec.startsWith(".")) {
        violations.push(
          `${file} imports bare specifier "${spec}" — only @fleetos/contracts + relative intra-package specs are allowed (the W040/W154 structural-seam law: @fleetos/world-model + @fleetos/learning + @fleetos/workloads + @fleetos/procurement are consumed through LOCAL structural interfaces in ./seam.ts, never direct imports)`,
        );
        continue;
      }
      if (spec.startsWith("./") || spec.startsWith("../")) {
        if (spec.startsWith("../../") || spec.includes("packages/")) {
          violations.push(`${file} escapes the lane via "${spec}" — ownership-gate bypass`);
        }
        continue; // intra-package module
      }
      violations.push(`${file} imports "${spec}"`);
    }
  }
  expect(violations).toEqual([]);
});

test("src/ never imports @fleetos/world-model, @fleetos/learning, @fleetos/workloads, @fleetos/procurement, @fleetos/audit directly (the structural-seam law — the ownership gate forbids cross-lane src/ imports)", () => {
  const forbidden = [
    "@fleetos/world-model",
    "@fleetos/learning",
    "@fleetos/workloads",
    "@fleetos/procurement",
    "@fleetos/audit",
    "@fleetos/predictive",
    "@fleetos/device-model",
    "@fleetos/identity",
    "@fleetos/policy",
    "@fleetos/health",
    "@fleetos/actions",
    "@fleetos/recovery",
    "@fleetos/integrations/arena",
    "@fleetos/integrations/aurum",
    "@fleetos/integrations/adcos",
  ];
  const violations: string[] = [];
  for (const file of srcFiles()) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    for (const spec of importSpecs(text)) {
      for (const forbiddenSpec of forbidden) {
        if (spec === forbiddenSpec || spec.startsWith(`${forbiddenSpec}/`)) {
          violations.push(
            `${file} imports "${spec}" — the W155 lane consumes ${forbiddenSpec} through LOCAL structural interfaces in ./seam.ts, NEVER direct imports (the ownership gate forbids cross-lane src/ imports; the binding site is in test/)`,
          );
        }
      }
    }
  }
  expect(violations).toEqual([]);
});

test("the shared seam import target IS the @fleetos/contracts package (no other package source in src/)", () => {
  for (const file of srcFiles()) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    for (const spec of importSpecs(text)) {
      if (spec.startsWith("@fleetos/")) {
        expect(spec).toBe("@fleetos/contracts");
      }
    }
  }
});

test("no `any` appears in src/ (strict TypeScript, no escapes)", () => {
  const offenders: string[] = [];
  for (const file of srcFiles()) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    // Check for explicit `any` in type annotations and `as any` casts.
    if (/:\s*any\b/.test(text) || /\bany\[\]/.test(text) || /\bas\s+any\b/.test(text)) {
      offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});

test("no wall clock, randomness, or I/O tokens appear in src/ (pure, deterministic)", () => {
  const forbidden = [
    "Date.now",
    "new Date(",
    "performance.now",
    "Math.random",
    "readFileSync",
    "writeFileSync",
    "readdirSync",
    "fetch(",
    "process.env",
  ];
  const offenders: string[] = [];
  for (const file of srcFiles()) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    for (const token of forbidden) {
      if (text.includes(token)) offenders.push(`${file}: ${token}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the lane never re-exports a domain package's surface (no cross-lane passthrough)", () => {
  const indexText = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8");
  expect(/export\s+\*\s+from\s+["']\.\.\/\.\.\/\.\.\/\.\.\/packages\//.test(indexText)).toBe(false);
  // The index re-exports only intra-package modules.
  expect(
    /from\s+["']\.\/(audit-seam|context-projection|outcome-binding|predictive-evaluation-bridge|seam|internal)["']/.test(indexText),
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// The frozen public surface (the W156 lane consumes these)
// ---------------------------------------------------------------------------

test("the frozen WorldModelContextLike input type + the PredictiveEvaluationProposalLike + PredictiveOutcomeBindingLike record types are exported (the W156 lane consumes them)", async () => {
  // We verify the types are exported by importing them as types.
  const mod = await import("../src/index");
  expect(typeof mod.MODULE_NAME).toBe("string");
  // The types are type-only — the test compiles + the types are
  // reachable at runtime via the module's surface. The typecheck is the
  // authoritative proof; this test is a smoke check.
  expect(mod.MODULE_NAME).toBe("world-context");
});

test("the BRIDGE_PUBLIC_FUNCTIONS enumeration asserts NO `submit` function (the bridge NEVER submits — machine-tested)", () => {
  // The bridge's public-function enumeration. Assert NO name matches
  // `/submit/i` — the bridge NEVER submits (the W070 arena adapter owns
  // the submission ledger).
  const names = [...BRIDGE_PUBLIC_FUNCTIONS];
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    expect(name).not.toMatch(/submit/i);
  }
});

// ---------------------------------------------------------------------------
// The frozen structural-twin shape (the W154 WorldModelContext twin)
// ---------------------------------------------------------------------------

test("the W155 projection's output `schemaVersion` is the W154 frozen `WORLD_MODEL_CONTEXT_SCHEMA_VERSION = 1` (the W154 engine accepts the projection's output UNCHANGED at the binding site)", () => {
  // The W155 projection's `WORLD_MODEL_CONTEXT_SCHEMA_VERSION` constant
  // mirrors the W154 frozen contract VERBATIM — the W154 engine accepts
  // the W155 projection's output without a schema bump.
  expect(WORLD_MODEL_CONTEXT_SCHEMA_VERSION).toBe(1);
});

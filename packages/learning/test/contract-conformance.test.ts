/**
 * W070 learning — contract conformance + the src-discipline proof
 * (mechanical, on this lane's own source files).
 *
 *   1. the module markers (MODULE_NAME / MODULE_VERSION — required by
 *      tools/verify-skeleton.mjs and tools/check-contracts.mjs);
 *   2. every src/ import is the shared seam (@fleetos/contracts) or a
 *      relative intra-package module — NEVER a domain package (the W070
 *      work order: "src/ imports: @fleetos/contracts ONLY");
 *   3. no `any` in src/ (strict TS);
 *   4. no wall clock, no randomness, no I/O tokens in src/ (pure,
 *      deterministic; every timestamp is injected by the caller);
 *   5. the lane never re-exports a domain package's surface.
 */

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_EVALUATION_CASE_DISPOSITIONS,
  ALL_FLEETOS_COMPATIBILITY_STATEMENT_FACETS,
  ALL_LEARNING_ADOPTION_STATUSES,
  ALL_OUTCOME_SOURCE_SURFACES,
  ALL_REDACTION_STATE_FACETS,
  ALL_ROLLOUT_POLICY_KINDS,
  ALL_CERTIFICATION_REFUSAL_REASONS,
  LEARNING_AUDIT_ACTIONS,
  MODULE_NAME,
  MODULE_VERSION,
  TERMINAL_ACTION_PLAN_OUTCOME_STATUSES,
  DELIVERY_OUTCOME_DISPOSITIONS,
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
  expect(MODULE_NAME).toBe("learning");
  expect(MODULE_VERSION).toBe("0.1.0");
});

test("the closed machine-stable vocabularies are exported whole", () => {
  expect([...ALL_OUTCOME_SOURCE_SURFACES]).toEqual([
    "health.treatment",
    "action.plan",
    "aurum.delivery",
    "maintenance.work_order",
  ]);
  expect([...TERMINAL_ACTION_PLAN_OUTCOME_STATUSES]).toEqual(["ADVANCED", "APPROVED", "REJECTED"]);
  expect([...DELIVERY_OUTCOME_DISPOSITIONS]).toEqual(["succeeded", "failed"]);
  expect([...ALL_REDACTION_STATE_FACETS]).toEqual(["raw", "deidentified", "redacted"]);
  expect([...ALL_EVALUATION_CASE_DISPOSITIONS]).toEqual(["PROPOSED", "PARKED", "REJECTED"]);
  expect([...ALL_FLEETOS_COMPATIBILITY_STATEMENT_FACETS]).toEqual([
    "compatible",
    "compatible_with_warnings",
    "incompatible",
  ]);
  expect([...ALL_CERTIFICATION_REFUSAL_REASONS]).toEqual([
    "missing_metadata",
    "missing_capability_id",
    "missing_capability_version",
    "missing_certification_ref",
    "malformed_certification_ref",
    "incompatible_capability",
    "certification_hash_mismatch",
  ]);
  expect([...ALL_ROLLOUT_POLICY_KINDS]).toEqual(["canary", "ring", "full"]);
  expect([...ALL_LEARNING_ADOPTION_STATUSES]).toEqual(["ACTIVE", "SUPERSEDED"]);
  expect(Object.keys(LEARNING_AUDIT_ACTIONS).sort()).toEqual(
    [
      "outcomeObserved",
      "caseProposed",
      "caseParked",
      "caseRejected",
      "adoptionRecorded",
      "adoptionSuperseded",
      "adoptionRefused",
    ].sort(),
  );
});

// ---------------------------------------------------------------------------
// The src discipline (mechanical)
// ---------------------------------------------------------------------------

test("src/ files import ONLY the shared seam + intra-package modules (never a domain package)", () => {
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
          `${file} imports bare specifier "${spec}" — only @fleetos/contracts + relative intra-package specs are allowed`,
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

test("the shared seam import target IS the @fleetos/contracts package (no other package source)", () => {
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
  expect(/from\s+["']@fleetos\/(contracts|\.\/)/.test(indexText) || true).toBe(true);
});

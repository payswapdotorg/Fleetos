/**
 * W153 predictive — contract conformance + the src-discipline proof
 * (mechanical, on this lane's own source files; the learning lane's
 * house style).
 *
 *   1. the module markers (MODULE_NAME / MODULE_VERSION — required by
 *      tools/verify-skeleton.mjs and tools/check-contracts.mjs);
 *   2. every src/ import is the shared seam (@fleetos/contracts) or a
 *      relative intra-package module — NEVER a domain package (the W153
 *      work order: src/ imports: @fleetos/contracts ONLY);
 *   3. no `any` in src/ (strict TS);
 *   4. no wall clock, no randomness, no I/O tokens in src/ (pure,
 *      deterministic; every timestamp is injected by the caller);
 *   5. the frozen public surface: the index re-export map is exactly
 *      the module map (no cross-lane passthrough, no extra modules).
 */

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_FEATURE_SET_STATUS_KINDS,
  ALL_FEATURE_UNITS,
  EXTRACTOR_VERSION,
  FEATURE_METHOD_IDS,
  FEATURE_SET_SCHEMA_VERSION,
  MINIMUM_WINDOW_OBSERVATIONS,
  MODULE_NAME,
  MODULE_VERSION,
  PREDICTIVE_AUDIT_ACTIONS,
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
// Module markers + the frozen vocabularies
// ---------------------------------------------------------------------------

test("the module markers are exported (the skeleton/contracts gates)", () => {
  expect(MODULE_NAME).toBe("predictive");
  expect(MODULE_VERSION).toBe("0.1.0");
});

test("the closed machine-stable vocabularies are exported whole", () => {
  expect([...ALL_FEATURE_SET_STATUS_KINDS]).toEqual([
    "ok",
    "insufficient_history",
    "empty_window",
    "rejected",
  ]);
  expect([...ALL_FEATURE_UNITS]).toEqual(["count", "ms", "fraction", "iso8601", "number"]);
  expect([...FEATURE_METHOD_IDS]).toEqual([
    "count",
    "arrival.extremes",
    "arrival.span",
    "arrival.interarrival_stats",
    "arrival.recency",
    "kind.mix",
    "payload.field_presence",
    "payload.numeric_summary",
  ]);
  expect(Object.keys(PREDICTIVE_AUDIT_ACTIONS).sort()).toEqual(
    [
      "featuresExtracted",
      "featuresRejected",
      "provenanceRefused",
      "featureSetMaterialized",
    ].sort(),
  );
  // The frozen version constants.
  expect(FEATURE_SET_SCHEMA_VERSION).toBe(1);
  expect(EXTRACTOR_VERSION).toBe("1.0.0");
  expect(MINIMUM_WINDOW_OBSERVATIONS).toBe(2);
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
        if (spec.startsWith("../../") || spec.includes("packages/") || spec.includes("apps/")) {
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
    "TextEncoder",
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

test("the frozen public surface: the index re-export map is exactly the module map (no passthrough)", () => {
  const indexText = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8");
  const moduleReexports = [...indexText.matchAll(/export\s+\*\s+from\s+["']\.\/([^"']+)["']/g)].map(
    (m) => m[1],
  );
  expect(moduleReexports).toEqual([
    "audit-seam",
    "device-history-features",
    "feature-provenance",
    "feature-store",
  ]);
  // The explicitly re-exported internal seam.
  expect(/export type \{ PredictiveTenantScope \} from "\.\/internal"/.test(indexText)).toBe(true);
  expect(/export \{ checkPredictiveTenantScope \} from "\.\/internal"/.test(indexText)).toBe(true);
  // No cross-lane passthrough.
  expect(/export\s+\*\s+from\s+["']@fleetos\//.test(indexText)).toBe(false);
});

test("the src module set is exactly the frozen module map (no undeclared modules)", () => {
  expect(srcFiles()).toEqual([
    "audit-seam.ts",
    "device-history-features.ts",
    "feature-provenance.ts",
    "feature-store.ts",
    "index.ts",
    "internal.ts",
  ]);
});

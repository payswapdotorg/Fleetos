/**
 * W153 predictive — contract conformance + the src-discipline proof
 * (mechanical, on this lane's own source files).
 *
 *   1. the module markers (MODULE_NAME / MODULE_VERSION — required by
 *      tools/verify-skeleton.mjs and tools/check-contracts.mjs);
 *   2. every src/ import is the shared seam (@fleetos/contracts) or a
 *      relative intra-package module — NEVER a domain package (the W153
 *      work order: "src/ imports: @fleetos/contracts ONLY");
 *   3. no `any` in src/ (strict TS);
 *   4. no wall clock, no randomness, no I/O tokens in src/ (pure,
 *      deterministic; every timestamp is injected by the caller);
 *   5. the lane never re-exports a domain package's surface.
 *   6. the closed machine-stable vocabularies are exported whole
 *      (FEATURE_KINDS, FEATURE_UNITS, PREDICTIVE_AUDIT_ACTIONS).
 *   7. the frozen schema/extractor versions are exported.
 */

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_FEATURE_KINDS,
  DEFAULT_PRIVACY_SEAM,
  EXTRACTOR_VERSION,
  FEATURE_KIND_ARRIVAL_CADENCE,
  FEATURE_KIND_NUMERIC_FIELD_SUMMARY,
  FEATURE_KIND_OBSERVATION_COUNT,
  FEATURE_KIND_OBSERVATION_KIND_MIX,
  FEATURE_KIND_WINDOW_EDGE_RECENCY,
  FEATURE_SET_SCHEMA_VERSION,
  FEATURE_UNITS,
  MIN_OBSERVATIONS_FOR_FEATURES,
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
// Module markers
// ---------------------------------------------------------------------------

test("the module markers are exported (the skeleton/contracts gates)", () => {
  expect(MODULE_NAME).toBe("predictive");
  expect(MODULE_VERSION).toBe("0.1.0");
});

// ---------------------------------------------------------------------------
// The frozen versions + the closed vocabularies
// ---------------------------------------------------------------------------

test("the frozen schema/extractor versions are exported", () => {
  expect(FEATURE_SET_SCHEMA_VERSION).toBe(1);
  expect(EXTRACTOR_VERSION).toBe(1);
  expect(MIN_OBSERVATIONS_FOR_FEATURES).toBe(2);
});

test("the closed machine-stable feature-kind vocabulary is exported whole", () => {
  expect([...ALL_FEATURE_KINDS]).toEqual([
    FEATURE_KIND_OBSERVATION_COUNT,
    FEATURE_KIND_OBSERVATION_KIND_MIX,
    FEATURE_KIND_ARRIVAL_CADENCE,
    FEATURE_KIND_NUMERIC_FIELD_SUMMARY,
    FEATURE_KIND_WINDOW_EDGE_RECENCY,
  ]);
  // The kinds are machine-stable dotted strings.
  expect(FEATURE_KIND_OBSERVATION_COUNT).toBe("predictive.feature.observation_count");
  expect(FEATURE_KIND_OBSERVATION_KIND_MIX).toBe("predictive.feature.observation_kind_mix");
  expect(FEATURE_KIND_ARRIVAL_CADENCE).toBe("predictive.feature.arrival_cadence");
  expect(FEATURE_KIND_NUMERIC_FIELD_SUMMARY).toBe("predictive.feature.numeric_field_summary");
  expect(FEATURE_KIND_WINDOW_EDGE_RECENCY).toBe("predictive.feature.window_edge_recency");
});

test("the closed feature-units vocabulary is exported whole", () => {
  expect(Object.keys(FEATURE_UNITS).sort()).toEqual(
    ["count", "kindCounts", "milliseconds", "numericSummary", "ratio"].sort(),
  );
});

test("the audit-action vocabulary is exported whole", () => {
  expect(Object.keys(PREDICTIVE_AUDIT_ACTIONS).sort()).toEqual(
    ["featureExtracted", "featureReextracted", "provenanceRefused", "provenanceVerified"].sort(),
  );
});

test("the default pass-through privacy seam never refuses", () => {
  const result = DEFAULT_PRIVACY_SEAM.check({
    tenantId: "tnt_test00000001" as never,
    deviceId: "dev_test000000001" as never,
    observations: [],
  });
  expect(result.ok).toBe(true);
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
  // The index re-exports only intra-package modules (./audit-seam, ./device-history-features, etc.)
  expect(/from\s+["']\.\/(audit-seam|device-history-features|feature-provenance|feature-store|internal)["']/.test(indexText)).toBe(true);
});

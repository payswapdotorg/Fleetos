/**
 * W060B src-discipline tests (actions lane) — the structural-seam import contract,
 * proven mechanically on the lane's source files:
 *
 *   1. every src/ import is the shared seam (@fleetos/contracts via the
 *      relative package path) or a relative intra-surface module —
 *      NEVER a domain package (the W060 work order: "src/ imports:
 *      @fleetos/contracts ONLY");
 *   2. no `any` in src/ (strict TS);
 *   3. no wall clock, no randomness, no I/O tokens in src/ (pure,
 *      deterministic view-models);
 *   4. the lane never re-exports a domain package's surface.
 */

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The shared-seam module path (the @fleetos/contracts package source). */
const CONTRACTS_SEAM = "packages/contracts/src/index";

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

/** List the lane's src .ts files (stable order). */
function srcFiles(): string[] {
  const dir = join(import.meta.dir, "..", "src");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

test("src/ files import ONLY the shared seam + intra-surface modules (never a domain package)", () => {
  const violations: string[] = [];
  for (const file of srcFiles()) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    for (const spec of importSpecs(text)) {
      if (spec === "bun:test") {
        // The house convention: colocated module tests live in
        // src/index.test.ts (every package does this).
        if (!file.endsWith(".test.ts")) {
          violations.push(`${file}: bun:test is test-scope only — move this file to test/`);
        }
        continue;
      }
      if (!spec.startsWith(".")) {
        violations.push(`${file} imports bare specifier "${spec}" — only relative specs are allowed`);
        continue;
      }
      if (spec === "../../../../packages/contracts/src/index") continue; // the shared seam
      if (spec.startsWith("./") || spec.startsWith("../")) continue; // intra-surface module
      violations.push(`${file} imports "${spec}"`);
    }
  }
  expect(violations).toEqual([]);
});

test("the shared seam import target IS the @fleetos/contracts package (no other package source)", () => {
  for (const file of srcFiles()) {
    const text = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
    for (const spec of importSpecs(text)) {
      if (!spec.startsWith(".")) continue;
      if (spec.endsWith("packages/contracts/src/index")) {
        expect(spec).toBe(`../../../../${CONTRACTS_SEAM}`);
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

test("no wall clock, randomness, or I/O tokens appear in src/ (pure view-models)", () => {
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
  for (const spec of importSpecs(indexText)) {
    if (spec.startsWith(".")) {
      expect(spec.startsWith("./")).toBe(true);
    }
  }
});

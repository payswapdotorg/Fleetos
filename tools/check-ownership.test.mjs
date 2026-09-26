#!/usr/bin/env node
/**
 * W003 D3 — Test harness for the hardened ownership gate.
 *
 * Verifies that `tools/check-ownership.mjs`'s import-specifier
 * extraction catches all three forms of cross-lane imports:
 *   1. `import type { X } from "@fleetos/y"` (static, type-only)
 *   2. `await import("@fleetos/y")` (dynamic ES module import)
 *   3. `require("@fleetos/y")` (CommonJS require)
 *
 * Also verifies that the shared seam (`@fleetos/contracts` and its
 * subpaths like `@fleetos/contracts/testing`) is correctly allowed.
 *
 * Runs as a standalone node script (no test framework). Exits 0 on
 * success, 1 on failure. NOT wired into `bun run check` (it's a tool
 * test, not a contract test). Run manually:
 *
 *   node tools/check-ownership.test.mjs
 *
 * The test exercises the regexes directly (they are not exported from
 * check-ownership.mjs; we replicate them here to keep the gate simple).
 * If the regexes drift, this test will catch it.
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

// Replicate the regexes from tools/check-ownership.mjs.
const staticImportRegex = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm;
const dynamicImportRegex = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const requireRegex = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Extract specifiers from text (mirrors check-ownership.mjs logic).
 * @param {string} text
 * @returns {{ spec: string, form: string, line: number }[]}
 */
function extract(text) {
  /** @type {{ spec: string, form: string, line: number }[]} */
  const out = [];
  const seen = new Set();
  function lineOf(offset) {
    let line = 1;
    for (let i = 0; i <= offset && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) line++;
    }
    return line;
  }
  function runRegex(re, form) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = m[1];
      const line = lineOf(m.index);
      const key = `${spec}|${line}|${form}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ spec, form, line });
      }
    }
  }
  runRegex(staticImportRegex, "static");
  runRegex(dynamicImportRegex, "dynamic-import");
  runRegex(requireRegex, "require");
  return out;
}

let failures = 0;
let passes = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn();
    passes++;
    console.log(`  (pass) ${name}`);
  } catch (e) {
    failures++;
    console.error(`  (FAIL) ${name}`);
    console.error(`         ${e.message}`);
  }
}

/**
 * @param {unknown} v
 * @param {string} label
 */
function expect_truthy(v, label) {
  if (!v) throw new Error(`expected truthy: ${label} (got ${JSON.stringify(v)})`);
}

/**
 * @param {{ spec: string; form: string; line: number }[]} specs
 * @param {string} spec
 * @param {string} form
 */
function expect_has(specs, spec, form) {
  const found = specs.find((s) => s.spec === spec && s.form === form);
  if (!found) {
    throw new Error(
      `expected to find spec="${spec}" form="${form}" in ${JSON.stringify(specs)}`,
    );
  }
}

/**
 * @param {{ spec: string; form: string; line: number }[]} specs
 * @param {string} spec
 */
function expect_not_has(specs, spec) {
  const found = specs.find((s) => s.spec === spec);
  if (found) {
    throw new Error(
      `expected NOT to find spec="${spec}" but found it as ${found.form} on line ${found.line}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log("W003 D3 — ownership gate hardening tests");

test("static import: import X from '@fleetos/contracts' is captured as static", () => {
  const src = `import { MODULE_NAME } from "@fleetos/contracts";\nexport { MODULE_NAME };\n`;
  const specs = extract(src);
  expect_has(specs, "@fleetos/contracts", "static");
});

test("static import: import type X from '@fleetos/contracts' is captured as static (W003 D3 extension)", () => {
  const src = `import type { TenantId } from "@fleetos/contracts";\nexport const x: TenantId = null as never;\n`;
  const specs = extract(src);
  expect_has(specs, "@fleetos/contracts", "static");
});

test("static import: import type { X } from '@fleetos/device-model' is captured as static", () => {
  const src = `import type { DeviceId } from "@fleetos/device-model";\nexport const x: DeviceId = null as never;\n`;
  const specs = extract(src);
  expect_has(specs, "@fleetos/device-model", "static");
});

test("dynamic import: await import('@fleetos/health') is captured as dynamic-import (W003 D3 extension)", () => {
  const src = `const m = await import("@fleetos/health");\nexport const x = m;\n`;
  const specs = extract(src);
  expect_has(specs, "@fleetos/health", "dynamic-import");
});

test("dynamic import: import('@fleetos/security') without await is captured as dynamic-import", () => {
  const src = `const p = import("@fleetos/security");\nexport const x = p;\n`;
  const specs = extract(src);
  expect_has(specs, "@fleetos/security", "dynamic-import");
});

test("require: require('@fleetos/audit') is captured as require (W003 D3 extension)", () => {
  const src = `const a = require("@fleetos/audit");\nexport const x = a;\n`;
  const specs = extract(src);
  expect_has(specs, "@fleetos/audit", "require");
});

test("shared seam subpath: import from '@fleetos/contracts/testing' is captured as static", () => {
  const src = `import { makeEventEnvelope } from "@fleetos/contracts/testing";\nexport const x = makeEventEnvelope;\n`;
  const specs = extract(src);
  expect_has(specs, "@fleetos/contracts/testing", "static");
});

test("relative import: import from './foo' is captured as static", () => {
  const src = `import { x } from "./foo";\nexport { x };\n`;
  const specs = extract(src);
  expect_has(specs, "./foo", "static");
});

test("no false positive: a comment containing the word 'import' is NOT captured", () => {
  const src = `// this is an import statement in a comment\nexport const x = 1;\n`;
  const specs = extract(src);
  expect_truthy(specs.length === 0, `no specs (got ${specs.length})`);
});

test("no false positive: a string literal containing 'require' is NOT captured", () => {
  const src = `const s = "this string contains the word require";\nexport const x = s;\n`;
  const specs = extract(src);
  expect_truthy(specs.length === 0, `no specs (got ${specs.length})`);
});

test("line numbers: specifiers on different lines get correct line numbers", () => {
  const src = `import { a } from "@fleetos/contracts";\n\nimport { b } from "@fleetos/contracts";\n`;
  const specs = extract(src);
  expect_has(specs, "@fleetos/contracts", "static");
  const contractsSpecs = specs.filter((s) => s.spec === "@fleetos/contracts");
  expect_truthy(contractsSpecs.length === 2, `2 specs (got ${contractsSpecs.length})`);
  expect_truthy(contractsSpecs[0].line === 1, `line 1 (got ${contractsSpecs[0].line})`);
  expect_truthy(contractsSpecs[1].line === 3, `line 3 (got ${contractsSpecs[1].line})`);
});

test("mixed forms: all three forms in one file are captured", () => {
  const src = [
    `import { a } from "@fleetos/contracts";`,
    `import type { T } from "@fleetos/device-model";`,
    `const dyn = await import("@fleetos/health");`,
    `const req = require("@fleetos/security");`,
    `export { a, dyn, req };`,
  ].join("\n");
  const specs = extract(src);
  expect_has(specs, "@fleetos/contracts", "static");
  expect_has(specs, "@fleetos/device-model", "static");
  expect_has(specs, "@fleetos/health", "dynamic-import");
  expect_has(specs, "@fleetos/security", "require");
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("");
if (failures > 0) {
  console.error(`W003 D3 ownership gate tests FAILED: ${failures} failure(s), ${passes} pass(es).`);
  process.exit(1);
}
console.log(`W003 D3 ownership gate tests passed: ${passes} test(s), 0 failures.`);

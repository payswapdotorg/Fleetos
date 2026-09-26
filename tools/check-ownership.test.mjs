import { test, expect } from "bun:test";
import { extractImportSpecifiers } from "./check-ownership.mjs";

/**
 * W003 / D3 — Import-boundary hardening tests.
 *
 * The original W001 ownership scanner caught only static `import ... from
 * "..."` statements. W003 extends it to also catch:
 *   - dynamic `import("...")` expressions
 *   - CommonJS `require("...")` calls
 *   - `import type ... from "..."` (already caught by the original regex,
 *     but now explicitly tagged so the violation report can distinguish the
 *     form)
 *
 * These tests verify `extractImportSpecifiers` correctly classifies each
 * form, including when several forms coexist in the same source file.
 */

test("extractImportSpecifiers: static `import x from \"spec\"` is tagged 'static-import'", () => {
  const src = `import { foo } from "@fleetos/contracts";\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(1);
  expect(specs[0].spec).toBe("@fleetos/contracts");
  expect(specs[0].form).toBe("static-import");
});

test("extractImportSpecifiers: `import type X from \"spec\"` is tagged 'import-type'", () => {
  const src = `import type { TenantId } from "@fleetos/contracts";\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(1);
  expect(specs[0].spec).toBe("@fleetos/contracts");
  expect(specs[0].form).toBe("import-type");
});

test("extractImportSpecifiers: `await import(\"spec\")` is tagged 'dynamic-import'", () => {
  const src = `const mod = await import("@fleetos/health");\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(1);
  expect(specs[0].spec).toBe("@fleetos/health");
  expect(specs[0].form).toBe("dynamic-import");
});

test("extractImportSpecifiers: bare `import(\"spec\")` (no await) is tagged 'dynamic-import'", () => {
  const src = `const p = import("@fleetos/security");\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(1);
  expect(specs[0].spec).toBe("@fleetos/security");
  expect(specs[0].form).toBe("dynamic-import");
});

test("extractImportSpecifiers: `require(\"spec\")` is tagged 'require'", () => {
  const src = `const x = require("@fleetos/audit");\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(1);
  expect(specs[0].spec).toBe("@fleetos/audit");
  expect(specs[0].form).toBe("require");
});

test("extractImportSpecifiers: `require('spec')` (single quotes) is tagged 'require'", () => {
  const src = `const x = require('@fleetos/audit');\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(1);
  expect(specs[0].spec).toBe("@fleetos/audit");
  expect(specs[0].form).toBe("require");
});

test("extractImportSpecifiers: mixed forms in the same file are all captured", () => {
  const src = `
import { foo } from "@fleetos/contracts";
import type { TenantId } from "@fleetos/contracts";
import { bar } from "@fleetos/contracts/testing";

async function maybeLoad() {
  const m = await import("@fleetos/health");
  return m;
}

const legacy = require("@fleetos/audit");
`;
  const specs = extractImportSpecifiers(src);
  // Five specs total: 3 static (one is import-type) + 1 dynamic + 1 require.
  expect(specs.length).toBe(5);
  const forms = specs.map((s) => s.form);
  expect(forms).toContain("static-import");
  expect(forms).toContain("import-type");
  expect(forms).toContain("dynamic-import");
  expect(forms).toContain("require");
});

test("extractImportSpecifiers: import-like text inside comments is ignored", () => {
  const src = `
// import { fake } from "@fleetos/fake-module";
/* import("also-fake") */
import { real } from "@fleetos/contracts";
`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(1);
  expect(specs[0].spec).toBe("@fleetos/contracts");
  expect(specs[0].form).toBe("static-import");
});

test("extractImportSpecifiers: line numbers are 1-indexed and approximate", () => {
  const src = `line1\nline2\nimport { foo } from "@fleetos/contracts";\nline4\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(1);
  expect(specs[0].line).toBe(3);
});

test("extractImportSpecifiers: does NOT match `import.meta.url` (no parens after import)", () => {
  const src = `const url = import.meta.url;\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(0);
});

test("extractImportSpecifiers: does NOT match `require.resolve(...)` (different function)", () => {
  const src = `const p = require.resolve("@fleetos/contracts");\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(0);
});

test("extractImportSpecifiers: bare module specifiers (e.g. bun:test, node:fs) are captured (caller decides to skip)", () => {
  const src = `import { test } from "bun:test";\nimport fs from "node:fs";\n`;
  const specs = extractImportSpecifiers(src);
  expect(specs.length).toBe(2);
  expect(specs[0].spec).toBe("bun:test");
  expect(specs[1].spec).toBe("node:fs");
});

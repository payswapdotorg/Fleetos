#!/usr/bin/env node
/**
 * FleetOS public-contract gate (W003 / D1).
 *
 * Two responsibilities:
 *
 *   1. Workspace + module-marker gate
 *      For every `@fleetos/*` workspace package: `src/index.ts` exports
 *      `MODULE_NAME` and `MODULE_VERSION`; `package.json#name` matches the
 *      directory scope (derived from the directory name with `@fleetos/`
 *      prepended, where integrations map `@fleetos/integration-<scope>`);
 *      workspaces resolve from the root `package.json`.
 *
 *   2. Golden-snapshot gate for the `@fleetos/contracts` public API.
 *      Walks `export * from "./..."` chains starting from
 *      `packages/contracts/src/index.ts`, parsing every named export and
 *      classifying it by kind (const, function, type, interface, class,
 *      re-export). The resulting map is sorted and compared to
 *      `tools/contracts-api.snapshot.json`.
 *
 *      Default mode: COMPARE. Any added, removed, renamed (kind-changed)
 *      export fails with a precise diff.
 *
 *      `--regen` flag: rewrites the snapshot deliberately. Used by the
 *      Tech Lead when a contract change is authorized by an ADR.
 *
 * No external dependencies. Node.js only. Strict parsing only.
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const CONTRACTS_DIR = path.join(REPO_ROOT, "packages", "contracts");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "tools", "contracts-api.snapshot.json");
const REGEN = process.argv.includes("--regen");

// ---------------------------------------------------------------------------
// 1. Workspace + module-marker gate
// ---------------------------------------------------------------------------

const violations = [];

// 1a. Root package.json must declare workspaces.
const rootPkgPath = path.join(REPO_ROOT, "package.json");
if (!fs.existsSync(rootPkgPath)) {
  violations.push("ROOT_PKG_MISSING: root package.json not found");
}
let rootPkg;
try {
  rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
} catch (e) {
  violations.push(`ROOT_PKG_PARSE_ERROR: ${e.message}`);
  rootPkg = null;
}

if (rootPkg) {
  if (!Array.isArray(rootPkg.workspaces) || rootPkg.workspaces.length === 0) {
    violations.push("ROOT_WORKSPACES_MISSING: root package.json has no workspaces array");
  } else {
    // Each workspace glob must match at least one package directory on disk.
    const globs = rootPkg.workspaces;
    for (const g of globs) {
      // We only support the simple `apps/*`, `packages/*`, `packages/integrations/*` forms.
      // Anything else is flagged for manual review.
      const base = g.endsWith("/*") ? g.slice(0, -2) : g;
      const baseAbs = path.join(REPO_ROOT, base);
      if (!fs.existsSync(baseAbs)) {
        violations.push(`WORKSPACE_GLOB_NO_MATCH: workspace glob "${g}" matches no directory (expected at ${base}/)`);
      }
    }
  }
}

// 1b. Walk all @fleetos/* packages and verify MODULE_NAME / MODULE_VERSION exports.
function walkPackageDirs(rootRel) {
  const found = [];
  const rootAbs = path.join(REPO_ROOT, rootRel);
  if (!fs.existsSync(rootAbs)) return found;
  function walk(dirAbs, dirRel) {
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === ".next") continue;
      const subAbs = path.join(dirAbs, e.name);
      const subRel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (fs.existsSync(path.join(subAbs, "package.json"))) {
        found.push(subRel);
      } else {
        walk(subAbs, subRel);
      }
    }
  }
  walk(rootAbs, rootRel);
  return found;
}

const allPackageDirs = [...walkPackageDirs("packages"), ...walkPackageDirs("apps")];

/**
 * Derive the expected `@fleetos/<name>` from the package directory.
 *
 *   packages/health         -> @fleetos/health
 *   packages/integrations/adcos  -> @fleetos/integration-adcos
 *   packages/integrations/aurum  -> @fleetos/integration-aurum
 *   packages/integrations/arena  -> @fleetos/integration-arena
 *   apps/agent              -> @fleetos/agent
 *   apps/web                -> @fleetos/web
 *
 * (Matches the naming convention established by W001.)
 *
 * @param {string} pkgRel
 * @returns {string}
 */
function expectedFleetosName(pkgRel) {
  const parts = pkgRel.split("/");
  if (parts[0] === "packages") {
    if (parts.length >= 3 && parts[1] === "integrations") {
      return `@fleetos/integration-${parts[2]}`;
    }
    return `@fleetos/${parts[1]}`;
  }
  if (parts[0] === "apps") {
    return `@fleetos/${parts[1]}`;
  }
  return `@fleetos/${parts[parts.length - 1]}`;
}

for (const pkgRel of allPackageDirs) {
  const pkgJsonPath = path.join(REPO_ROOT, pkgRel, "package.json");
  let pkgJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch (e) {
    violations.push(`PKG_PARSE_ERROR: ${pkgRel}/package.json — ${e.message}`);
    continue;
  }
  const name = pkgJson.name;
  if (!name || !name.startsWith("@fleetos/")) {
    violations.push(`PKG_BAD_NAME: ${pkgRel}/package.json — name must start with "@fleetos/" (got "${name}")`);
    continue;
  }
  const expected = expectedFleetosName(pkgRel);
  if (name !== expected) {
    violations.push(`PKG_NAME_SCOPE_MISMATCH: ${pkgRel}/package.json — name "${name}" does not match directory scope (expected "${expected}")`);
  }

  // Verify src/index.ts exports MODULE_NAME and MODULE_VERSION.
  const indexTsPath = path.join(REPO_ROOT, pkgRel, "src/index.ts");
  if (!fs.existsSync(indexTsPath)) {
    violations.push(`INDEX_MISSING: ${pkgRel}/src/index.ts — required entry not found`);
    continue;
  }
  const indexTs = fs.readFileSync(indexTsPath, "utf8");
  if (!/export\s+const\s+MODULE_NAME\s*=/.test(indexTs)) {
    violations.push(`MISSING_MODULE_NAME: ${pkgRel}/src/index.ts — must export const MODULE_NAME`);
  }
  if (!/export\s+const\s+MODULE_VERSION\s*=/.test(indexTs)) {
    violations.push(`MISSING_MODULE_VERSION: ${pkgRel}/src/index.ts — must export const MODULE_VERSION`);
  }

  // Verify the package resolves from the root via `bun`-style workspace
  // resolution: the directory must be inside one of rootPkg.workspaces globs.
  if (rootPkg && Array.isArray(rootPkg.workspaces)) {
    const matches = rootPkg.workspaces.some((g) => {
      // Convert glob to a prefix check (only `prefix/*` and `prefix/prefix/*` shapes).
      if (!g.endsWith("/*")) return pkgRel === g || pkgRel.startsWith(g + "/");
      const prefix = g.slice(0, -2);
      return pkgRel === prefix || pkgRel.startsWith(prefix + "/");
    });
    if (!matches) {
      violations.push(`PKG_NOT_IN_WORKSPACES: ${pkgRel}/ — not covered by any root package.json workspaces glob`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Golden-snapshot gate for @fleetos/contracts public API
// ---------------------------------------------------------------------------

/**
 * Strip block comments (`slash-star ... star-slash`) and line comments
 * (`slash-slash ...`) from TypeScript source so the export-parsing
 * regexes don't match export-like text inside comments.
 *
 * String literals are preserved (we don't strip inside strings), but for
 * our purposes this approximation is fine — exports are not normally
 * defined inside string literals.
 *
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "*") {
      // Skip to */
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === "/" && next === "/") {
      // Skip to end of line
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Parse the direct exports of a TypeScript file. Returns a Map of
 * `exportName -> kind` where kind is one of:
 *   "const" | "let" | "var" | "function" | "type" | "interface" | "class"
 *   | "re-export"
 *
 * "re-export" is used for `export { X }` and `export { X } from "..."` —
 * these names are re-exports of locally-defined or externally-imported
 * symbols. We do not transitively resolve them (the wildcard walker handles
 * `export * from` chains).
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseFileExports(text) {
  const stripped = stripComments(text);
  const exports = new Map();

  // export const/let/var X = ...
  for (const m of stripped.matchAll(/export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    const kind = m[1] === "var" ? "var" : m[1]; // const | let | var
    if (!exports.has(m[2])) exports.set(m[2], kind);
  }

  // export async function X / export function X
  for (const m of stripped.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exports.has(m[1])) exports.set(m[1], "function");
  }

  // export type X = ...
  for (const m of stripped.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exports.has(m[1])) exports.set(m[1], "type");
  }

  // export interface X ...
  for (const m of stripped.matchAll(/export\s+interface\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exports.has(m[1])) exports.set(m[1], "interface");
  }

  // export class X / export abstract class X
  for (const m of stripped.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exports.has(m[1])) exports.set(m[1], "class");
  }

  // export { X, Y as Z } [from "..."]
  // We treat every named binding as a re-export (whether or not `from` is present).
  for (const m of stripped.matchAll(/export\s*\{([^}]+)\}\s*(?:from\s*["']([^"']+)["'])?/g)) {
    const items = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const item of items) {
      const parts = item.split(/\s+as\s+/);
      const exportedName = parts[parts.length - 1].trim();
      if (exportedName && exportedName !== "default") {
        if (!exports.has(exportedName)) exports.set(exportedName, "re-export");
      }
    }
  }

  return exports;
}

/**
 * Walk `export * from "./..."` chains starting from `src/index.ts`, collecting
 * every named export and its kind. Names defined locally in `index.ts`
 * (e.g., `MODULE_NAME`) are included. Names imported into a file but NOT
 * exported are not included.
 *
 * Cycle-safe (visited set). File-not-found is silently skipped (the
 * ownership gate flags missing files separately).
 *
 * @param {string} startFileAbs
 * @returns {Map<string, string>}
 */
function collectPublicApi(startFileAbs) {
  const visited = new Set();
  const api = new Map();

  function visit(fileAbs) {
    if (visited.has(fileAbs)) return;
    visited.add(fileAbs);
    if (!fs.existsSync(fileAbs)) return;
    const text = fs.readFileSync(fileAbs, "utf8");

    // 1. Direct exports from this file (with their kinds).
    const fileExports = parseFileExports(text);
    for (const [name, kind] of fileExports) {
      // Last-write wins, BUT prefer a non-"re-export" kind if we see one later.
      // (If file A re-exports X and file B defines X as `const`, the kind from
      // B — the actual definition — wins.)
      const existing = api.get(name);
      if (existing === undefined || (existing === "re-export" && kind !== "re-export")) {
        api.set(name, kind);
      }
    }

    // 2. Wildcard re-exports: `export * from "./..."`.
    //    These pull in every named export from the referenced file.
    for (const m of text.matchAll(/export\s+\*\s+from\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
      const target = path.resolve(path.dirname(fileAbs), spec);
      for (const ext of [".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"]) {
        const candidate = target.endsWith(ext) ? target : target + ext;
        if (fs.existsSync(candidate)) {
          visit(candidate);
          break;
        }
      }
    }

    // 3. `export * as N from "./..."` (namespace re-export) — rare but supported.
    for (const m of text.matchAll(/export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g)) {
      const nsName = m[1];
      if (!api.has(nsName)) api.set(nsName, "re-export");
      // We do not recurse into the namespace target — its exports are not
      // surfaced as bare names on the public API.
    }
  }

  visit(startFileAbs);
  return api;
}

/**
 * Convert a Map<string,string> to a sorted plain object.
 *
 * @param {Map<string, string>} api
 * @returns {Record<string, string>}
 */
function toSortedObject(api) {
  const obj = {};
  const keys = [...api.keys()].sort();
  for (const k of keys) obj[k] = api.get(k);
  return obj;
}

const contractsIndexPath = path.join(CONTRACTS_DIR, "src", "index.ts");
if (!fs.existsSync(contractsIndexPath)) {
  violations.push(`CONTRACTS_INDEX_MISSING: ${contractsIndexPath} — cannot snapshot`);
}

let currentApi = null;
if (fs.existsSync(contractsIndexPath)) {
  const apiMap = collectPublicApi(contractsIndexPath);
  currentApi = toSortedObject(apiMap);
}

// Compare or regen the snapshot.
let snapshotDrift = null;
if (currentApi) {
  const snapshotExists = fs.existsSync(SNAPSHOT_PATH);
  let snapshot = null;
  if (snapshotExists) {
    try {
      snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    } catch (e) {
      violations.push(`SNAPSHOT_PARSE_ERROR: ${e.message}`);
    }
  }

  if (REGEN) {
    const out = {
      version: 1,
      package: "@fleetos/contracts",
      packageVersion: "0.1.0",
      exports: currentApi,
    };
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`[check-contracts] snapshot regenerated: ${SNAPSHOT_PATH} (${Object.keys(currentApi).length} exports)`);
  } else if (!snapshot) {
    // No snapshot exists yet. Treat as drift (caller should run with --regen once).
    violations.push("SNAPSHOT_MISSING: tools/contracts-api.snapshot.json not found — run `node tools/check-contracts.mjs --regen` to seed it");
  } else {
    // Compare.
    const snapExports = snapshot.exports ?? {};
    const currentNames = new Set(Object.keys(currentApi));
    const snapNames = new Set(Object.keys(snapExports));
    const added = [...currentNames].filter((n) => !snapNames.has(n)).sort();
    const removed = [...snapNames].filter((n) => !currentNames.has(n)).sort();
    const kindChanged = [...currentNames]
      .filter((n) => snapNames.has(n) && snapExports[n] !== currentApi[n])
      .sort()
      .map((n) => ({ name: n, from: snapExports[n], to: currentApi[n] }));
    if (added.length || removed.length || kindChanged.length) {
      snapshotDrift = { added, removed, kindChanged };
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Report
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  console.error("FleetOS contract checks FAILED:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("");
  console.error(`Total: ${violations.length} violation(s).`);
  process.exit(1);
}

if (snapshotDrift) {
  console.error("FleetOS contract checks FAILED:");
  console.error("");
  console.error("  @fleetos/contracts public API has drifted from tools/contracts-api.snapshot.json.");
  console.error("");
  if (snapshotDrift.added.length) {
    console.error("  ADDED exports (present in code, missing from snapshot):");
    for (const n of snapshotDrift.added) console.error(`    + ${n} (${currentApi[n]})`);
  }
  if (snapshotDrift.removed.length) {
    console.error("  REMOVED exports (present in snapshot, missing from code):");
    for (const n of snapshotDrift.removed) console.error(`    - ${n}`);
  }
  if (snapshotDrift.kindChanged.length) {
    console.error("  KIND CHANGED (rename / reclassification):");
    for (const c of snapshotDrift.kindChanged) console.error(`    ~ ${c.name}: ${c.from} -> ${c.to}`);
  }
  console.error("");
  console.error("  If this drift is INTENTIONAL and authorized by an ADR, regenerate:");
  console.error("    node tools/check-contracts.mjs --regen");
  console.error("  and commit the updated snapshot.");
  process.exit(1);
}

const exportCount = currentApi ? Object.keys(currentApi).length : 0;
console.log(`FleetOS contract checks passed. (${exportCount} @fleetos/contracts exports snapshotted)`);

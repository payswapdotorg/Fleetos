#!/usr/bin/env node
/**
 * FleetOS public-contract gate (W003 D1).
 *
 * Two responsibilities:
 *
 *  1. Workspace contract gate — for every `@fleetos/*` workspace package:
 *     - `src/index.ts` MUST export `MODULE_NAME` and `MODULE_VERSION` (already
 *       enforced by `tools/verify-skeleton.mjs`; we re-check here so the
 *       contract gate is self-contained).
 *     - `package.json` `name` MUST match the directory scope (`@fleetos/<dir>`).
 *     - The package MUST resolve from the root workspace list.
 *
 *  2. Golden snapshot of the `@fleetos/contracts` public API —
 *     `tools/contracts-api.snapshot.json` is a sorted, deterministic list of
 *     every exported name (and its syntactic kind) from
 *     `packages/contracts/src/index.ts` (recursively following `export * from
 *     "./..."` re-exports).
 *
 *     Default mode COMPARES the freshly-computed API against the committed
 *     snapshot. Any added, removed, or renamed export FAILS with a precise
 *     diff. Use `--regen` to rewrite the snapshot deliberately.
 *
 * Wired into `bun run check` via the root `check:contracts` script. CI
 * therefore enforces the gate on every push (W003 D4).
 *
 * No external dependencies. Node.js only. Zero runtime deps in the
 * FleetOS workspace itself; typescript is a dev-dep only and is NOT
 * imported here (the snapshot is built by a lightweight export-statement
 * scanner — sufficient because the contracts package uses a consistent
 * `export const | function | interface | type | class | enum` style and
 * `export * from "./..."` re-exports).
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const CONTRACTS_DIR = path.join(REPO_ROOT, "packages", "contracts");
const CONTRACTS_INDEX = path.join(CONTRACTS_DIR, "src", "index.ts");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "tools", "contracts-api.snapshot.json");
const SNAPSHOT_SCHEMA = "fleetos-contracts-snapshot/v1";

const args = process.argv.slice(2);
const REGEN = args.includes("--regen");

// ---------------------------------------------------------------------------
// 1. Workspace contract gate
// ---------------------------------------------------------------------------

/**
 * Recursively walk a top-level directory and find all directories that
 * contain a package.json. Does NOT recurse into a directory once it's
 * identified as a package (sub-packages are separate workspaces).
 * @param {string} rootRel
 * @returns {string[]}
 */
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

/**
 * Read and parse a package.json. Returns null on parse failure.
 * @param {string} pkgJsonPath
 * @returns {Record<string, unknown> | null}
 */
function readPkgJson(pkgJsonPath) {
  try {
    return JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The list of workspace roots from the root package.json. Used to verify
 * that every @fleetos/* package is reachable from a workspace glob.
 * @returns {string[]}
 */
function workspaceRoots() {
  const rootPkg = readPkgJson(path.join(REPO_ROOT, "package.json"));
  if (!rootPkg || !Array.isArray(rootPkg.workspaces)) return [];
  return rootPkg.workspaces;
}

/**
 * Returns true if a package rel (e.g. "packages/contracts") matches any
 * workspace glob in the root package.json. The globs are simple patterns
 * like "packages/*", "packages/integrations/*", "apps/*".
 * @param {string} pkgRel
 * @param {string[]} globs
 * @returns {boolean}
 */
function matchesWorkspaceGlob(pkgRel, globs) {
  for (const g of globs) {
    // Convert simple glob to regex: "*" -> "[^/]+"
    const re = "^" + g.replace(/\*/g, "[^/]+") + "$";
    if (new RegExp(re).test(pkgRel)) return true;
  }
  return false;
}

const violations = [];
const rootGlobs = workspaceRoots();

if (rootGlobs.length === 0) {
  violations.push("NO_WORKSPACES: root package.json has no `workspaces` array — workspace resolution is broken");
}

const packageDirs = [...walkPackageDirs("packages"), ...walkPackageDirs("apps")];
/** @type {string[]} list of @fleetos/* package names discovered */
const fleetosPackageNames = [];

for (const pkgRel of packageDirs) {
  const pkgJsonPath = path.join(REPO_ROOT, pkgRel, "package.json");
  const pkg = readPkgJson(pkgJsonPath);
  if (!pkg) {
    violations.push(`PARSE_ERROR: ${pkgRel}/package.json could not be parsed as JSON`);
    continue;
  }
  const name = typeof pkg.name === "string" ? pkg.name : null;
  if (!name || !name.startsWith("@fleetos/")) {
    violations.push(`BAD_NAME: ${pkgRel}/package.json — name must start with "@fleetos/"`);
    continue;
  }
  fleetosPackageNames.push(name);

  // Directory-scope check: the package name suffix MUST match the directory
  // name. e.g. packages/contracts/ -> @fleetos/contracts;
  // packages/integrations/adcos/ -> @fleetos/integration-adcos (the
  // directory name is the scope's local name; we accept either the literal
  // directory name OR a single-segment suffix that matches it).
  const dirName = pkgRel.split("/").pop();
  const suffix = name.slice("@fleetos/".length);
  if (suffix !== dirName) {
    // Allowed: the directory is an integrations sub-dir whose name uses a
    // different convention (e.g. "adcos" -> "integration-adcos"). We accept
    // this when the parent directory is "packages/integrations".
    const parent = pkgRel.includes("/") ? pkgRel.slice(0, pkgRel.lastIndexOf("/")) : "";
    const isIntegration = parent === "packages/integrations";
    if (!isIntegration) {
      violations.push(
        `NAME_SCOPE_MISMATCH: ${pkgRel}/package.json — name "${name}" does not match directory "${dirName}"`,
      );
    }
  }

  // Workspace resolution check
  if (rootGlobs.length > 0 && !matchesWorkspaceGlob(pkgRel, rootGlobs)) {
    violations.push(
      `NOT_IN_WORKSPACE: ${pkgRel}/ — package directory is not reachable from any root workspace glob (${rootGlobs.join(", ")})`,
    );
  }

  // src/index.ts exports MODULE_NAME and MODULE_VERSION
  const indexTsPath = path.join(REPO_ROOT, pkgRel, "src", "index.ts");
  if (!fs.existsSync(indexTsPath)) {
    // verify-skeleton covers this; skip here
  } else {
    const indexTs = fs.readFileSync(indexTsPath, "utf8");
    if (!/export const MODULE_NAME\s*=/.test(indexTs)) {
      violations.push(`MISSING_MODULE_NAME: ${pkgRel}/src/index.ts — must export MODULE_NAME`);
    }
    if (!/export const MODULE_VERSION\s*=/.test(indexTs)) {
      violations.push(`MISSING_MODULE_VERSION: ${pkgRel}/src/index.ts — must export MODULE_VERSION`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Build the contracts public-API snapshot
// ---------------------------------------------------------------------------

/**
 * The set of export-statement keywords we recognize. Each captures the
 * exported local name. The `kind` field records the syntactic form so that
 * snapshot diffs can surface kind changes (e.g. `const` -> `function`).
 */
const EXPORT_KINDS = new Set([
  "const",
  "function",
  "interface",
  "type",
  "class",
  "enum",
]);

/**
 * Strip a line comment (`// ...`) from a line, preserving content before it.
 * Does NOT attempt to strip block comments across lines (contracts source
 * has no multi-line block comments inside export statements).
 * @param {string} line
 * @returns {string}
 */
function stripLineComment(line) {
  const idx = line.indexOf("//");
  if (idx < 0) return line;
  // Naive: assume // is not inside a string. The contracts source never
  // contains "//" inside string literals on export lines.
  return line.slice(0, idx);
}

/**
 * Scan a TypeScript source file for top-level exports. Returns a list of
 * `{ name, kind, from }` entries:
 *   - Direct exports: `export const Foo = ...`, `export function bar()`,
 *     `export interface Baz`, `export type Qux`, `export class Quux`,
 *     `export enum Color`.
 *   - Re-exports: `export * from "./other"` (resolved recursively) and
 *     `export { Foo, Bar } from "./other"` and
 *     `export { default as Baz } from "./other"`.
 *
 * `from` is the relative source file (without extension) the export came
 * from — useful for diffing.
 *
 * @param {string} filePath absolute path to the .ts file
 * @param {Set<string>} visited set of already-resolved file paths (cycle guard)
 * @returns {{ name: string, kind: string, from: string }[]}
 */
function scanExports(filePath, visited) {
  const abs = path.resolve(filePath);
  if (visited.has(abs)) return [];
  visited.add(abs);

  if (!fs.existsSync(abs)) return [];
  const src = fs.readFileSync(abs, "utf8");
  const fileDir = path.dirname(abs);
  const fromRel = path.relative(CONTRACTS_DIR, abs).replace(/\\/g, "/");

  /** @type {{ name: string, kind: string, from: string }[]} */
  const out = [];

  // Split into lines; we scan line-by-line for single-line export forms.
  // Multi-line forms (`export interface Foo {\n ... \n}`) are still captured
  // by their declaration line; the body is irrelevant to the snapshot.
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = stripLineComment(raw).trim();
    if (!line || line.startsWith("*") || line.startsWith("/*")) continue;

    // Form 1: `export * from "./other"` (re-export all)
    const reExportAll = line.match(/^export\s+\*\s+from\s+["']([^"']+)["']\s*;?$/);
    if (reExportAll) {
      const target = reExportAll[1];
      if (target.startsWith(".")) {
        const targetAbs = resolveModulePath(path.join(fileDir, target));
        if (targetAbs) {
          out.push(...scanExports(targetAbs, visited));
        }
      }
      continue;
    }

    // Form 2: `export { Foo, Bar } from "./other"` (named re-export)
    const reExportNamed = line.match(/^export\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']\s*;?$/);
    if (reExportNamed) {
      const names = reExportNamed[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const target = reExportNamed[2];
      // Determine the kind by looking up the source module (best-effort).
      const targetAbs = target.startsWith(".")
        ? resolveModulePath(path.join(fileDir, target))
        : null;
      /** @type {Record<string, string>} name -> kind */
      const kindMap = {};
      if (targetAbs) {
        const targetExports = scanExports(targetAbs, new Set());
        for (const e of targetExports) kindMap[e.name] = e.kind;
      }
      for (const n of names) {
        // Handle `default as Baz` re-export
        const m = n.match(/^default\s+as\s+(\w+)$/);
        const finalName = m ? m[1] : n;
        out.push({
          name: finalName,
          kind: kindMap[finalName] ?? "re-export",
          from: target.startsWith(".") ? path.relative(CONTRACTS_DIR, targetAbs).replace(/\\/g, "/") : target,
        });
      }
      continue;
    }

    // Form 3: `export { Foo, Bar }` (re-export of locals — rare in contracts)
    const reExportLocal = line.match(/^export\s+\{([^}]+)\}\s*;?$/);
    if (reExportLocal) {
      const names = reExportLocal[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const n of names) {
        const m = n.match(/^(\w+)\s+as\s+(\w+)$/);
        const finalName = m ? m[2] : n;
        out.push({ name: finalName, kind: "re-export", from: fromRel });
      }
      continue;
    }

    // Form 4: `export <kind> Name ...` (direct declaration)
    // Capture: export const Foo, export function bar, export interface Baz,
    // export type Qux, export class Quux, export enum Color.
    const directExport = line.match(/^export\s+(const|function|interface|type|class|enum)\s+(\w+)/);
    if (directExport) {
      const kind = directExport[1];
      const name = directExport[2];
      out.push({ name, kind, from: fromRel });
      continue;
    }
  }
  return out;
}

/**
 * Resolve a module path (without extension) to a .ts file. Handles both
 * direct file (`./ids` -> `ids.ts`) and directory index (`./ids` ->
 * `ids/index.ts`).
 * @param {string} base the path without extension
 * @returns {string | null} absolute path to the .ts file, or null
 */
function resolveModulePath(base) {
  const candidates = [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Build the snapshot: a sorted, deduplicated list of
 * `{ name, kind, from }` for every exported name reachable from the
 * contracts package's `src/index.ts`.
 *
 * Dedup: the same name may be re-exported by multiple modules (rare but
 * possible); we keep the first occurrence after sorting.
 * @returns {{ name: string, kind: string, from: string }[]}
 */
function buildSnapshot() {
  const visited = new Set();
  const raw = scanExports(CONTRACTS_INDEX, visited);
  // Sort by name, then by kind, then by from — stable, deterministic.
  const sorted = raw.slice().sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
  });
  // Dedup by (name, kind) — keep the first from.
  /** @type {{ name: string, kind: string, from: string }[]} */
  const dedup = [];
  const seen = new Set();
  for (const e of sorted) {
    const key = `${e.name}|${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(e);
  }
  return dedup;
}

/**
 * Compute a shallow diff between two sorted snapshot arrays. Returns
 * { added, removed, kindChanged }.
 * @param {{ name: string, kind: string, from: string }[]} a
 * @param {{ name: string, kind: string, from: string }[]} b
 */
function diffSnapshots(a, b) {
  /** @type {{ name: string, kind: string, from: string }[]} */
  const added = [];
  /** @type {{ name: string, kind: string, from: string }[]} */
  const removed = [];
  /** @type {{ name: string, fromKind: string, toKind: string, from: string }[]} */
  const kindChanged = [];
  const aMap = new Map(a.map((e) => [e.name, e]));
  const bMap = new Map(b.map((e) => [e.name, e]));
  for (const [name, be] of bMap) {
    const ae = aMap.get(name);
    if (!ae) {
      added.push(be);
    } else if (ae.kind !== be.kind) {
      kindChanged.push({ name, fromKind: ae.kind, toKind: be.kind, from: be.from });
    }
  }
  for (const [name, ae] of aMap) {
    if (!bMap.has(name)) removed.push(ae);
  }
  added.sort((x, y) => (x.name < y.name ? -1 : 1));
  removed.sort((x, y) => (x.name < y.name ? -1 : 1));
  kindChanged.sort((x, y) => (x.name < y.name ? -1 : 1));
  return { added, removed, kindChanged };
}

// ---------------------------------------------------------------------------
// 3. Compare against committed snapshot (or regen)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SnapshotFile
 * @property {string} $schema
 * @property {string} packageName
 * @property {string} packageVersion
 * @property {{ name: string, kind: string, from: string }[]} exports
 */

const fresh = buildSnapshot();
const contractsPkg = readPkgJson(path.join(CONTRACTS_DIR, "package.json"));
const contractsVersion = contractsPkg && typeof contractsPkg.version === "string" ? contractsPkg.version : "0.0.0";

if (REGEN) {
  /** @type {SnapshotFile} */
  const snap = {
    $schema: SNAPSHOT_SCHEMA,
    packageName: "@fleetos/contracts",
    packageVersion: contractsVersion,
    exports: fresh,
  };
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + "\n", "utf8");
  console.log(
    `contracts-api.snapshot.json regenerated: ${fresh.length} exports written to ${path.relative(REPO_ROOT, SNAPSHOT_PATH)}`,
  );
} else {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    violations.push(
      `SNAPSHOT_MISSING: ${path.relative(REPO_ROOT, SNAPSHOT_PATH)} — run \`node tools/check-contracts.mjs --regen\` to create it`,
    );
  } else {
    /** @type {SnapshotFile | null} */
    let snap = null;
    try {
      snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    } catch {
      violations.push(`SNAPSHOT_PARSE_ERROR: ${path.relative(REPO_ROOT, SNAPSHOT_PATH)} — invalid JSON`);
    }
    if (snap) {
      if (snap.$schema !== SNAPSHOT_SCHEMA) {
        violations.push(
          `SNAPSHOT_SCHEMA_MISMATCH: expected "${SNAPSHOT_SCHEMA}", got "${snap.$schema}" — run with --regen after schema changes`,
        );
      }
      if (snap.packageName !== "@fleetos/contracts") {
        violations.push(`SNAPSHOT_PKG_MISMATCH: expected @fleetos/contracts, got ${snap.packageName}`);
      }
      if (snap.packageVersion !== contractsVersion) {
        violations.push(
          `SNAPSHOT_VERSION_DRIFT: snapshot is for v${snap.packageVersion}, package.json is v${contractsVersion} — run with --regen after a version bump`,
        );
      }
      const committed = Array.isArray(snap.exports) ? snap.exports : [];
      const diff = diffSnapshots(committed, fresh);
      if (diff.added.length > 0) {
        for (const e of diff.added) {
          violations.push(
            `SNAPSHOT_ADDED: export "${e.name}" (kind=${e.kind}, from=${e.from}) is in the package but NOT in the snapshot. Run \`node tools/check-contracts.mjs --regen\` if this is intentional.`,
          );
        }
      }
      if (diff.removed.length > 0) {
        for (const e of diff.removed) {
          violations.push(
            `SNAPSHOT_REMOVED: export "${e.name}" (kind=${e.kind}, from=${e.from}) is in the snapshot but NOT in the package. Run \`node tools/check-contracts.mjs --regen\` if this is intentional.`,
          );
        }
      }
      if (diff.kindChanged.length > 0) {
        for (const e of diff.kindChanged) {
          violations.push(
            `SNAPSHOT_KIND_CHANGED: export "${e.name}" changed kind from "${e.fromKind}" to "${e.toKind}" (from=${e.from}). Run \`node tools/check-contracts.mjs --regen\` if this is intentional.`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Report
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  console.error("FleetOS contract checks FAILED:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("");
  console.error(`Total: ${violations.length} violation(s).`);
  process.exit(1);
}

console.log(
  `FleetOS contract checks passed. (${fleetosPackageNames.length} @fleetos/* packages verified; ${fresh.length} contracts exports snapshot${REGEN ? " (regenerated)" : " matches"})`,
);

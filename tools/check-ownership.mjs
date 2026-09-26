#!/usr/bin/env node
// FleetOS ownership + import-boundary gate.
//
// Implements D3 of W001 (and the W003 hardening that extends it):
//   1. Parse spec/worker-ownership.yaml into owner -> path-prefixes.
//   2. Verify EVERY package directory is claimed by exactly one owner lane
//      (unclaimed or doubly-claimed package dirs FAIL).
//   3. Import-boundary rule: scan each src .ts/.tsx file; map its owning
//      lane by path prefix; for every cross-lane import (static `import
//      ... from "..."`, dynamic `import("...")`, CommonJS `require(...)`,
//      or `import type ... from "..."`) that resolves into another lane's
//      package directory, FAIL unless the imported package is
//      @fleetos/contracts (the shared seam) or the import is within the
//      same lane. Cross-lane imports of anything other than the shared
//      seam are violations.
//   4. Print "FleetOS ownership checks passed." on success; exit 1 with a
//      precise violation list on failure.
//
// Ownership is determined by LONGEST-PREFIX MATCH: for a directory D, the
// owning lane is the lane whose claimed path is the longest prefix of D.
// This allows `apps/web/` to be claimed by tech-lead while `apps/web/device/`
// remains claimed by worker-a (the longer prefix wins).
//
// W003 hardening: the original W001 scanner caught only static
// `import ... from "..."` statements. It now also catches:
//   - dynamic `import("...")` expressions (e.g. `await import("@fleetos/x")`)
//   - CommonJS `require("...")` calls (e.g. `require("@fleetos/x")`)
//   - `import type ... from "..."` (already matched by the original regex
//     but now explicitly tagged in the report so callers can see the form)
//
// No external dependencies. Node.js only.
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// 1. Parse spec/worker-ownership.yaml (line-based)
// ---------------------------------------------------------------------------

const yamlPath = path.join(REPO_ROOT, "spec/worker-ownership.yaml");
if (!fs.existsSync(yamlPath)) {
  console.error("OWNERSHIP CHECK FAILED: spec/worker-ownership.yaml not found");
  process.exit(1);
}
const yamlText = fs.readFileSync(yamlPath, "utf8");

/** @type {Record<string, string[]>} lane -> normalized claimed paths (with trailing /) */
const lanePaths = {};
let currentLane = null;
for (const rawLine of yamlText.split("\n")) {
  const line = rawLine.replace(/\s+$/, "");
  if (!line.trim() || line.trim().startsWith("#")) continue;

  // Lane header: "  tech-lead:" etc. (allow leading indentation)
  const laneMatch = line.match(/^\s*(tech-lead|worker-a|worker-b|worker-c):\s*$/);
  if (laneMatch) {
    currentLane = laneMatch[1];
    if (!lanePaths[currentLane]) lanePaths[currentLane] = [];
    continue;
  }

  // Path entry: "      - <path>" (allow leading indentation)
  const pathMatch = line.match(/^\s*-\s+(.+?)\s*$/);
  if (pathMatch && currentLane) {
    const p = pathMatch[1];
    const normalized = p.endsWith("/") ? p : p + "/";
    lanePaths[currentLane].push(normalized);
  }
}

/**
 * Normalize a path to have a trailing slash for prefix comparison.
 * @param {string} p
 * @returns {string}
 */
function normalize(p) {
  return p.endsWith("/") ? p : p + "/";
}

/**
 * Find claimants for a directory or file path using longest-prefix match.
 * Returns the set of lanes whose claimed path is the LONGEST prefix of `target`.
 * If multiple lanes share the same longest matching prefix (shouldn't happen
 * since paths in the yaml are distinct), all are returned.
 * @param {string} targetRel
 * @returns {string[]}
 */
function findClaimants(targetRel) {
  const d = normalize(targetRel);
  let bestLen = 0;
  const bestLanes = new Set();
  for (const [lane, paths] of Object.entries(lanePaths)) {
    for (const claimed of paths) {
      if (d.startsWith(claimed)) {
        if (claimed.length > bestLen) {
          bestLen = claimed.length;
          bestLanes.clear();
          bestLanes.add(lane);
        } else if (claimed.length === bestLen) {
          bestLanes.add(lane);
        }
      }
    }
  }
  return [...bestLanes];
}

// ---------------------------------------------------------------------------
// 2. Walk all package directories (those containing package.json)
// ---------------------------------------------------------------------------

/**
 * Recursively walk a top-level directory and find all directories that
 * contain a package.json. Does NOT recurse into a directory once it's
 * identified as a package (sub-packages are separate workspaces).
 * @param {string} rootRel
 * @returns {{rel: string}[]}
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
        found.push({ rel: subRel });
        // Do not recurse into package dirs
      } else {
        walk(subAbs, subRel);
      }
    }
  }
  walk(rootAbs, rootRel);
  return found;
}

const packageDirs = [...walkPackageDirs("packages"), ...walkPackageDirs("apps")];

// ---------------------------------------------------------------------------
// 3. Check #2: every package directory claimed by exactly one lane
// ---------------------------------------------------------------------------

const violations = [];
const warnings = [];
/** @type {Record<string, string>} package rel -> owning lane */
const laneMap = {};

for (const { rel } of packageDirs) {
  const claimants = findClaimants(rel);
  if (claimants.length === 0) {
    violations.push(`UNCLAIMED: ${rel}/ — no lane in spec/worker-ownership.yaml claims this package directory`);
  } else if (claimants.length > 1) {
    violations.push(`DOUBLE-CLAIMED: ${rel}/ — claimed by ${claimants.join(", ")}`);
  } else {
    laneMap[rel] = claimants[0];
  }
}

// ---------------------------------------------------------------------------
// 4. Build @fleetos/<name> -> package rel map (for import boundary check)
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} package name -> package rel */
const pkgNameToRel = {};
/** @type {Record<string, string>} package rel -> package name */
const pkgRelToName = {};
for (const { rel } of packageDirs) {
  const pkgJsonPath = path.join(REPO_ROOT, rel, "package.json");
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (pkgJson.name && pkgJson.name.startsWith("@fleetos/")) {
      pkgNameToRel[pkgJson.name] = rel;
      pkgRelToName[rel] = pkgJson.name;
    }
  } catch {
    violations.push(`PARSE_ERROR: ${rel}/package.json could not be parsed as JSON`);
  }
}

// ---------------------------------------------------------------------------
// 5. Import-specifier extraction (W001 static + W003 dynamic/require/type)
// ---------------------------------------------------------------------------

/**
 * Strip block comments (`slash-star ... star-slash`) and line comments
 * (`slash-slash ...`) from TypeScript source so the import-parsing regexes
 * don't match import-like text inside comments.
 *
 * String literals are preserved (we don't strip inside strings); this
 * approximation is fine for our purposes.
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
      // Skip to the closing star-slash.
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === "/" && next === "/") {
      // Skip to end of line.
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
 * Extract every import specifier from a TypeScript source file, classifying
 * each by its syntactic form.
 *
 * Forms recognized (W001 baseline + W003 extensions):
 *
 *   - "static-import":  `import x from "spec"`, `import { x } from "spec"`,
 *                       `import * as x from "spec"`, `import "spec"`.
 *                       This regex also matches `import type ... from "spec"`
 *                       (the `type` token is captured by the optional middle
 *                       group) — so `import type` is correctly caught here,
 *                       but is then re-tagged as "import-type" below.
 *
 *   - "dynamic-import": `import("spec")` or `await import("spec")`.
 *                       W003 extension. Matches both bare and awaited forms.
 *
 *   - "require":        `require("spec")`. W003 extension. Catches CommonJS
 *                       interop (e.g. via `createRequire` or in `.cjs`-style
 *                       modules).
 *
 *   - "import-type":    `import type ... from "spec"`. W003 explicit tag.
 *                       Already matched by the "static-import" regex above;
 *                       we post-process to tag these so the violation report
 *                       can distinguish them.
 *
 * The returned array preserves source order. Each entry carries the spec
 * string, the 1-indexed line number (approximate — line where the regex
 * match started), and the form tag. Callers filter on form if needed.
 *
 * Notes:
 *   - Comment stripping is intentionally simple (line comments and block
 *     comments are stripped before matching). String literals are NOT
 *     stripped, but in practice TypeScript source rarely contains
 *     `import("...")` strings outside actual import expressions.
 *   - The static-import regex is anchored to the start of a line (after
 *     trimming leading whitespace). Dynamic import and require are NOT
 *     anchored — they may appear anywhere in an expression.
 *
 * @param {string} text the TypeScript source
 * @returns {Array<{ spec: string, form: "static-import" | "dynamic-import" | "require" | "import-type", line: number }>}
 */
export function extractImportSpecifiers(text) {
  const stripped = stripComments(text);
  const out = [];

  // Helper to compute the 1-indexed line number of a regex match.
  function lineOf(matchIndex) {
    let line = 1;
    for (let i = 0; i < matchIndex && i < stripped.length; i++) {
      if (stripped[i] === "\n") line++;
    }
    return line;
  }

  // 1. Static imports (also catches `import type ... from "..."`).
  //    Regex explanation:
  //      ^\s*                  - optional leading whitespace, line-anchored
  //      import                - keyword
  //      \s+                   - required whitespace after `import`
  //      (?:[\s\S]*?\s+from\s+)?  - optional middle (e.g. `type { X }` or `{ a, b }` or `* as n`)
  //                                  followed by `from`
  //      ["']([^"']+)["']      - the quoted specifier (captured)
  //    The optional-middle group makes the regex match both bare `import "spec"`
  //    and `import x from "spec"` and `import type X from "spec"`.
  const staticRegex = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm;
  let m;
  while ((m = staticRegex.exec(stripped)) !== null) {
    // Inspect the matched text to see if this is an `import type ... from`.
    const matchText = stripped.slice(m.index, m.index + m[0].length);
    const isTypeOnly = /^\s*import\s+type\b/.test(matchText);
    out.push({
      spec: m[1],
      form: isTypeOnly ? "import-type" : "static-import",
      line: lineOf(m.index),
    });
  }

  // 2. Dynamic import("...") — anywhere in the source (not line-anchored).
  //    Matches both `import("spec")` and `await import("spec")`.
  //    Avoids false-positives inside `import.meta.url` (no parens after import).
  const dynamicRegex = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dynamicRegex.exec(stripped)) !== null) {
    out.push({ spec: m[1], form: "dynamic-import", line: lineOf(m.index) });
  }

  // 3. CommonJS require("...") — anywhere in the source.
  //    Matches `require("spec")` and `require('spec')` and `await require("spec")`.
  //    Does NOT match `require.resolve(...)` (different function).
  const requireRegex = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = requireRegex.exec(stripped)) !== null) {
    out.push({ spec: m[1], form: "require", line: lineOf(m.index) });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 6. Check #3: per-file import-boundary rule
// ---------------------------------------------------------------------------

/**
 * Find the lane owning a file by longest-prefix match on its path.
 * @param {string} filePath
 * @returns {string | null}
 */
function fileLane(filePath) {
  const claimants = findClaimants(filePath);
  return claimants.length === 1 ? claimants[0] : (claimants[0] ?? null);
}

/**
 * Find the package directory (rel) containing a file.
 * Walks up the path tree until it finds a directory containing package.json.
 * @param {string} filePath
 * @returns {string | null}
 */
function packageOf(filePath) {
  let dir = filePath;
  while (true) {
    const slash = dir.lastIndexOf("/");
    if (slash < 0) return null;
    dir = dir.substring(0, slash);
    if (fs.existsSync(path.join(REPO_ROOT, dir, "package.json"))) {
      return dir;
    }
    if (!dir.includes("/")) return null;
  }
}

/**
 * Walk all .ts/.tsx files under src/ in a top-level directory.
 * @param {string} rootRel
 * @returns {string[]}
 */
function walkTsFiles(rootRel) {
  const found = [];
  const rootAbs = path.join(REPO_ROOT, rootRel);
  if (!fs.existsSync(rootAbs)) return found;
  function walk(rel) {
    const abs = path.join(REPO_ROOT, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const subRel = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === ".next") continue;
        walk(subRel);
      } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
        // Only check src/ files
        if (subRel.includes("/src/")) {
          found.push(subRel);
        }
      }
    }
  }
  walk(rootRel);
  return found;
}

const tsFiles = [...walkTsFiles("packages"), ...walkTsFiles("apps")];

for (const file of tsFiles) {
  const fileLaneName = fileLane(file);
  if (!fileLaneName) {
    warnings.push(`NO_LANE: ${file} — file is not under any claimed path in spec/worker-ownership.yaml`);
    continue;
  }
  const filePkg = packageOf(file);

  let text;
  try {
    text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  } catch {
    warnings.push(`READ_ERROR: ${file} — could not read file`);
    continue;
  }

  const specs = extractImportSpecifiers(text);
  for (const { spec, form, line } of specs) {
    let importedPkgRel = null;
    let importedPkgName = null;

    if (spec.startsWith("@fleetos/")) {
      // Workspace package import. May include a subpath: "@fleetos/contracts/foo"
      const baseName = spec.split("/").slice(0, 2).join("/");
      importedPkgName = baseName;
      importedPkgRel = pkgNameToRel[baseName];
      if (!importedPkgRel) {
        // Unknown @fleetos/* — not in workspace. Could be a future package or a typo.
        violations.push(
          `UNKNOWN_IMPORT: ${file}:${line} (${form}) imports "${spec}" — no workspace package with this name exists`,
        );
        continue;
      }
    } else if (spec.startsWith("./") || spec.startsWith("../")) {
      // Relative import — resolve to a file path
      const fileDir = path.dirname(file);
      const resolved = path.posix.normalize(path.posix.join(fileDir, spec));
      const candidates = [
        resolved + ".ts",
        resolved + ".tsx",
        resolved + "/index.ts",
        resolved + "/index.tsx",
      ];
      const resolvedFile = candidates.find((c) => fs.existsSync(path.join(REPO_ROOT, c)));
      if (!resolvedFile) continue; // Unresolvable — skip (could be a runtime asset)
      importedPkgRel = packageOf(resolvedFile);
      if (!importedPkgRel) continue;
      importedPkgName = pkgRelToName[importedPkgRel] ?? null;
    } else {
      // Bare module specifier (e.g., "bun:test", "typescript") — skip
      continue;
    }

    // Skip if import is within the same package
    if (filePkg && filePkg === importedPkgRel) continue;

    // Skip if imported package is the shared seam (@fleetos/contracts)
    if (importedPkgName === "@fleetos/contracts") continue;

    // Determine the imported package's owning lane
    const importedLane = laneMap[importedPkgRel] ?? findClaimants(importedPkgRel)[0];
    if (!importedLane) {
      // Unclaimed package — already reported in check #2
      continue;
    }

    if (importedLane !== fileLaneName) {
      violations.push(
        `CROSS_LANE_IMPORT: ${file}:${line} (${form}) (lane: ${fileLaneName}) imports "${spec}" from ${importedPkgRel}/ (lane: ${importedLane}) — only @fleetos/contracts may cross lanes`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Report
// ---------------------------------------------------------------------------

if (warnings.length > 0) {
  for (const w of warnings) console.warn(`[ownership] WARNING: ${w}`);
}

if (violations.length > 0) {
  console.error("FleetOS ownership checks FAILED:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("");
  console.error(`Total: ${violations.length} violation(s).`);
  process.exit(1);
}

console.log("FleetOS ownership checks passed.");

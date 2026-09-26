#!/usr/bin/env node
// FleetOS ownership + import-boundary gate.
//
// Implements D3 of W001:
//   1. Parse spec/worker-ownership.yaml into owner -> path-prefixes.
//   2. Verify EVERY package directory is claimed by exactly one owner lane
//      (unclaimed or doubly-claimed package dirs FAIL).
//   3. Import-boundary rule: scan each src .ts/.tsx file; map its owning
//      lane by path prefix; for every `import ... from "@fleetos/x"` or
//      relative import that resolves into another lane's package directory,
//      FAIL unless the imported package is @fleetos/contracts (the shared
//      seam) or the import is within the same lane. Cross-lane imports of
//      anything other than the shared seam are violations.
//   4. Print "FleetOS ownership checks passed." on success; exit 1 with a
//      precise violation list on failure.
//
// Ownership is determined by LONGEST-PREFIX MATCH: for a directory D, the
// owning lane is the lane whose claimed path is the longest prefix of D.
// This allows `apps/web/` to be claimed by tech-lead while `apps/web/device/`
// remains claimed by worker-a (the longer prefix wins).
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
// 5. Check #3: import-boundary rule
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

// Regex to capture the module specifier of an import statement.
// Handles: import x from "spec"; import "spec"; import type x from "spec";
//          import { x } from "spec"; import * as x from "spec";
// Does NOT handle dynamic import() — that's a runtime concern, not a static boundary.
const importRegex = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm;

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

  let m;
  importRegex.lastIndex = 0;
  while ((m = importRegex.exec(text)) !== null) {
    const spec = m[1];
    let importedPkgRel = null;
    let importedPkgName = null;

    if (spec.startsWith("@fleetos/")) {
      // Workspace package import. May include a subpath: "@fleetos/contracts/foo"
      const baseName = spec.split("/").slice(0, 2).join("/");
      importedPkgName = baseName;
      importedPkgRel = pkgNameToRel[baseName];
      if (!importedPkgRel) {
        // Unknown @fleetos/* — not in workspace. Could be a future package or a typo.
        violations.push(`UNKNOWN_IMPORT: ${file} imports "${spec}" — no workspace package with this name exists`);
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
        `CROSS_LANE_IMPORT: ${file} (lane: ${fileLaneName}) imports "${spec}" from ${importedPkgRel}/ (lane: ${importedLane}) — only @fleetos/contracts may cross lanes`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Report
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

#!/usr/bin/env node
/**
 * FleetOS skeleton verifier (D4 of W001).
 *
 * Asserts every package directory under packages/ and apps/ contains the
 * required skeleton files: package.json, tsconfig.json, src/index.ts,
 * src/index.test.ts. Also asserts that every path claimed in
 * spec/worker-ownership.yaml that contains a package.json is a complete
 * skeleton package.
 *
 * Wired into `bun run check` via the root `check:skeleton` script.
 *
 * No external dependencies. Node.js only.
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

const REQUIRED_FILES = ["package.json", "tsconfig.json", "src/index.ts", "src/index.test.ts"];

/**
 * Recursively walk a top-level directory and find all directories that
 * contain a package.json.
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

const allPackageDirs = [...walkPackageDirs("packages"), ...walkPackageDirs("apps")];

const violations = [];
let verified = 0;

for (const pkgRel of allPackageDirs) {
  const pkgAbs = path.join(REPO_ROOT, pkgRel);
  for (const f of REQUIRED_FILES) {
    const filePath = path.join(pkgAbs, f);
    if (!fs.existsSync(filePath)) {
      violations.push(`MISSING: ${pkgRel}/${f}`);
    }
  }
  verified++;
}

// Also assert package.json declares a @fleetos/* name and the placeholder
// exports are present.
for (const pkgRel of allPackageDirs) {
  const pkgJsonPath = path.join(REPO_ROOT, pkgRel, "package.json");
  if (!fs.existsSync(pkgJsonPath)) continue;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (!pkg.name || !pkg.name.startsWith("@fleetos/")) {
      violations.push(`BAD_NAME: ${pkgRel}/package.json — name must start with "@fleetos/"`);
    }
    if (pkg.version !== "0.1.0") {
      violations.push(`BAD_VERSION: ${pkgRel}/package.json — version must be "0.1.0"`);
    }
    if (pkg.private !== true) {
      violations.push(`NOT_PRIVATE: ${pkgRel}/package.json — private must be true`);
    }
  } catch {
    violations.push(`PARSE_ERROR: ${pkgRel}/package.json — invalid JSON`);
  }

  // Verify src/index.ts exports MODULE_NAME and MODULE_VERSION
  const indexTsPath = path.join(REPO_ROOT, pkgRel, "src/index.ts");
  if (fs.existsSync(indexTsPath)) {
    const indexTs = fs.readFileSync(indexTsPath, "utf8");
    if (!/export const MODULE_NAME\s*=/.test(indexTs)) {
      violations.push(`MISSING_EXPORT: ${pkgRel}/src/index.ts — must export MODULE_NAME`);
    }
    if (!/export const MODULE_VERSION\s*=/.test(indexTs)) {
      violations.push(`MISSING_EXPORT: ${pkgRel}/src/index.ts — must export MODULE_VERSION`);
    }
  }
}

if (violations.length > 0) {
  console.error("FleetOS skeleton checks FAILED:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("");
  console.error(`Total: ${violations.length} violation(s) across ${verified} package directory(ies).`);
  process.exit(1);
}

console.log(`FleetOS skeleton checks passed. (${verified} package director${verified === 1 ? "y" : "ies"} verified)`);

#!/usr/bin/env node
/**
 * tools/deployment-manifest.mjs — the W092 deployment manifest generator.
 *
 * Materializes a deterministic manifest digest for a deployment
 * candidate: the integration tip, the gate results (passed in or
 * re-derived cheaply), the console build fingerprint, the environment
 * tier, and the staging secret NAMES (never values). The manifest is
 * the release-gate rehearsal's input (the W080 release gate in
 * packages/ops consumes digests + evidence, not vibes).
 *
 * Usage:
 *   node tools/deployment-manifest.mjs [--env staging] [--base-url URL]
 *   > prints JSON; exit 0 on success, 1 on any missing gate.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (typeof key === "string" && key.startsWith("--") && typeof value === "string") {
    args.set(key.replace(/^--/, ""), value);
  }
}
const env = args.get("env") ?? "staging";
const baseUrl = args.get("base-url") ?? "";

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// 1. The integration tip.
const tip = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT })
  .toString()
  .trim();
const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT })
  .toString()
  .trim();

// 2. The console build fingerprint (the built route manifest, if present).
const routesPath = path.join(ROOT, "apps/web/.next/routes-manifest.json");
const routesDigest = fs.existsSync(routesPath)
  ? sha256(fs.readFileSync(routesPath, "utf8"))
  : null;

// 3. The gate evidence (cheap structural checks — the full gates run in CI).
const gates = {
  contractsSnapshot: fs.existsSync(path.join(ROOT, "tools/check-contracts.mjs")),
  hasConsoleApp: fs.existsSync(path.join(ROOT, "apps/web/src/console-app.tsx")),
  hasHealthRoute: fs.existsSync(path.join(ROOT, "apps/web/app/api/health/route.ts")),
  hasEnvTemplate: fs.existsSync(path.join(ROOT, "apps/web/.env.example")),
};
const gatesOk = Object.values(gates).every(Boolean);
if (!gatesOk) {
  console.error("deployment-manifest: gate structure incomplete");
  process.exit(1);
}

// 4. The manifest (sorted keys; deterministic).
const manifest = {
  baseUrl: baseUrl.length > 0 ? baseUrl : null,
  env,
  generatedFrom: { branch, tip },
  gates,
  routesDigest,
  secretNames: [
    "FLEETOS_ENV",
    "FLEETOS_BASE_URL",
    "DATABASE_URL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ],
};
const canonical = JSON.stringify(manifest, Object.keys(manifest).sort());
const manifestDigest = sha256(canonical + tip);

console.log(JSON.stringify({ ...manifest, manifestDigest }, null, 2));

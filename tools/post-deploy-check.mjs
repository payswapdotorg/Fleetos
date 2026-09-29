#!/usr/bin/env node
/**
 * tools/post-deploy-check.mjs — the W092 post-deploy health/evidence
 * acceptance check (docs/tech-lead/FREE-TIER-DEPLOYMENT.md).
 *
 * Against a DEPLOYED base URL, asserts:
 *   1. the console page loads and carries the rendered shell markers;
 *   2. the unknown-route path fails SAFELY (200 + the refusal state);
 *   3. /api/health returns healthy with the expected env tier;
 *   4. no provider secret VALUE appears in any served payload
 *      (credential leak scan — names are fine, values are not).
 *
 * Usage: node tools/post-deploy-check.mjs <baseUrl> [expectedEnv]
 * Exit 0 = accepted; 1 = any check failed (fail-closed).
 */
const baseUrl = process.argv[2];
const expectedEnv = process.argv[3] ?? "staging";

if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
  console.error("post-deploy-check: a base URL is required (http/https)");
  process.exit(1);
}

const failures = [];

async function fetchText(pathname) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
    redirect: "manual",
  });
  const text = await response.text();
  return { status: response.status, text };
}

// 1. The console loads with the rendered shell markers.
const home = await fetchText("/");
if (home.status !== 200) failures.push(`home status ${home.status}`);
for (const marker of ["FleetOS Console", "fos-scope"]) {
  if (!home.text.includes(marker)) failures.push(`home missing marker ${marker}`);
}

// 2. Unknown routes fail SAFELY (the catch-all renders the refusal).
const unknown = await fetchText("/not-a-real-area/view");
if (unknown.status !== 200) failures.push(`unknown-route status ${unknown.status} (expected the safe 200 refusal)`);

// 3. The health route.
let health = null;
try {
  const healthResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/api/health`);
  health = await healthResponse.json();
  if (healthResponse.status !== 200 || health.health !== "healthy") {
    failures.push(`health route not healthy: ${JSON.stringify(health).slice(0, 120)}`);
  }
  if (typeof expectedEnv === "string" && health.env !== expectedEnv) {
    failures.push(`health env ${health.env} != expected ${expectedEnv}`);
  }
} catch (error) {
  failures.push(`health route failed: ${String(error)}`);
}

// 4. Credential leak scan over the served payloads (values, not names).
const secretValues = [
  process.env.UPSTASH_REDIS_REST_TOKEN,
  process.env.R2_SECRET_ACCESS_KEY,
  process.env.R2_ACCESS_KEY_ID,
  process.env.DATABASE_URL,
]
  .filter((value) => typeof value === "string" && value.length > 8);
for (const value of secretValues) {
  for (const [label, payload] of [["home", home.text], ["unknown", unknown.text]]) {
    if (payload.includes(value)) {
      failures.push(`CREDENTIAL LEAK: a secret value appears in the ${label} payload`);
    }
  }
}

if (failures.length > 0) {
  console.error("post-deploy-check FAILED (fail-closed):");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      accepted: true,
      baseUrl,
      env: health?.env ?? null,
      checks: ["console-loads", "unknown-route-safe", "health-healthy", "no-credential-leak"],
    },
    null,
    2,
  ),
);

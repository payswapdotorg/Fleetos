#!/usr/bin/env node
/**
 * tools/deploy-staging.mjs — the W092 one-command staging deploy (Vercel Hobby).
 *
 * Creates-or-updates the `fleetos-staging` Vercel project (linked to
 * payswapdotorg/fleetos, rootDirectory apps/web, framework nextjs, bun
 * install), upserts the nine frozen staging secrets, triggers a production
 * deployment from the integration branch, waits for READY, then runs the
 * post-deploy acceptance check and emits the deployment manifest.
 *
 * Environment:
 *   VERCEL_TOKEN            (required) — a token with scope over the
 *                            personal/team scope that will host the project.
 *   VERCEL_TEAM_ID          (optional) — explicit team/scope id if needed.
 *   FLEETOS_STAGING_REF     (optional) — git ref to deploy (default
 *                            integration/wave0).
 *   FLEETOS_STAGING_NAME    (optional) — project name (default fleetos-staging).
 *   + the nine staging secrets themselves (read from the process env and
 *     upserted; DATABASE_URL / UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN /
 *     R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).
 *     R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY may be absent: the script marks
 *     them present only when non-empty and reports the gap fail-closed.
 *
 * Usage: node tools/deploy-staging.mjs
 * Exit 0 = deployed + accepted; 1 = any failure (fail-closed, no partial
 * success reported).
 */
import { execFileSync } from "node:child_process";

const API = "https://api.vercel.com";
const NAME = process.env.FLEETOS_STAGING_NAME ?? "fleetos-staging";
const REF = process.env.FLEETOS_STAGING_REF ?? "integration/wave0";
const REPO = "payswapdotorg/fleetos";
const TOKEN = process.env.VERCEL_TOKEN;
const TEAM_QUERY = process.env.VERCEL_TEAM_ID
  ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}`
  : "";

if (typeof TOKEN !== "string" || TOKEN.length < 8) {
  console.error("deploy-staging: VERCEL_TOKEN is required (a Vercel API token).");
  process.exit(1);
}

const failures = [];

function api(path, { method = "GET", body } = {}) {
  const response = execFileSync(
    "curl",
    [
      "-s",
      "-X",
      method,
      `${API}${path}${TEAM_QUERY}`,
      "-H",
      `Authorization: Bearer ${TOKEN}`,
      "-H",
      "Content-Type: application/json",
      ...(body === undefined ? [] : ["-d", JSON.stringify(body)]),
      "--max-time",
      "90",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(response);
}

// --- 1. Resolve the numeric repo id (the deployment git source needs it). ---
let repoId = null;
try {
  const gh = JSON.parse(
    execFileSync(
      "curl",
      ["-s", "-H", `Authorization: Bearer ${process.env.GITHUB_PAT ?? ""}`, `https://api.github.com/repos/${REPO}`, "--max-time", "30"],
      { encoding: "utf8" },
    ),
  );
  repoId = typeof gh.id === "number" ? String(gh.id) : null;
} catch {
  repoId = null;
}
if (!repoId) {
  failures.push("could not resolve the numeric GitHub repo id for the git source");
}

// --- 2. Create or find the project. ---
const projectSpec = {
  name: NAME,
  framework: "nextjs",
  rootDirectory: "apps/web",
  installCommand: "bun install",
  gitRepository: { repo: REPO, type: "github" },
};
let project = null;
try {
  const found = api(`/v9/projects/${encodeURIComponent(NAME)}`);
  if (found && typeof found.id === "string") {
    project = found;
    console.error(`project exists: ${found.id} (name ${found.name})`);
  }
} catch {
  /* not found -> create */
}
if (!project) {
  try {
    project = api("/v10/projects", { method: "POST", body: projectSpec });
    console.error(`project created: ${project.id} (name ${project.name})`);
  } catch (error) {
    failures.push(`project creation failed: ${String(error).slice(0, 200)}`);
  }
}

// --- 3. Upsert the nine staging secrets (7 always; the R2 S3 pair when set). ---
const secrets = [
  ["FLEETOS_ENV", "staging"],
  ["DATABASE_URL", process.env.DATABASE_URL],
  ["UPSTASH_REDIS_REST_URL", process.env.UPSTASH_REDIS_REST_URL],
  ["UPSTASH_REDIS_REST_TOKEN", process.env.UPSTASH_REDIS_REST_TOKEN],
  ["R2_ACCOUNT_ID", process.env.R2_ACCOUNT_ID],
  ["R2_ACCESS_KEY_ID", process.env.R2_ACCESS_KEY_ID],
  ["R2_SECRET_ACCESS_KEY", process.env.R2_SECRET_ACCESS_KEY],
  ["R2_BUCKET", process.env.R2_BUCKET],
];
if (project) {
  for (const [key, value] of secrets) {
    if (typeof value !== "string" || value.length === 0) {
      console.error(`env ${key}: ABSENT (not upserted — reported as a gap)`);
      continue;
    }
    try {
      api(`/v10/projects/${project.id}/env`, {
        method: "POST",
        body: { key, value, type: "encrypted", target: ["production", "preview"] },
      });
      console.error(`env ${key}: upserted`);
    } catch (error) {
      failures.push(`env upsert ${key} failed: ${String(error).slice(0, 160)}`);
    }
  }
}

// --- 4. Deploy: production deployment from the integration ref. ---
let deployment = null;
if (project && repoId) {
  try {
    deployment = api("/v13/deployments", {
      method: "POST",
      body: {
        name: NAME,
        target: "production",
        gitSource: { type: "github", repoId, ref: REF },
      },
    });
    console.error(`deployment triggered: ${deployment.id ?? deployment.uid}`);
  } catch (error) {
    failures.push(`deployment trigger failed: ${String(error).slice(0, 200)}`);
  }
}

// --- 5. Wait for READY (poll, bounded). ---
let readyUrl = null;
if (deployment) {
  const id = deployment.id ?? deployment.uid;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = api(`/v13/deployments/${id}`);
    if (status.readyState === "READY") {
      readyUrl = `https://${(status.alias ?? [])[0] ?? status.url}`;
      console.error(`deployment READY: ${readyUrl}`);
      break;
    }
    if (status.readyState === "ERROR" || status.readyState === "CANCELED") {
      failures.push(`deployment ${status.readyState}`);
      break;
    }
    execFileSync("sleep", ["10"]);
  }
  if (!readyUrl && !failures.length) failures.push("deployment never became READY (timeout)");
}

// --- 6. FLEETOS_BASE_URL + the acceptance check + manifest. ---
if (readyUrl) {
  try {
    api(`/v10/projects/${project.id}/env`, {
      method: "POST",
      body: { key: "FLEETOS_BASE_URL", value: readyUrl, type: "plain", target: ["production", "preview"] },
    });
    console.error(`env FLEETOS_BASE_URL: upserted (${readyUrl})`);
  } catch (error) {
    failures.push(`FLEETOS_BASE_URL upsert failed: ${String(error).slice(0, 160)}`);
  }
  // The base-url env lands for the NEXT build; redeploy once so it bakes in.
  try {
    const redeploy = api("/v13/deployments", {
      method: "POST",
      body: { name: NAME, target: "production", gitSource: { type: "github", repoId, ref: REF } },
    });
    const rid = redeploy.id ?? redeploy.uid;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const status = api(`/v13/deployments/${rid}`);
      if (status.readyState === "READY") { readyUrl = `https://${(status.alias ?? [])[0] ?? status.url}`; break; }
      if (status.readyState === "ERROR" || status.readyState === "CANCELED") { failures.push(`redeploy ${status.readyState}`); break; }
      execFileSync("sleep", ["10"]);
    }
  } catch (error) {
    failures.push(`redeploy failed: ${String(error).slice(0, 160)}`);
  }

  console.error(`\npost-deploy acceptance against ${readyUrl} ...`);
  try {
    execFileSync("node", ["tools/post-deploy-check.mjs", readyUrl, "staging"], { stdio: "inherit" });
    console.error("post-deploy-check: ACCEPTED");
  } catch {
    failures.push("post-deploy-check FAILED (see output above)");
  }
}

if (failures.length > 0) {
  console.error("\ndeploy-staging FAILED (fail-closed):");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.error(`\ndeploy-staging: ${readyUrl ?? "(no url)"} — staging deployment accepted.`);

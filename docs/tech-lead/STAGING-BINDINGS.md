# FleetOS Staging Provider Bindings (W092)

Record of the free-tier staging resources provisioned for the non-commercial
development/staging environment (docs/tech-lead/FREE-TIER-DEPLOYMENT.md).
Verified live at provisioning time; the deployment acceptance evidence lives
with the deployment (tools/post-deploy-check.mjs + tools/deployment-manifest.mjs).

## Neon Postgres (business truth)

- Project: `fleetos-staging` (id `orange-breeze-58163225`), org Tetevi (free plan)
- Region: `aws-us-east-1` (co-located with Vercel's default function region)
- Postgres: 17.11; database `neondb`; role `neondb_owner`
- Verified: live `select version()` / `select now()` round-trips from the TL
  sandbox on 2026-09-29 (`PostgreSQL 17.11 ... aarch64`).
- Secrets: `DATABASE_URL` (direct endpoint; the `-pooler` endpoint is recorded
  for pooled drivers as `DATABASE_POOL_URL` per the deployment plan).

## Upstash Redis (queue/cache/lock)

- Database: the operator's existing free-tier DB `polished-yeti-167554`
  (region global, active).
- Verified: REST `/ping` -> `{"result":"PONG"}` on 2026-09-29 with the
  current rest token (re-derived via the Upstash management API through the
  operator's MCP API key).
- Secrets: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

## Cloudflare R2 (evidence/artifacts)

- Account: `7e333607c4ceeef5d092be1bb94108bf` (verified via the account list).
- Bucket: `fleetos-staging-evidence` (Standard storage class, location ENAM),
  created 2026-09-29.
- Verified: a real object write round-trip on 2026-09-29 —
  `w092-binding-probe.txt` (75 bytes) stored with etag
  `9e9f8c8dc94da543eca42db30479cb02` and version id
  `7e5f1196961337ac8acdc694058bf65e`.
- Secrets: `R2_ACCOUNT_ID`, `R2_BUCKET` (above); `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` require an R2 API token created in the Cloudflare
  dashboard (object read & write scoped to this bucket) — recorded as a PENDING
  operator action while absent, never faked: the health route reports
  presence honestly and the deploy tool reports the gap fail-closed.
- Interim note: account-scoped object read/write is ALSO proven through the
  Cloudflare API directly (the round-trip above), so evidence export is
  functional before the S3-style keys arrive.

## Vercel Hobby (web/control plane)

- Target project: `fleetos-staging` (framework `nextjs`, rootDirectory
  `apps/web`, installCommand `bun install`), linked to
  `payswapdotorg/fleetos`, production deployments from `integration/wave0`.
- Deployment automation: `tools/deploy-staging.mjs` (create-or-find project,
  upsert the nine frozen staging secrets, deploy the integration ref, wait for
  READY, bake `FLEETOS_BASE_URL`, redeploy, then run the post-deploy
  acceptance). Requires a working `VERCEL_TOKEN` in the environment.
- Status at authoring time: the Composio-hosted Vercel OAuth tokens return
  403 for the personal scope ("ekonplacidegmailcoms-projects", SAML flag) —
  a fresh token (operator re-auth or direct API token) is a PENDING operator
  action. All other bindings are live (above).

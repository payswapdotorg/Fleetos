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
- 2026-09-29 note: the operator supplied a dedicated rate-limiting DB
  (`meet-ewe-145933.upstash.io`) — NXDOMAIN at deploy time (not provisioned /
  other-team scope; the free plan allows one DB per account, occupied by
  `ADCOS`). The deploy therefore uses the verified account DB
  `polished-yeti-167554.upstash.io` (REST PONG + SET/GET round-trip
  verified). Swap procedure when the dedicated DB resolves: upsert the two
  secrets on the Vercel project and redeploy (one command).

## Cloudflare R2 (evidence/artifacts)

- Account: `7e333607c4ceeef5d092be1bb94108bf` (verified via the account list).
- Bucket: `fleetos-staging-evidence` (Standard storage class, location ENAM),
  created 2026-09-29.
- Verified: a real object write round-trip on 2026-09-29 —
  `w092-binding-probe.txt` (75 bytes) stored with etag
  `9e9f8c8dc94da543eca42db30479cb02` and version id
  `7e5f1196961337ac8acdc694058bf65e`.
- Secrets: `R2_ACCOUNT_ID`, `R2_BUCKET` (above) + `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` — the operator supplied the S3-style keys
  (2026-09-29); a live SigV4 round-trip was verified from the TL sandbox
  (`w092-final-binding-probe.txt` PUT 200 etag cc5119ecdc13e610e3c88e5...,
  GET 200 body-match true). All five R2 secrets are now set on the project.
- Earlier interim (superseded): account-scoped read/write was already proven
  through the Cloudflare API directly before the keys arrived.

## Vercel Hobby (web/control plane)

- Target project: `fleetos-staging` (framework `nextjs`, rootDirectory
  `apps/web`, installCommand `bun install`), linked to
  `payswapdotorg/fleetos`, production deployments from `integration/wave0`.
- Deployment automation: `tools/deploy-staging.mjs` (create-or-find project,
  upsert the nine frozen staging secrets, deploy the integration ref, wait for
  READY, bake `FLEETOS_BASE_URL`, redeploy, then run the post-deploy
  acceptance). Requires a working `VERCEL_TOKEN` in the environment.
- Status: DEPLOYED + ACCEPTED (2026-09-29). The operator supplied a direct
  `VERCEL_TOKEN` (payswaporg scope) which works: project
  `prj_tY1B5b7x9X13THwsZMh8HtXfIk52` created, all nine secrets set
  (`/v10/projects/<id>/env`), production deployments `dpl_N9UGh5WLsVgMvyB4Dc3Erwm7ssUJ`
  and (after the `FLEETOS_BASE_URL` bake) `dpl_121D7aHTidgtdWTpBNVCbR7rLmHN`
  both READY. Live URL: https://fleetos-staging-flame.vercel.app —
  post-deploy acceptance `accepted: true` (console-loads, unknown-route-safe,
  health-healthy, no-credential-leak); health route reports all nine secrets
  present; deployment manifest digest
  `1a3dea656038255e2b6e70bd3dc006ad1c25e2bb1ed5f4a98416f83b20e90c73`.
  (Earlier Composio OAuth 403/SAML scope issue is moot for the direct-token
  path; the Composio connections still authenticate for user-level calls.)

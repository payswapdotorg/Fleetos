# STATUS: W092 BASELINE — CURRENT BINDINGS VERIFIED; PRODUCTIZATION EXTENSION IS docs/tech-lead/FREE-TIER-PROVIDER-MATRIX.md

# FleetOS Free-Tier Deployment Plan

## Current status

FleetOS is **not currently deployed as a rendered web application** from this repository.

The repository has the W080 production-readiness domain/ops contracts, but it does not yet contain:
- a Next.js application;
- a Vercel project configuration;
- provider environment-variable templates;
- live Neon/Upstash/R2 bindings;
- a rendered browser E2E deployment.

The follow-on plan uses free-tier offerings for a non-commercial development/staging environment.

## Target stack

### Web/control plane

**Vercel Hobby** for the first rendered preview/staging deployment.

Current Hobby limits include 4 CPU-hours, 1,000,000 function invocations, 100 GB-hours of function duration, 360 GB-hours of provisioned memory and one concurrent build; Vercel also limits Hobby cron jobs to once per day. citeturn839632search0turn996560search4turn996560search0

Important legal constraint:

Vercel states that the Hobby plan is for personal/non-commercial use. FleetOS must therefore treat Vercel Hobby as **development/staging/demo only**. A commercial production FleetOS deployment on Vercel requires Pro or Enterprise. citeturn839632search1turn839632search6

### PostgreSQL

**Neon Free**

Current Free limits are 100 projects, 10 branches per project, 100 CU-hours per project/month, 0.5 GB storage per project, 5 GB public network transfer per project/month, scale-to-zero after 5 minutes and up to 2 CU autoscaling. citeturn571110search2turn571110search3

Use Neon as the authoritative business database.

Never move domain truth into Redis or object storage.

### Queue/cache/lock

**Upstash Redis Free**

Current Free limits are 256 MB data, 500,000 commands/month and 10 GB monthly bandwidth. citeturn996560search1

Use Redis only for:
- queues;
- cache;
- locks;
- ephemeral coordination.

Do not store Device Twin, audit, policy, intent, procurement, recovery or release truth there.

### Evidence/artifacts

**Cloudflare R2 Standard**

Current free usage is 10 GB-month storage, 1 million Class A operations/month and 10 million Class B operations/month, with free egress. citeturn996560search2

Use R2 for:
- evidence attachments;
- exported audit/evidence bundles;
- release/build artifacts;
- backup artifacts appropriate for the staging/demo environment.

Do not place authoritative relational state here.

## Deployment topology

Browser
  |
  v
Vercel / Next.js control plane
  |
  +--> Neon Postgres (business truth)
  |
  +--> Upstash Redis (queue/cache/lock)
  |
  +--> Cloudflare R2 (evidence/artifacts)
  |
  +--> external provider adapters
        |
        +--> ADCOS
        +--> Arena
        +--> Aurum

Device agents / LAN / printer connectors
  |
  +--> FleetOS API/control plane
  |
  +--> never trust edge data as business truth

## Environment strategy

### Development

Local Next.js + Bun workspace with local/mock adapters.

### Staging / public demo

- Vercel Hobby
- Neon Free project
- Upstash Free database
- R2 Standard free tier
- synthetic/demo tenant data only

### Commercial production

Keep the same architecture and contracts but move the web tier to a plan that permits commercial use (Vercel Pro/Enterprise if staying on Vercel) and increase storage/queue/observability capacity as required.

The provider-neutral application contracts do not change.

## Runtime shape

The Next.js application should contain:

- server-rendered/route-level composition;
- API route handlers for authenticated control-plane operations;
- tenant resolution at the server boundary;
- public domain/UI-contract consumption only;
- no direct browser access to provider credentials;
- no provider SDKs in domain packages.

Device agents remain outside the Vercel runtime.

## Free-tier scheduling constraint

Do not make FleetOS correctness depend on an hourly/minute Vercel Hobby cron.

Hobby cron runs only once per day and timing within the hour is not guaranteed. citeturn996560search0turn996560search5

For the free-tier staging deployment:
- user/device events should drive immediate work;
- API-triggered tasks should be idempotent;
- daily cron is reserved for low-frequency housekeeping/demo jobs;
- continuous background workers remain an explicit later production deployment concern.

## Provider bindings

Required staging secrets:

- `DATABASE_URL`
- `DATABASE_POOL_URL` when needed by the selected driver
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `FLEETOS_ENV`
- `FLEETOS_BASE_URL`

Never expose provider credentials to client-side bundles.

## Database plan

The worker/TL implementation should create a minimal relational schema for the current accepted domain stores, preserving their already-tested invariants:

- tenant/identity;
- Device Twin;
- observation/event ledger;
- health/diagnosis;
- security findings;
- policies/Guardian;
- actions/print;
- workloads/recommendations;
- procurement/vendors/software;
- maintenance;
- recovery;
- integration evidence;
- learning/adoption;
- release/deployment evidence.

Every table must preserve tenant ownership explicitly.

## Migration/backup plan

- migrations are represented as the existing digest-chained W080 MigrationSet model;
- every migration must run idempotently and fail closed;
- the frozen contracts surface must never be altered by a migration;
- staging backup artifacts may be exported to R2;
- restore drills must satisfy the existing W080 evidence gate;
- free-tier staging backup retention must be treated as a prototype limitation, not as a production SLA.

## CI/CD

GitHub Actions:
1. install exact Bun version;
2. architecture/ownership/skeleton/contract checks;
3. full typecheck;
4. full test suite;
5. build the Next.js application;
6. optionally materialize the deployment manifest digest.

Vercel:
- preview deployment for pull requests;
- staging deployment from the designated integration branch;
- production promotion only after the W080 release gate yields `release_approved` and a human performs the promotion.

## Deployment acceptance

A staging deployment is accepted only after:
- rendered console loads;
- tenant isolation checks pass;
- core browser journeys complete;
- evidence trail is visible;
- a release manifest is produced;
- ops health is healthy;
- the contracts snapshot remains unchanged;
- no provider credential reaches browser code.

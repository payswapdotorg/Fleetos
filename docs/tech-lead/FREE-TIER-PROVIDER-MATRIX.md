# FleetOS Free-Tier Provider Matrix

STATUS: PRODUCTIZATION DEPLOYMENT CONTRACT — 2026-09-30

## Current verified staging providers

### Vercel Hobby

Role: Next.js control plane.

Use for: non-commercial staging/demo.

Important: the Hobby plan is restricted by Vercel to personal/non-commercial use. FleetOS must not describe it as commercial production.

### Neon Free

Role: authoritative PostgreSQL business store.

Use for:

- tenant/user/session state;
- device and workload durable state;
- intents;
- audit/evidence indexes;
- migrations.

Neon is the authority. Do not move truth into Redis or R2.

### Upstash Redis Free

Role: cache, lock, queue and transient coordination.

Current free plan: 256 MB data, 500K commands/month and 10 GB monthly bandwidth.

Use only for ephemeral coordination. Enforce environment and tenant key namespacing.

### Cloudflare R2 Standard

Role: evidence, artifact and release-object storage.

Current free tier: 10 GB-month storage, 1 million Class A operations/month and 10 million Class B operations/month, with free Internet egress.

Use for:

- evidence attachments;
- release artifacts;
- install-package metadata/artifacts where appropriate;
- backup artifacts in staging.

### Apify Free

Role: optional data-discovery enrichment for vendor/catalog/market research workflows.

Current free plan: $0 with $5 of platform usage credit; when the free usage budget is exhausted, platform access is blocked until the next cycle.

Apify must remain:

- adapter-only;
- non-authoritative;
- rate/cost guarded;
- explicitly attributable in evidence;
- optional, so core FleetOS operation works without it.

### Resend Free

Role: optional email delivery for magic-link login, invitations and operational notifications.

Current free plan: 3,000 emails/month with a 100-email/day limit.

Resend is a communication adapter only. FleetOS remains the operational authority.

## Environment strategy

### Local

- Bun workspace;
- local/in-memory adapters;
- deterministic demo tenant;
- no provider credentials committed.

### Staging/demo

- Vercel Hobby;
- Neon Free;
- Upstash Redis Free;
- Cloudflare R2 Free;
- optionally Apify Free;
- optionally Resend Free;
- synthetic/demo data plus explicitly created staging tenants.

### Commercial production

Keep the same application/domain contracts but migrate:

- Vercel Hobby -> commercial Vercel plan or another compatible web platform;
- free-tier persistence/queues/storage -> paid capacity as required;
- optional Apify/Resend -> paid capacity if actual usage requires it.

## Secrets

The repository may document names and scopes but never values.

Required categories:

- PostgreSQL connection;
- Redis URL/token;
- R2 account/bucket/access pair;
- Vercel deployment token;
- Apify token, when enabled;
- Resend token, when enabled;
- session/auth signing secret.

Client bundles must contain none of these provider credentials.

## Provider acceptance

Every provider adapter must have:

- a provider-neutral domain seam;
- deterministic normalization;
- error/refusal mapping;
- retry/idempotency strategy where applicable;
- health probe;
- evidence reference;
- feature flag or availability state for optional providers.

Provider SDKs belong only under integration/adapter packages or runtime composition. Core domain packages remain provider-neutral.

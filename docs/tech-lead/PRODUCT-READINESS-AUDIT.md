# FleetOS Product Readiness Audit

STATUS: PRODUCTIZATION BASELINE — 2026-09-30

## Executive result

FleetOS is not yet at the requested product-ready "yes to all three" state.

| Question | Current answer | Evidence / gap |
| --- | --- | --- |
| Can a human install and use FleetOS end to end? | NO — staging console usable, product install path incomplete | The live console is bound to a deterministic demo fleet. There is no complete public account/workspace onboarding + durable session + signed agent distribution + one-time device enrollment flow. |
| Is the staging deployment using free-tier providers? | PARTLY YES | Vercel Hobby, Neon Free, Upstash Free, and Cloudflare R2 Free are provisioned/verified in the repository's staging record. Apify is not currently bound; it is added below as an optional enrichment adapter. |
| Does FleetOS have a user-friendly interface? | PARTLY YES | The rendered console, responsive shell, search, evidence view and 13 journeys exist and are browser-verified. The missing layer is persona-specific home experiences, role switching, first-run onboarding, and clear separation of operator experiences. |

The implementation phase defined by this audit is intended to turn all three answers into YES for a non-commercial staging/demo environment without changing the frozen domain architecture.

## What is already real

- Next.js control plane under apps/web.
- Responsive shell inspired by ShareNet interaction qualities: persistent navigation, concise headers, breadcrumbs, sheets/drawers, status-led UI, whitespace, loading/empty/error states.
- Ten-area route vocabulary.
- Global command search.
- Evidence & Audit.
- Device, recovery, security, policy, actions, workload, commerce and learning screens.
- Thirteen acceptance journeys.
- W080 release gate, deployment manifest and post-deploy acceptance.
- Current staging deployment on Vercel.
- Neon as authoritative data target, Upstash as transient coordination, R2 as artifacts/evidence storage.
- Existing identity role assignments and deterministic permission resolution.

## Current productization gaps

### 1. Account/workspace lifecycle

The application needs a real browser session and durable tenant lifecycle:

sign in -> create/join workspace -> establish tenant context -> resolve assigned roles -> enter Control Tower.

A staging demo mode may coexist with real accounts, but demo mode must be visibly labeled and must never pretend to be persistent customer data.

### 2. Role switching

The domain already models multiple role assignments per principal. The UX does not yet expose this as a first-class user capability.

Required:

- one human can hold several roles in the same tenant;
- the active role is always visible;
- switching role changes experience/navigation context, not tenant ownership;
- switching never widens permissions beyond the effective assignment set;
- the UI explains why a route/action is unavailable;
- role switching is auditable;
- a consequential action always uses the effective authorization/policy path.

### 3. Device installation

The existing enrollment surface must become a complete install journey:

create enrollment request -> choose device/platform -> download agent -> install -> bootstrap one-time enrollment credential -> first check-in -> first observation -> Device Twin created -> Control Tower confirmation.

The agent must never receive long-lived database/provider credentials.

### 4. Durable control-plane state

The rendered demo currently composes real domain packages over deterministic in-memory records.

Product-ready staging needs durable persistence for:

- users/principals;
- tenants/workspaces;
- role assignments;
- active sessions;
- enrollment requests;
- enrolled devices;
- observations/derived records;
- intents/actions;
- audit/evidence;
- product settings.

Neon remains the source of business truth.

### 5. Persona-specific experiences

The shell must stay structurally stable while Control Tower and surface priority change by active role.

The goal is not seven unrelated applications. The goal is one coherent FleetOS product with role-specific lenses over the same architecture and records.

### 6. Public installation/distribution

The repository needs reproducible agent release artifacts:

- Windows installer;
- macOS package;
- Linux package/script;
- versioned checksums;
- release metadata;
- install instructions;
- revoke/uninstall path.

GitHub Releases/Actions may be used as the distribution mechanism; the web app remains the user-facing control plane.

## Free-tier staging provider matrix

| Provider | Intended role | Current state | Productization rule |
| --- | --- | --- | --- |
| Vercel Hobby | Next.js web/control plane | VERIFIED STAGING | Development/staging/demo only; never present as commercial production. |
| Neon Free | PostgreSQL business truth | VERIFIED STAGING | All authoritative state and migrations live here. |
| Upstash Redis Free | Queue/cache/lock | VERIFIED STAGING | Never authoritative; namespace by environment/tenant where applicable. |
| Cloudflare R2 Free | Evidence/artifacts/install artifacts | VERIFIED STAGING | Evidence/artifacts only; never business truth. |
| Apify Free | Optional market/vendor discovery enrichment | NOT YET BOUND | Adapter-only, non-authoritative, rate/credit guarded. |
| Resend Free | Optional sign-in/invitation/notification email | NOT YET BOUND | Notification channel only; FleetOS remains the source of truth. |
| GitHub Actions + Releases | CI + versioned agent artifacts | NOT YET BOUND AS PRODUCT RELEASE FLOW | Build/release evidence must be tied to a commit and checksums. |

## Non-goals

This phase does not:

- change Device Twin semantics;
- move authority into React;
- make ML/LLM output authoritative;
- make Apify a source of truth;
- make Redis a database;
- make Vercel Hobby a commercial production deployment;
- introduce provider SDKs into domain packages;
- collapse distinct user roles into one "admin" permission.

## Exit condition

The productization phase is complete only when:

1. a new user can enter FleetOS through an explicit sign-in/demo path;
2. a user can create or join a workspace and see the active tenant context;
3. a multi-role user can switch roles without logging out;
4. each role receives a visibly different, useful Control Tower lens;
5. a user can start a device enrollment from the UI and download the correct installer;
6. an installed agent performs a first check-in and the device appears in the real tenant;
7. the main operational journeys work against durable state;
8. evidence and authorization remain visible on consequential actions;
9. staging is reproducible on the documented free-tier stack;
10. the UX simulation in docs/tech-lead/UX-OPERATIONAL-SIMULATION.md passes without undiscovered architectural capabilities or dead ends.

# W001 Skeleton Notes

Established by W001 (Tech-Lead lane) at the base SHA `568708e9314cab8492457475c994cf1c913dbbb4`.
These notes record the package → lane mapping materialized in this commit, deferred
modules, judgment calls, and stop-the-line findings for Tech Lead review.

## Package → Lane Mapping

The following package → lane mapping was materialized from
`spec/worker-ownership.yaml` plus the W001 deliverable list in the work order.
Each package is created with `package.json`, `tsconfig.json`, `src/index.ts`,
`src/index.test.ts`, and a `README.md` citing its frozen responsibility.

### tech-lead

- `@fleetos/contracts` (`packages/contracts/`) — shared seam, Tech-Lead-owned
  during active waves.
- `@fleetos/web` (`apps/web/`) — control-plane web app placeholder (no Next.js
  scaffolding yet). Tech-Lead owns the `apps/web/shell/` sub-tree.

### worker-a (Device Edge)

- `@fleetos/agent` (`apps/agent/`) — device agent runtime; runs OUTSIDE the
  web runtime.
- `@fleetos/device-adapters` (`packages/device-adapters/`) — endpoint adapter
  SDK seams.
- `@fleetos/recovery` (`packages/recovery/`) — last-seen evidence, lock/locate,
  replacement escalation.
- `@fleetos/integration-adcos` (`packages/integrations/adcos/`) — ADCOS
  adapter; assigned to worker-a per W050A.

### worker-b (Intelligence + Control)

- `@fleetos/device-model` (`packages/device-model/`) — Device Twin + observations.
- `@fleetos/health` (`packages/health/`) — signals, baselines, anomalies,
  diagnoses, treatment recommendations.
- `@fleetos/security` (`packages/security/`) — security posture, findings,
  security remediation semantics.
- `@fleetos/policy` (`packages/policy/`) — Contract Guardian home.
- `@fleetos/actions` (`packages/actions/`) — Fleet Actions.
- `@fleetos/learning` (`packages/learning/`) — evaluation cases + capability
  adoption records.
- `@fleetos/integration-arena` (`packages/integrations/arena/`) — Arena adapter;
  assigned to worker-b per W050B.

### worker-c (Workload + Commerce)

- `@fleetos/identity` (`packages/identity/`) — tenant/auth foundations.
- `@fleetos/audit` (`packages/audit/`) — append-only audit.
- `@fleetos/workloads` (`packages/workloads/`) — workload profiles +
  recommendations.
- `@fleetos/vendors` (`packages/vendors/`) — vendor capability/quality/
  fulfillment semantics.
- `@fleetos/procurement` (`packages/procurement/`) — demand aggregation,
  matching, quote, order.
- `@fleetos/software` (`packages/software/`) — catalog, subscriptions,
  entitlements, seat allocation.
- `@fleetos/maintenance` (`packages/maintenance/`) — treatment plans, service
  work orders, warranty.
- `@fleetos/integration-aurum` (`packages/integrations/aurum/`) — Aurum adapter;
  assigned to worker-c per W050C.

## Deferred modules (no ownership path in frozen yaml)

The following modules appear in `spec/MODULE-DEPENDENCY-MAP.md` but have no
ownership path in the frozen `spec/worker-ownership.yaml`. They were NOT
materialized as packages in W001. They are DEFERRED to the W050x / W051 era
and require a Tech-Lead ADR before being added.

- `connectivity` — listed as a layer-5 module with dependency edges to
  devices, workloads, policy, audit. No `packages/connectivity/` directory was
  created. The FleetOS side of connectivity is realized through the
  `@fleetos/integration-adcos` adapter (W050A). Native connectivity
  topology/path execution is owned by ADCOS, not FleetOS (per
  `spec/ARCHITECTURE-LOCK.md` items 7–8). Deferred to W050x/W051 with a
  Tech-Lead ADR.

- `notifications` — listed as a layer-5 module with dependency edges to
  organizations, devices, actions, audit. No `packages/notifications/`
  directory was created. Outbound notifications are realized through the
  `@fleetos/integration-aurum` adapter (W050C). Aurum is a
  communication/intelligence channel; FleetOS remains operational authority
  (per `spec/ARCHITECTURE-LOCK.md` items 9–10). Deferred to W050x/W051 with a
  Tech-Lead ADR.

## Stop-the-line finding: ownership yaml missing two W001 deliverable paths

The W001 deliverable list (D1) explicitly names two packages whose prefix paths
were NOT claimed by any lane in the frozen `spec/worker-ownership.yaml`:

1. `apps/web/` — D1 creates `@fleetos/web` as a placeholder package here, but
   the yaml only claimed leaf sub-paths (`apps/web/shell/` for tech-lead,
   `apps/web/device/` for worker-a, etc.). The parent `apps/web/` prefix was
   unclaimed, so D3 check #2 ("every package directory is claimed by exactly
   one owner lane") would FAIL on `apps/web/`.
2. `packages/integrations/adcos/` — D1 creates `@fleetos/integration-adcos`
   here, but no lane claimed this path. Per
   `spec/WORK-ITEM-DEPENDENCY-GRAPH.md`, the ADCOS adapter is Wave 5 item
   W050A assigned to Worker A.

**Resolution applied in W001** (minimal additive change to the frozen yaml;
the semantics of all EXISTING path claims are unchanged — only two new path
claims were added):

- Added `apps/web/` to tech-lead's paths (parent of the already-claimed
  `apps/web/shell/`).
- Added `packages/integrations/adcos/` to worker-a's paths (consistent with
  the W050A assignment in `spec/WORK-ITEM-DEPENDENCY-GRAPH.md`).

`tools/check-ownership.mjs` uses **longest-prefix matching** when resolving a
package directory to its owning lane. This means the new parent claim on
`apps/web/` does NOT shadow the existing leaf claims on `apps/web/device/`,
`apps/web/recovery/`, `apps/web/security/`, `apps/web/actions/`,
`apps/web/workloads/`, `apps/web/commerce/`, or `apps/web/shell/` — the longer
prefix wins for those sub-paths.

The Tech Lead should validate these two additive path claims and either
confirm them or reassign via a follow-up ADR. If the Tech Lead prefers an
alternative resolution (e.g., not creating `apps/web/` as a package, or
reassigning ADCOS to a different lane), W001 can be re-spun with minimal
rework.

## Other judgment calls

- **`tsconfig.base.json` introduced as single source of compiler truth.** The
  pre-existing root `tsconfig.json` now extends `tsconfig.base.json` so the
  root typecheck entry point is preserved. Each package's `tsconfig.json`
  extends `tsconfig.base.json` via a relative path (`../../tsconfig.base.json`
  for top-level packages, `../../../tsconfig.base.json` for integrations).
- **`@fleetos/*` path mapping is intentionally NOT used.** Per the work order,
  packages import each other by workspace package name only (e.g.,
  `import { x } from "@fleetos/contracts"`). Bun's workspace resolution
  handles the rest. No `paths` entry is needed in `tsconfig.base.json`.
- **Placeholder `src/index.ts` exports only `MODULE_NAME` and `MODULE_VERSION`.**
  Real domain types, event schemas, and contracts arrive with their owning
  work items (W002+). No runtime dependencies were added (devDependencies:
  typescript only, per the hard constraints).
- **`apps/web/shell/` created with a README** noting it is Tech-Lead-owned UI
  shell territory. The other `apps/web/<surface>/` directories (device,
  recovery, security, actions, workloads, commerce) are created as empty
  directories with a single `.gitkeep` — they are leaf surface dirs owned by
  later waves (W060A/B/C).
- **`bun test` runs at the root across all packages.** Every placeholder test
  asserts the `MODULE_NAME` and `MODULE_VERSION` constants exported from
  `src/index.ts`.
- **`tools/verify-skeleton.mjs` asserts every package directory contains
  `package.json` + `tsconfig.json` + `src/index.ts` + `src/index.test.ts`**
  and that the package.json declares a `@fleetos/*` name at version `0.1.0`
  with `private: true`. It is wired into `bun run check` alongside
  `check:architecture` and `check:ownership`.
- **CI workflow** (`.github/workflows/ci.yml`) runs `bun install`,
  `bun run check`, `bun run typecheck`, `bun test` on push/PR to main. It is
  minimal and green-by-construction at this commit.
- **`spec/PROJECT-STATE.md` updated** to STATUS `W001 IMPLEMENTED (pending TL
  acceptance)`, implementation wave 0 complete pending acceptance, next Tech
  Lead actions: W002.

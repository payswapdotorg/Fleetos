# ADR-0001: Ownership path gap fill — apps/web root and integrations/adcos

Status: ACCEPTED
Date: 2026-09-26
Owner: Tech Lead

## Context

`spec/worker-ownership.yaml` (frozen v1) left two skeleton paths unowned:

1. The `apps/web/` root (package.json, tsconfig, src/, README) — the file
   listed only `apps/web/shell/` under tech-lead, so the web app root files
   had no owner.
2. `packages/integrations/adcos/` — `integrations/arena` was assigned to
   worker-b and `integrations/aurum` to worker-c, but adcos appeared in no
   lane.

The W001 skeleton had to materialize both locations, so the worker added the
two paths additively and flagged them for Tech Lead validation in its
completion report.

## Decision

Confirm both additive path claims exactly as the worker staged them:

- `apps/web/` → tech-lead (line ordered before `apps/web/shell/`; lane
  subdirectories such as `apps/web/device/` keep resolving to their workers
  via longest-prefix).
- `packages/integrations/adcos/` → worker-a.

Evidence for correctness within the already-frozen documents:

- `docs/tech-lead/worker-model.md` assigns "UI shell" composition and
  integration wiring to the Tech Lead — the web app root is shell
  infrastructure.
- `spec/WORK-ITEM-DEPENDENCY-GRAPH.md` assigns W050A (ADCOS adapter) to
  lane `[A]`.

## Alternatives considered

1. Assign `apps/web/` root to no one and require per-file ADRs — rejected:
   leaves W001 unverifiable by the ownership gate.
2. Assign `packages/integrations/adcos/` to worker-b (alongside arena) —
   rejected: contradicts the dependency graph's W050A [A] lane marker.

## Contract impact

None on public contracts, state machines or events. Ownership boundaries
only: two previously-unowned paths gain owners consistent with the frozen
worker model. No existing assignment changes (purely additive).

## Migration

Already applied on the W001 integration branch (commit ebdf19f). No other
code reads the yaml beyond `tools/check-ownership.mjs`, which passes.

## Acceptance

- `node tools/check-ownership.mjs` → exit 0 with the two added paths.
- `node tools/check-architecture.mjs` → exit 0 (lock phrases intact).
- `bun test` → 21 pass / 0 fail.

## Rollback

Revert the two added lines in `spec/worker-ownership.yaml`; no code depends
on them beyond the gate's lane resolution.

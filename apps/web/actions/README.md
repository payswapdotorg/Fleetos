# @fleetos/web-actions — Fleet Actions + print workflow UI surface lane (W060B, worker-b)

Read-only, provider-neutral presentation view-models for the FleetOS
actions domain: the W041 Fleet Action surfaces — group selection,
policy-gated plan transitions rendered as an EXPLICIT state machine
(PROPOSAL → approval → dispatch, parked states visible, refusal states
machine-stable) — and the print orchestration surface (printer routing
with capability-based routing refusals visible, never emulated).

## What this lane is (and is NOT)

This lane delivers pure, typed, deterministic **UI SURFACE contracts** —
view-models and explicit state machines consumed by a renderer. It is
NOT a rendered app: the shell, navigation and journeys arrive with W061
(Tech Lead). Every module here is:

- **Pure** — no wall clock, no randomness, no I/O. Every instant is
  injected by the caller.
- **Deterministic** — the same inputs produce byte-identical views
  regardless of input order (proven by test).
- **Tenant-scoped** — every builder takes an acting tenant scope as its
  first parameter and REFUSES cross-tenant records with a tagged error
  (fail-closed, by-rejection isolation).
- **Read-only** — outputs are deeply frozen; no view carries a mutation
  or dispatch path.
- **Gated, never one-click** — destructive/gated plan transitions carry
  their gate (`guardian_decision` / `human_approval`) and confirmation
  requirement (ARCHITECTURE-LOCK item 16); an APPROVED plan discloses
  that dispatch is downstream, never executed on this surface.
- **Never emulated** — the print surface presents the router's DECLARED
  capability outcomes verbatim: a REFUSED job carries the
  machine-stable `unsupported_feature:*` reasons and NO printer; the
  surface never suggests a fallback printer and never re-routes.

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`): `apps/web/actions/`.

## Structural seams (the W040-disclosed pattern)

`src/` imports the shared seam `@fleetos/contracts` ONLY (bound via the
relative package-source path, because this nested surface lane is not a
bun workspace member — the root workspace globs reach `apps/*`, not
`apps/web/*`; `tools/check-ownership.mjs` resolves the relative import
to the shared-seam package and skips it). Domain shapes are consumed
through locally-declared STRUCTURAL seam types
(`src/surface-contracts.ts`) that the real W041 records structurally
satisfy (`ActionPlanTemplate`, `DeviceGroupSelector`,
`PrintJobRequest`, `PrinterDescriptor`, the frozen `GuardianDecision`).
The real binding is proven by tests in `test/` (which MAY import across
lanes per the W060 work order):

- `test/binding-actions.test.ts` — the REAL W041 actions package
  (`createActionPlan` + `resolveActionTargets` +
  `submitActionPlan` + `approveParkedPlan` + `transitionActionPlan` +
  `routePrintJob` + `enqueuePrintJob`) drives every surface builder
  end-to-end, and the surface's local frozen tables are proven EQUAL to
  the real tables (transition table, decision-to-status mapping,
  terminal statuses, capability gate) — no re-declaration drift.
- `test/src-discipline.test.ts` — src files import ONLY the shared
  seam; no `any`; no clock/randomness/IO tokens in src.

The W061 shell binds the seams at its binding sites and renders these
view-models.

## Module map

- `src/surface-contracts.ts` — tenant scope + the structural seam types
  (plan records, device-group selectors, print jobs, printers, the
  frozen Guardian decision) + the frozen decision-type tables.
- `src/internal.ts` — local pure helpers (freezing, ISO checks,
  canonical ordering, tagged surface errors).
- `src/decision-context.ts` — the Guardian decision context projection
  (observable fields only; validation shared by both surfaces).
- `src/action-plans-view.ts` — group selection view + the plan
  presentation state machine + the plan progression (explicit
  transitions with gates).
- `src/print-routing-view.ts` — the print routing presentation (routing
  refusals visible, never emulated) + the capability-gate mirror.
- `src/index.ts` — the public surface.

## Typecheck

The root `tsconfig.json` include patterns reach `apps/*/src/**` only
(the parent `apps/web/` is Tech-Lead-owned; extending the root include
is a cross-cutting change reserved for the TL). This lane therefore
carries its own `tsconfig.json` (strict, src + test + shared bun-test
ambient types) and is typechecked locally:

    bunx tsc --noEmit -p apps/web/actions/tsconfig.json

W061 wires lane typechecking into the root gate when the shell lands.

No runtime dependencies. No `any` in public signatures. Strict TS.

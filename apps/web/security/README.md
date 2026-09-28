# @fleetos/web-security — Security/policy UI surface lane (W060B, worker-b)

Read-only, provider-neutral presentation view-models for the FleetOS
security/policy domain: the W031 Security Doctor findings surface, the
Contract Guardian decision surface (ALLOW / WARN / REQUIRE_APPROVAL /
BLOCK with machine-stable reasons, matched rules and opaque evidence
refs), the parked-approvals queue surface (REQUIRE_APPROVAL items
awaiting human decision, with their approval transitions), and the
read-only BLOCK history surface.

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
  (fail-closed, by-rejection isolation — never silently filtered).
- **Read-only** — outputs are deeply frozen; no view carries a mutation
  or dispatch path.
- **Proposal-disciplined** — recommended remediations are surfaced as
  DRAFT proposals (no intent id, no lifecycle status, no execution
  path). Destructive/gated paths are NEVER one-click: the surface
  exposes the gated transition with its decision context
  (ARCHITECTURE-LOCK items 16 and 19).
- **Observable-evidence-only** — the Guardian NEVER asserts unobservable
  employee intent (ARCHITECTURE-LOCK item 11): surfaces display the
  engine's machine-stable reasons, matched rules and evidence refs, and
  nothing else.

## Ownership

Lane: `worker-b` (per `spec/worker-ownership.yaml`): `apps/web/security/`.

## Structural seams (the W040-disclosed pattern)

`src/` imports the shared seam `@fleetos/contracts` ONLY. Since the W061
[TL] normalization, this lane is a proper bun workspace member
(`apps/web/*` is in the root workspaces array; `package.json` present),
so the seam is imported by package specifier exactly like every other
package. No domain package (`@fleetos/security`, `@fleetos/policy`,
`@fleetos/actions`, ...) is imported from `src/`.

(History: W060B originally shipped as a plain folder with the seam bound
via a relative import of the contracts package source — a disclosed form
deviation the Tech Lead normalized in the W061 acceptance; see
`docs/tech-lead/SKELETON-NOTES.md` § Wave 6.)

Domain shapes are consumed through locally-declared STRUCTURAL seam
types (`src/surface-contracts.ts`) that the real domain records
structurally satisfy. The real binding is proven by tests in `test/`
(which MAY import across lanes per the W060 work order):

- `test/binding-security.test.ts` — the REAL W031 Security Doctor
  (`assessSecurityPosture`, findings ledger active view) feeds the
  findings surface; the REAL Guardian engine
  (`compileGuardianRuleSet` + `evaluateGuardianRequest`) feeds the
  decision surface and the BLOCK history; the REAL W041 policy gate
  (`submitActionPlan` / `approveParkedPlan`) feeds the parked
  approvals queue end-to-end.
- `test/src-discipline.test.ts` — src files import ONLY the shared
  seam; no `any`; no clock/randomness/IO tokens in src.

The W061 shell binds the seams at its binding sites (e.g. the real
findings ledger's derived active view, the real Guardian evaluation
results) and renders these view-models.

## Module map

- `src/surface-contracts.ts` — tenant scope + the structural seam types
  (finding records, Guardian decision/evaluation records, guarded
  approval items) the domain packages satisfy.
- `src/internal.ts` — local pure helpers (freezing, ISO checks,
  canonical ordering, tagged surface errors). No domain imports.
- `src/findings-view.ts` — the findings list view-model (severity
  ordering machine-stable; evidence refs opaque; remediations as
  PROPOSALs).
- `src/guardian-decision-view.ts` — the Guardian decision presentation
  + the read-only BLOCK history view.
- `src/approvals-queue-view.ts` — the parked approvals queue
  (REQUIRE_APPROVAL items with their approval transitions).
- `src/index.ts` — the public surface.

## Typecheck

The root `tsconfig.json` include patterns reach `apps/*/src/**` only
(the parent `apps/web/` is Tech-Lead-owned; extending the root include
is a cross-cutting change reserved for the TL). This lane therefore
carries its own `tsconfig.json` (strict, src + test + shared bun-test
ambient types) and is typechecked locally:

    bunx tsc --noEmit -p apps/web/security/tsconfig.json

W061 wires lane typechecking into the root gate when the shell lands.

No runtime dependencies. No `any` in public signatures. Strict TS.

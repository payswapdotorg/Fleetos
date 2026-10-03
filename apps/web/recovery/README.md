# apps/web/recovery

`@fleetos/web-recovery` — the recovery-side UI SURFACES (W060A, lane A).

Typed, provider-neutral, test-first UI surface modules for Find My
Device, the recovery cases, the Fleet Action plans, and the destructive
recovery actions: pure TypeScript view-models + state machines +
surface contracts. Since W090A the package ALSO ships the RENDERED
recovery screens (presentational React components over the same frozen
view-models — `src/screens/`, `src/ui/`): the runtime/shell/routes are
W091 Tech-Lead composition work; these are renderable component
libraries.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`: `apps/web/recovery/`).

## Module map

| Module                    | Deliverable | Contents |
| ------------------------- | ----------- | -------- |
| `src/seams.ts`            | structural  | The structural twins over the recovery + fleet-action domains: Find-My-Device view/ledger source, recovery-case source, action-plan source, destructive-request source, and the injected `StatusMachineTable` (the domain's frozen transition tables ride the binding site, so the display can never drift). |
| `src/find-my-device.ts`   | D1 | The Find-My-Device view-model: the last-seen evidence ledger surfaced READ-ONLY (append-only revision history), machine-stable `no_location_evidence` (never a guess), staleness re-derived against the VIEW's injected instant, and the opaque-by-omission location display (the payload bytes never enter the surface). |
| `src/recovery-case.ts`    | D2 | The recovery case view-models: the PROPOSAL-gated transitions surfaced read-only (injected table), the versioned append-only history, the evidence basis (typed refs), machine-stable closure reasons, and the VISIBLE destructive-gate precondition (`gating.acceptsDestructive`). |
| `src/fleet-actions.ts`    | D3 | The Fleet Action surfaces (W041): the group-selection display (recursive selector tree), the policy-gated plan state machines with the REQUIRE_APPROVAL PARKED states VISIBLE, and the plan list with the parked human-approval queue first. |
| `src/destructive-actions.ts` | D4 | The destructive action surfaces: lock/locate/wipe/reboot displayed with the W031 Guardian decision context and the GATED-PATH-ONLY affordance — there is NO direct-execution variant; the surface contracts make one-click execution unrepresentable (ARCHITECTURE-LOCK items 16 + 19). |
| `src/lane-phase.ts` | W141 | The honest LANE PHASE vocabulary (loading / empty / ready / blocked / approval_required / error / unsupported) carried alongside the screens' render `ScreenPhase`, with the total `toRecoveryScreenPhase` mapping — the machine-proven semantic state the runtime feeds expose. |
| `src/recovery-journey.ts` | W141 | The RECOVERY CASE JOURNEY view-model: the seven-stage operator walk (lost/stolen signal -> recovery case -> locate/secure decision -> authorization -> action -> evidence -> closure/escalation), every stage derived from real runtime state with honest not-yet-observed states. |
| `src/confirmation.ts` | W141 | The DESTRUCTIVE-ACTION CONFIRMATION flow: the gated explicit-confirmation state machine (acknowledge the consequences + type the exact `CONFIRM <ACTION> <deviceId>` phrase), the injected REAL gated boundary + the append-only audit seam (structurally the `@fleetos/audit` sink shape), machine-stable refusals, and visible feedback for every outcome — the user is never left to infer that a click failed. |
| `src/recovery-feed.ts` | W141 | The RECOVERY RUNTIME FEEDS: the composition functions carrying the runtime state contract into the screens' phase props — the cases list/detail + per-case journeys, Find My Device, and the gated destructive actions (the four actions' affordances + latest requests + the lost-flow context + the capability-gated unsupported states). |
| `src/ui/` | W090A | The LOCAL console design tokens (`tokens.tsx`, per `spec/ui/CONSOLE-DESIGN.md`), the status-vocabulary mapping (`status.ts`), and the local shadcn-style component vocabulary implemented in plain React + CSS (`primitives.tsx`) — no external UI library dependency. |
| `src/screens/` | W090A+W141 | The RENDERED recovery screens (fully controlled, presentational): the cases list + Sheet detail (`recovery-cases-screen.tsx`), Find My Device (`find-my-device-screen.tsx`), and the gated destructive-action presentation with the LOST-device flow timeline (`destructive-action-screen.tsx`). Browser-facing tests run against happy-dom (see `test/dom.preload.ts` + the root `bunfig.toml` preload). |

## W141 — the runtime composition + the confirmation flow

The lane's deep screens are now RUNTIME-BINDABLE: the three feeds
(`composeRecoveryCasesFeed`, `composeFindMyDeviceFeed`,
`composeDestructiveActionsFeed`) carry the real runtime state (the REAL
recovery case store, destructive-request store, last-seen ledger and
adapter capabilities, injected at the binding site) into the accepted
screens' exact phase props, with the per-case seven-stage RECOVERY
JOURNEY (signal -> case -> locate/secure decision -> authorization ->
action -> evidence -> closure/escalation). The destructive-action
CONFIRMATION FLOW (`src/confirmation.ts`) is the gated, explicit-
confirmation state machine: acknowledge + type-the-phrase, the injected
REAL gated boundary, the audit seam (the REAL `@fleetos/audit` log via
its sink adapter), and visible feedback for every refusal, cancellation
and outcome — the user is never left to infer that a click failed. The
console binding is W144 [TL] composition work.

## Design rules (frozen by this surface contract)

- Every view-model is PURE and DETERMINISTIC: no wall clock (the view
  instant is injected), no randomness, no I/O.
- The acting tenant rides EVERY query (first parameter); a refused
  scope yields a deterministic EMPTY view (no data, no leak).
- src/ imports: `@fleetos/contracts` ONLY — every domain surface is
  consumed through the STRUCTURAL seams with the real packages
  injected at binding sites (`test/` files import across lanes: the
  established W040-disclosed pattern). The Guardian decision is typed
  by the FROZEN contracts shape, verbatim.
- The action kind union is derived from the FROZEN
  `RecoveryIntentPayload` (`DestructiveActionKind`) — never
  re-declared.
- Destructive actions are NEVER one-click: `DestructiveActionAffordance`
  has exactly ONE variant (`gated_path_only`) with the full gate-step
  ledger (tenant scope -> active recovery case -> adapter capability ->
  Guardian evaluation -> human approval -> execution dispatch), each
  step machine-stably met/unmet/pending.
- Evidence refs are surfaced as OPAQUE content-addressable references
  (verbatim) — never interpreted; the Find-My-Device location payload
  never enters the view-model at all (opaque by omission).

## Tests

`bun test` (63 new tests total across the two W060A packages; this
package contributes 37):

- `test/binding-find-my-device.test.ts` — the REAL ledger + REAL
  `findMyDevice` derivation; machine-stable `no_location_evidence`;
  append-only ledger display; staleness re-derivation; tenant
  isolation; determinism.
- `test/binding-recovery-case.test.ts` — the REAL case store + the
  REAL frozen transition tables; PROPOSAL-gated transitions; versioned
  history; visible gate; closure reasons.
- `test/binding-fleet-actions.test.ts` — REAL plans through the REAL
  W031 Guardian (ALLOW/WARN/REQUIRE_APPROVAL/BLOCK); PARKED states
  visible; group-selection display; parked queue first.
- `test/binding-destructive.test.ts` — REAL destructive requests
  through the REAL gate (with the REAL policy engine + REAL W020
  adapter): gated-path-only affordance; gate-step ledger; Guardian
  decision context verbatim; human approval displayed; opaque §16
  evidence trail.

## Workspace note (W060A infrastructure disclosure)

`apps/web/*` nested packages require the root `workspaces` glob to
include `"apps/web/*"` for bun to link their declared `workspace:*`
dependencies (the W011 line-stop finding's recommended fix, applied
additively by W060A with the same disclosure discipline: minimal,
additive, TL-deferential). The root `package.json` edit is the ONLY
file outside this lane's directories touched by W060A (plus the
regenerated `bun.lock`).

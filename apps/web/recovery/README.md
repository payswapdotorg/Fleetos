# apps/web/recovery

`@fleetos/web-recovery` — the recovery-side UI SURFACES (W060A, lane A).

Typed, provider-neutral, test-first UI surface modules for Find My
Device, the recovery cases, the Fleet Action plans, and the destructive
recovery actions: pure TypeScript view-models + state machines +
surface contracts. **NOT a rendered app** — the shell arrives with
W061 [TL]; these are the typed surface modules the shell binds.

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

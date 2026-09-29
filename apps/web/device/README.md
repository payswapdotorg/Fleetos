# apps/web/device

`@fleetos/web-device` — the device UI SURFACES (W060A, lane A).

Typed, provider-neutral, test-first UI surface modules for the device
roster, the device detail header, and the Device Doctor detail: pure
TypeScript view-models + state machines + surface contracts. Since
W090A the package ALSO ships the RENDERED device screens
(presentational React components over the same frozen view-models —
`src/screens/`, `src/ui/`) and the NEW enrollment journey view-model
(`src/enrollment.ts` — the ❌ UX journey gap's fix): the
runtime/shell/routes are W091 Tech-Lead composition work; these are
renderable component libraries.

## Ownership

Lane: `worker-a` (per `spec/worker-ownership.yaml`: `apps/web/device/`).

## Module map

| Module            | Deliverable | Contents |
| ----------------- | ----------- | -------- |
| `src/seams.ts`    | structural  | `DeviceTwinLike` + `DeviceTwinSource` (structurally satisfied by the REAL `@fleetos/device-model` `DeviceTwin`/`TwinStore`, injected at binding sites — proven by test) and the Device Doctor sources (structurally satisfied by the REAL `@fleetos/health` pipeline outputs). |
| `src/device-list.ts` | D1 | The device roster view-model: composable typed filters (`and`/`or`/`not` algebra), deterministic ordering + pagination, facet counts over the matched set, injected-instant staleness banding, and the pure selection state machine. |
| `src/lifecycle.ts` | D2 | The device detail header + the frozen device lifecycle state machine surfaced READ-ONLY (legal next states derived from the FROZEN `DEVICE_LIFECYCLE_TRANSITIONS` in `@fleetos/contracts`; the LEARN loop-closure note documented, never performed). |
| `src/doctor.ts`   | D3 | The Device Doctor detail view-model: signals, baselines, anomalies, VERSIONED diagnoses + treatment recommendations (read-only lineage with ACTIVE/SUPERSEDED/DISMISSED statuses), OPAQUE content-addressable evidence refs (never interpreted), and the pure panel navigation state machine. |
| `src/enrollment.ts` | D5 (W090A) | The existing-fleet ENROLLMENT journey view-model: the pure multi-step machine (initiate -> review -> confirm -> verified/failed), the draft validation with machine-stable reasons, the explicit scope acknowledgment, the COMMAND view (an intent, never an execution), and the VERIFIED-outcome derivation from the twin source (three checks + the durable evidence block). |
| `src/ui/` | W090A | The LOCAL console design tokens (`tokens.tsx`, per `spec/ui/CONSOLE-DESIGN.md`), the status-vocabulary mapping (`status.ts`), and the local shadcn-style component vocabulary implemented in plain React + CSS (`primitives.tsx`) — no external UI library dependency. |
| `src/screens/` | W090A | The RENDERED device screens (fully controlled, presentational): the roster (`device-fleet-screen.tsx`), Device Doctor (`device-doctor-screen.tsx`), the lifecycle machine with visible transition authorization (`device-lifecycle-screen.tsx`), and the enrollment journey (`enrollment-screen.tsx`). Browser-facing tests run against happy-dom (see `test/dom.preload.ts` + the root `bunfig.toml` preload). |

## Design rules (frozen by this surface contract)

- Every view-model is PURE and DETERMINISTIC: no wall clock (the
  staleness reference instant is injected), no randomness, no I/O.
- The acting tenant rides EVERY query (first parameter); a refused
  scope yields a deterministic EMPTY view (no data, no leak).
- src/ imports: `@fleetos/contracts` ONLY — every domain surface is
  consumed through the STRUCTURAL seams with the real packages
  injected at binding sites (`test/` files import across lanes: the
  established W040-disclosed pattern).
- Evidence refs are surfaced as OPAQUE content-addressable references
  (`EvidenceRef` values, verbatim) — never interpreted.
- Treatment recommendations are PROPOSALS (the proposed intent KIND +
  rationale); nothing here creates, dispatches, or executes an intent.

## Tests

`bun test` (63 new tests total across the two W060A packages; this
package contributes 26):

- `test/binding-device-list.test.ts` — the roster over the REAL
  TwinStore: listing/filtering/sorting/paging/facets/selection,
  determinism, tenant isolation.
- `test/binding-lifecycle.test.ts` — the exhaustive 9-state read-only
  lifecycle machine surface + detail headers over REAL twins.
- `test/binding-doctor.test.ts` — the REAL W021 pipeline end-to-end
  (observations -> signals -> baselines -> anomalies -> diagnosis
  ledger) into the doctor view-model; versioned read-only lineage;
  opaque evidence; determinism.

## Workspace note (W060A infrastructure disclosure)

`apps/web/*` nested packages require the root `workspaces` glob to
include `"apps/web/*"` for bun to link their declared `workspace:*`
dependencies (the W011 line-stop finding's recommended fix, applied
additively by W060A with the same disclosure discipline: minimal,
additive, TL-deferential). The root `package.json` edit is the ONLY
file outside this lane's directories touched by W060A (plus the
regenerated `bun.lock`).

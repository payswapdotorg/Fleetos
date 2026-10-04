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
| `src/install-center.ts` | W100A | The INSTALL CENTER view-model (the install contract's first-class surface): platform facets over the release manifest, the four ownership-scope presentations (BYOD conservative note included), the one-time enrollment-code card (display-once semantics + status bands from the injected instant), the install plan (artifact data verbatim + the download/verify-checksum/copy-command/install steps), installation verification over the agent journey trace, the deterministic next-action ladder, and the uninstall/revoke plan (authorization-required INTENTS, never executions). |
| `src/lane-phase.ts` | W141 | The honest LANE PHASE vocabulary (loading / empty / ready / blocked / approval_required / error / unsupported) carried alongside the screens' render `ScreenPhase`, with the total `toDeviceScreenPhase` mapping — the machine-proven semantic state the runtime feeds expose. |
| `src/declared-import.ts` | W145 | The DECLARED-IMPORT surface view-model: the record-origin provenance vocabulary (`DeviceRecordProvenance` DECLARED/OBSERVED + the `deviceRecordProvenance` derivation over the enrollment provenance's machine-stable marker — marking, not exclusion), the manual-entry draft + validation, the HONEST duplicate review (blocking device-id collisions, acknowledgeable same-serial collisions, tenant-partitioned), the pure journey machine (enter -> review -> confirm -> recorded/refused), the COMMAND view (an intent carrying the exact DECLARED provenance the binding site records verbatim through the REAL domain path), and the recorded-outcome verification with the conflation detector (`present_not_declared`). |
| `src/mobile-roster.ts` | W145 | The MOBILE PRIORITY-CARD roster view-model: the severity-first attention ladder (critical > attention > stale > never_observed > indeterminate > healthy) + `buildMobileDeviceCards` — the card-list projection of the SAME roster view-model (same REAL runtime state as the table), deterministically ordered (rank then deviceId). |
| `src/doctor-journey.ts` | W141 | The Device Doctor JOURNEY view-model: the full nine-stage operator walk (device -> observations -> symptoms -> diagnosis -> remediation -> authorization -> action -> result -> evidence) with the SYMPTOM WALK (one step per real anomaly, severity-first, evidence-anchored) and the REMEDIATION WALK (proposal -> disposition -> Guardian decision -> durable request -> result) — honest not-yet-observed states, never fabricated observations. |
| `src/doctor-feed.ts` | W141 | The Device Doctor RUNTIME FEED: the composition function carrying the runtime state contract into the screen's phase props (`phase` + `lanePhase` + `journey` + per-treatment gating/dispositions), over the injected structural sources (twin store, health pipeline, observations, remediation records). |
| `src/screens/` | W090A+W100A+W141+W145 | The RENDERED device screens (fully controlled, presentational): the roster (`device-fleet-screen.tsx` — with the W145 provenance badges, the optional `onDeclare` cold-start entry points, and the `mobileRoster` narrow composition that REPLACES the 993px table with the priority card list), Device Doctor (`device-doctor-screen.tsx`), the lifecycle machine with visible transition authorization (`device-lifecycle-screen.tsx`), the enrollment journey (`enrollment-screen.tsx`), and the declared-import journey (`declared-import-screen.tsx` — enter -> review -> confirm -> recorded, provenance-flagged from the first pixel). Browser-facing tests run against happy-dom (see `test/dom.preload.ts` + the root `bunfig.toml` preload). |

## W141 — the runtime composition

The lane's deep screens are now RUNTIME-BINDABLE: `composeDeviceDoctorFeed`
carries the real runtime state (the REAL twin store + the REAL health
pipeline + the REAL remediation records, injected at the binding site)
into the accepted Device Doctor screen's exact phase props. Every
lane-phase transition is machine-proven (loading -> ready / blocked /
error; ready -> approval_required when a remediation request is PARKED;
the fresh tenant's honest `empty`). The screens gained ADDITIVE optional
props (`journey`) — the console binding is W144 [TL] composition work.

## W145 — the declared-import path + the mobile priority-card roster

The SIM-B ground truths fixed in this lane:

1. **The SMALL-firm cold start** — a fresh workspace could not begin
   tracking devices before agent rollout. `src/declared-import.ts` +
   `src/screens/declared-import-screen.tsx` ship the manual entry path:
   a declared record is a REAL device record created through the same
   domain commands (the command view carries the exact enrollment
   provenance the binding site records verbatim), provenance-flagged
   DECLARED on every surface — roster rows, facets (`Record origin`),
   searches (the haystack carries the provenance word), and the
   mobile cards. NEVER conflated with agent OBSERVED records: the mark
   derives from the machine-stable `fleetos.declared-import` enrollment
   reason; a binding site that drops it is DETECTED
   (`verifyDeclaredImport` -> `present_not_declared`). Honest duplicate
   handling: a same-id record BLOCKS (never overwritten, the existing
   record is shown); a same-serial record requires an explicit
   acknowledgment. A declared record fabricates NO observation (the
   real-observations-only doctrine respected by the marking) — it stays
   `Never observed` until a real agent checks in, and the DECLARED
   origin mark stays after the upgrade.
2. **The mobile roster overflow** — the 993px table forced horizontal
   page scroll below ~480px. `src/mobile-roster.ts` + the roster
   screen's `mobileRoster` composition signal (the shell's viewport
   knowledge — `matchMedia("(max-width: 480px)")` at the composition
   root, W144 [TL] wiring) REPLACE the table with the priority card
   list: severity-first ordering (critical > attention > stale > never
   observed > indeterminate > healthy), the SAME REAL runtime state,
   and width-bounded card CSS (`min-width: 0` + `max-width: 100%` +
   `overflow-wrap: anywhere`) so no horizontal page scroll can occur
   at 390x844. Without the signal the roster renders the table exactly
   as before (byte-identical — the desktop composition is unchanged).

New machine tests: `test/declared-import.test.ts` (the provenance
separation + validation + duplicate paths + the journey machine + the
command/verification contracts, including the REAL device-model
structural proof), `test/composition-declared-roster.test.ts` (the
binding-site execution path over the REAL store — declared records
flow into roster/feeds/searches with provenance intact; the cold-start
journey; the conflation detector; the agent-upgrade),
`test/render-declared-import.test.tsx` (the rendered journey stages,
gates, and machine-stable reasons), `test/render-mobile-roster.test.tsx`
(the narrow composition contract: table REPLACED, priority ordering,
provenance badges, the width-bounded layout CSS, the unchanged desktop
composition, determinism).

The console composition (the `onDeclare` / `mobileRoster` wiring, the
matchMedia viewport signal, and the declared-import command execution
at the runtime boundary) is W144 [TL] composition work.

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
